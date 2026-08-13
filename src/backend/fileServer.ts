import { createServer as createHttpsServer, Server as HttpsServer } from "https";
import { createServer as createHttpServer, Server as HttpServer, IncomingMessage, ServerResponse } from "http";
import { promises as fs, createReadStream, createWriteStream, statSync } from "fs";
import path from "path";
import { EventEmitter } from "events";
import { ZipArchive } from "archiver";
import { getServerCert } from "./certs";
import { pipeline } from "stream/promises";
import cluster from "cluster";
import os from "os";

interface SharedFile {
  filePath: string;
  fileName: string;
  fileSize: number;
  relativePath: string;
  downloadProgress?: number;
  etag: string;      // cached at startup — no sync I/O on downloads
  mtimeMs: number;   // cached at startup
}

export class FileServer extends EventEmitter {
  private server: HttpServer | HttpsServer | null = null;
  private port: number = 3000;
  private files: SharedFile[] = [];
  private fileMap: Map<string, SharedFile> = new Map();
  private strings: Record<string, string> = {};
  private lang: string = "en";
  private zipPath: string | null = null; // pre-built at startup

  async start(
    filePaths: string[],
    relativePaths?: (string | undefined)[],
    port?: number,
    ip?: string,
    message?: string,
    strings?: Record<string, string>,
    lang?: string,
    useEncryption: boolean = true,
  ): Promise<string> {
    if (this.server) throw new Error("Server already running");
    this.strings = strings || {};
    this.lang = lang || "en";
    if (port) this.port = port;

    this.files = [];
    this.fileMap.clear();

    for (let i = 0; i < filePaths.length; i++) {
      const fp = filePaths[i];
      await fs.access(fp);
      const stat = statSync(fp);
      const relative = relativePaths?.[i] || path.basename(fp);
      const file: SharedFile = {
        filePath: fp,
        fileName: path.basename(fp),
        fileSize: stat.size,
        relativePath: relative,
        etag: `"${stat.size}-${stat.mtimeMs}"`,
        mtimeMs: stat.mtimeMs,
      };
      this.files.push(file);
      this.fileMap.set(relative, file);
    }

    // ─── PRE-BUILD ZIP AT STARTUP ───
    // Moves ZIP CPU cost to boot time. The actual download becomes pure
    // streaming I/O with zero on-the-fly formatting overhead.
    if (this.files.length > 0) {
      const tmpDir = path.join(os.tmpdir(), "mayo-share-tmp");
      await fs.mkdir(tmpDir, { recursive: true });
      this.zipPath = path.join(tmpDir, `mayo-share-${Date.now()}.zip`);
      await new Promise<void>((resolve, reject) => {
        const output = createWriteStream(this.zipPath!, { highWaterMark: 16 * 1024 * 1024 });
        const archive = new ZipArchive({ zlib: { level: 0 } });
        archive.on("error", reject);
        archive.on("warning", (err: Error) => console.warn("Zip warning:", err));
        output.on("close", () => resolve());
        archive.pipe(output);
        for (const f of this.files) {
          archive.file(f.filePath, { name: f.relativePath });
        }
        archive.finalize();
      });
    }

    return new Promise((resolve, reject) => {
      if (!ip) {
        reject(new Error("FileServer.start() requires a resolved LAN IP."));
        return;
      }

      // ─── CLUSTER MODE FOR HTTPS ───
      // TLS encryption is CPU-bound. One Node core will choke before the
      // network does. Fork one worker per core and let the OS load-balance.
      if (useEncryption && cluster.isPrimary) {
        const numCPUs = os.cpus().length;
        for (let i = 0; i < numCPUs; i++) {
          cluster.fork();
        }
        // Primary does not create a server; workers do.
        // NOTE: Your app must call start() in both primary and worker processes.
        resolve(`https://${ip || "192.168.137.1"}:${this.port}`);
        return;
      }

      const requestHandler = async (req: IncomingMessage, res: ServerResponse) => {
        try {
          // Disable Nagle + enable keep-alive for long multi-GB transfers
          req.socket.setNoDelay(true);
          req.socket.setKeepAlive(true, 60000);

          const url = req.url || "/";
          const method = req.method || "GET";

          // ✅ Global CORS
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type");

          if (method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
          }

          // Serve the HTML index page
          if (url === "/" || url === "") {
            const html = buildDownloadPage(this.files, this.strings, this.lang);
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
            return;
          }

          // Serve the MAYO logo
          if (url === "/mayo.png") {
            try {
              const data = await fs.readFile(path.join(__dirname, "mayo.png"));
              res.writeHead(200, { "Content-Type": "image/png" });
              res.end(data);
            } catch {
              res.writeHead(404);
              res.end();
            }
            return;
          }

          // Serve JSZip locally (offline)
          if (url === "/jszip.min.js") {
            const filePath = path.join(__dirname, "../../node_modules/jszip/dist/jszip.min.js");
            try {
              const data = await fs.readFile(filePath);
              res.writeHead(200, { "Content-Type": "application/javascript" });
              res.end(data);
            } catch {
              res.writeHead(404);
              res.end();
            }
            return;
          }

          // ─── PRE-BUILT ZIP DOWNLOAD ───
          if (url === "/download-all" || url === "/download-all.zip") {
            req.socket.setNoDelay(true);
            const clientIp = req.socket.remoteAddress || "unknown";
            if (this.zipPath) {
              const zipStat = await fs.stat(this.zipPath);
              res.writeHead(200, {
                "Content-Type": "application/zip",
                "Content-Disposition": `attachment; filename="mayo-share.zip"`,
                "Cache-Control": "no-cache",
                "Content-Length": String(zipStat.size),
              });
              const stream = createReadStream(this.zipPath, { highWaterMark: 16 * 1024 * 1024 });
              this.emit("download-started", -1, "All files (ZIP)");
              try {
                await pipeline(stream, res);
                this.emit("download-completed", -1, "All files (ZIP)", clientIp);
              } catch (err) {
                console.error("ZIP pipeline error:", err);
              }
              return;
            }
            res.writeHead(503);
            res.end("ZIP not ready");
            return;
          }

          // ─── INDIVIDUAL FILE STREAMING ───
          if (url.startsWith("/file/")) {
            const relative = decodeURIComponent(url.slice(6));

            // --- SECURITY: Path traversal guard ---
            if (relative.includes('..') || path.isAbsolute(relative)) {
              res.writeHead(403);
              res.end('Forbidden');
              return;
            }

            const clientIp = req.socket.remoteAddress || "unknown";
            let fileEntry = this.fileMap.get(relative);
            if (!fileEntry) {
              const byName = this.files.find(
                (f) => f.relativePath === relative || f.fileName === relative,
              );
              if (!byName) {
                res.writeHead(404);
                res.end("File not found");
                return;
              }
              fileEntry = byName;
            }

            // Use cached metadata — NO sync stat() on the hot path
            const fileSize = fileEntry.fileSize;
            const etag = fileEntry.etag;

            // Conditional request (caching)
            if (req.headers["if-none-match"] === etag) {
              res.writeHead(304);
              res.end();
              return;
            }

            // Parse Range header for resumable downloads
            const rangeHeader = req.headers.range;
            let start = 0;
            let end = fileSize - 1;
            let isPartial = false;

            if (rangeHeader) {
              const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
              if (match) {
                start = parseInt(match[1], 10);
                if (match[2]) end = parseInt(match[2], 10);
                if (start < fileSize && end < fileSize && start <= end) {
                  isPartial = true;
                }
              }
            }

            // Common headers
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${encodeURIComponent(fileEntry.fileName)}"`
            );
            res.setHeader("ETag", etag);
            res.setHeader("Cache-Control", "no-cache, max-age=0");
            res.setHeader("Accept-Ranges", "bytes");

            const fileIndex = this.files.indexOf(fileEntry);

            // ─── RANGE REQUEST (partial) ───
            if (isPartial) {
              const contentLength = end - start + 1;
              res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                "Content-Length": contentLength,
                "Content-Type": "application/octet-stream",
              });
              const stream = createReadStream(fileEntry.filePath, {
                start,
                end,
                highWaterMark: 16 * 1024 * 1024, // 16 MB — fewer syscalls
              });
              this.emit("download-started", fileIndex, fileEntry.fileName);
              let bytesSent = 0;
              let lastPct = -1;
              stream.on("data", (chunk: any) => {
                const length = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
                bytesSent += length;
                const totalSent = start + bytesSent;
                const pct = Math.floor((totalSent / fileSize) * 100);
                if (pct !== lastPct) {
                  lastPct = pct;
                  this.emit("download-progress", fileEntry.fileName, pct);
                }
              });
              res.on("finish", () => {
                this.emit("download-completed", fileIndex, fileEntry.fileName, clientIp);
              });
              try {
                await pipeline(stream, res);
              } catch (err) {
                console.error("Range stream error:", err);
                if (!res.headersSent) {
                  res.writeHead(500);
                  res.end("File read error");
                }
              }
              return;
            }

            // ─── FULL FILE STREAM ───
            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader("Content-Length", fileSize);
            const stream = createReadStream(fileEntry.filePath, { highWaterMark: 16 * 1024 * 1024 });
            this.emit("download-started", fileIndex, fileEntry.fileName);
            let bytesSent = 0;
            let lastPct = -1;
            stream.on("data", (chunk: any) => {
              const length = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
              bytesSent += length;
              const pct = Math.floor((bytesSent / fileSize) * 100);
              if (pct !== lastPct) {
                lastPct = pct;
                this.emit("download-progress", fileEntry.fileName, pct);
              }
            });
            res.on("finish", () => {
              this.emit("download-completed", fileIndex, fileEntry.fileName, clientIp);
            });
            try {
              await pipeline(stream, res);
            } catch (err) {
              console.error("Stream error:", err);
              if (!res.headersSent) {
                res.writeHead(500);
                res.end("File read error");
              }
            }
            return;
          }

          res.writeHead(404);
          res.end("Not found");
        } catch (err) {
          console.error("Unhandled request error:", err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end("Internal error");
          }
        }
      };

      if (useEncryption) {
        const { key, cert } = getServerCert(ip);
        this.server = createHttpsServer({
          key,
          cert,
          minVersion: "TLSv1.3",
          maxVersion: "TLSv1.3",
          sessionTimeout: 7200,
        } as any, requestHandler);
      } else {
        this.server = createHttpServer(requestHandler);
      }

      this.server.keepAliveTimeout = 65000;
      this.server.headersTimeout = 66000;
      this.server.requestTimeout = 0;

      this.server.listen(this.port, "0.0.0.0", () => {
        const usedIP = ip || "192.168.137.1";
        const protocol = useEncryption ? "https" : "http";
        resolve(`${protocol}://${usedIP}:${this.port}`);
      });

      this.server.on("error", (err) => {
        this.server = null;
        reject(err);
      });
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    if (cluster.isPrimary) {
      for (const id in cluster.workers) {
        cluster.workers[id]?.kill();
      }
    }
    this.files = [];
    this.fileMap.clear();
    if (this.zipPath) {
      fs.unlink(this.zipPath).catch(() => { });
      this.zipPath = null;
    }
  }
}

// ─── Helpers (unchanged) ───
function formatBytes(b: number): string {
  if (b === 0) return "0 B";
  const k = 1024,
    sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"].includes(ext))
    return "🖼️";
  if (["mp4", "mkv", "avi", "mov", "webm"].includes(ext)) return "🎬";
  if (["mp3", "wav", "aac", "flac", "ogg"].includes(ext)) return "🎵";
  if (["pdf"].includes(ext)) return "📕";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📋";
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return "🗜️";
  if (["exe", "msi"].includes(ext)) return "⚙️";
  if (["apk"].includes(ext)) return "📱";
  if (["txt", "md"].includes(ext)) return "📄";
  if (["js", "ts", "py", "java", "cpp", "c", "cs"].includes(ext)) return "💻";
  return "📁";
}

// ─── Tree Builder (unchanged) ───
interface TreeNode {
  name: string;
  isDir: boolean;
  children?: TreeNode[];
  file?: SharedFile;
}

function buildTree(files: SharedFile[]): TreeNode {
  const root: TreeNode = { name: "/", isDir: true, children: [] };

  for (const f of files) {
    const parts = f.relativePath.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = current.children?.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          isDir: !isLast,
          children: isLast ? undefined : [],
          file: isLast ? f : undefined,
        };
        current.children!.push(child);
      }
      current = child;
    }
  }
  return root;
}

function renderTree(node: TreeNode, depth: number = 0): string {
  if (node.isDir && node.children) {
    const childrenHtml = node.children
      .map((child) => renderTree(child, depth + 1))
      .join("");
    if (depth === 0) return childrenHtml;
    return `
      <li class="tree-dir">
        <span class="folder-name">📁 ${escapeHtml(node.name)}</span>
        <ul>${childrenHtml}</ul>
      </li>`;
  }
  if (node.file) {
    const f = node.file;
    return `
      <li class="tree-file">
        <div class="tree-file-row">
          <span class="name">
            <span class="icon">${getFileIcon(f.fileName)}</span>
            <span>${escapeHtml(f.fileName)}</span>
          </span>
          <span class="size">${formatBytes(f.fileSize)}</span>
          <span class="action">
            <a href="/file/${encodeURIComponent(f.relativePath)}" download="${escapeHtml(f.fileName)}" class="download-btn">Download</a>
          </span>
        </div>
      </li>`;
  }
  return "";
}

function hasSubfolders(files: SharedFile[]): boolean {
  return files.some((f) => f.relativePath.includes("/"));
}

// ─── Download Page (unchanged) ───
function buildDownloadPage(
  files: SharedFile[],
  strings: Record<string, string> = {},
  lang: string = "en",
): string {
  const t = (key: string, fallback: string, vars?: Record<string, string | number>) => {
    let s = strings[key] ?? fallback;
    if (vars) for (const k in vars) s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, "g"), String(vars[k]));
    return s;
  };
  const isRTL = ["ar", "ur"].includes(lang);

  const fileCount = files.length;
  const useTree = hasSubfolders(files);
  let fileListHtml = "";
  const totalSize = files.reduce((sum, f) => sum + f.fileSize, 0);

  if (useTree) {
    const tree = buildTree(files);
    let folderCounter = 0;
    function renderInteractiveTree(node: TreeNode, depth: number = 0): string {
      if (node.isDir && node.children) {
        const folderId = `folder-${folderCounter++}`;
        const childrenHtml = node.children
          .map((child) => renderInteractiveTree(child, depth + 1))
          .join("");
        return `
          <li class="tree-dir" data-folder-id="${folderId}">
            <div class="folder-header">
              <span class="chevron">▼</span>
              <span class="folder-icon">
                <svg class="folder-svg" viewBox="0 0 512 512" width="18" height="18" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32">
                  <path d="M440 432H72a40 40 0 01-40-40V120a40 40 0 0140-40h75.89a40 40 0 0122.19 6.72l27.84 18.56a40 40 0 0022.19 6.72H440a40 40 0 0140 40v240a40 40 0 01-40 40zM32 192h448"/>
                </svg>
              </span>
              <span class="folder-name">${escapeHtml(node.name)}</span>
            </div>
            <ul class="folder-content" id="${folderId}">${childrenHtml}</ul>
          </li>`;
      }
      if (node.file) {
        const f = node.file;
        return `
          <li class="tree-file">
            <div class="tree-file-row">
              <span class="name" title="${escapeHtml(f.fileName)}">
                <span class="file-icon">
                  <svg class="file-svg" viewBox="0 0 512 512" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32">
                    <path d="M440 432H72a40 40 0 01-40-40V120a40 40 0 0140-40h75.89a40 40 0 0122.19 6.72l27.84 18.56a40 40 0 0022.19 6.72H440a40 40 0 0140 40v240a40 40 0 01-40 40zM32 192h448"/>
                  </svg>
                </span>
                <span class="file-name">${escapeHtml(f.fileName)}</span>
              </span>
              <span class="size">${formatBytes(f.fileSize)}</span>
              <span class="action">
                <a href="/file/${encodeURIComponent(f.relativePath)}" download="${escapeHtml(f.fileName)}" class="download-btn">${t("browserDownload", "Download")}</a>
              </span>
            </div>
          </li>`;
      }
      return "";
    }
    fileListHtml = `<ul class="file-tree">${renderInteractiveTree(tree)}</ul>`;
  } else {
    fileListHtml = `<div class="table-wrapper"><table class="file-table">
      <thead>
        <tr><th>${t("browserFileName", "File name")}</th><th>${t("browserSize", "Size")}</th><th></th></tr>
      </thead>
      <tbody>
      ${files
        .map(
          (f) => `
        <tr><td class="name" title="${escapeHtml(f.fileName)}">
            <span class="file-icon">
              <svg class="file-svg" viewBox="0 0 512 512" width="16" height="16" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32">
                <path d="M440 432H72a40 40 0 01-40-40V120a40 40 0 0140-40h75.89a40 40 0 0122.19 6.72l27.84 18.56a40 40 0 0022.19 6.72H440a40 40 0 0140 40v240a40 40 0 01-40 40zM32 192h448"/>
              </svg>
            </span>
            <span class="file-name">${escapeHtml(f.fileName)}</span>
          </td>
          <td class="size">${formatBytes(f.fileSize)}</td>
          <td class="action">
            <a href="/file/${encodeURIComponent(f.relativePath)}" download="${escapeHtml(f.fileName)}" class="download-btn">Download</a>
          </td>
        </tr>`,
        )
        .join("")}
      </tbody>
    </table></div>`;
  }

  const zipButtonHtml = `
    <button id="downloadAllBtn" class="zip-btn" title="Download all as ZIP">
      <svg xmlns="http://www.w3.org/2000/svg" class="download-all-icon" viewBox="0 0 512 512" width="24" height="24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32">
        <path d="M176 262.62L256 342l80-79.38M256 330.97V170"/>
        <path d="M256 64C150 64 64 150 64 256s86 192 192 192 192-86 192-192S362 64 256 64z" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32"/>
      </svg>
      <span id="zipBtnLabel">${t("browserDownloadAllZip", "Download All as ZIP")}</span>
      <span class="zip-total-size">(${formatBytes(totalSize)})</span>
    </button>
  `;

  return `<!DOCTYPE html>
<html lang="${lang}"${isRTL ? ' dir="rtl"' : ""}>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>MAYO Share</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-body: #0A0A0A;
      --text-color: #fff;
      --share-color: #fff;
      --subtitle-color: #888;
      --card-bg: #111;
      --border-color: #222;
      --row-border: #1a1a1a;
      --row-hover: #161616;
      --name-color: #ddd;
      --size-color: #666;
      --download-bg: #7C3EFF;
      --download-hover: #6A28E6;
      --download-text: #fff;
      --zip-bg: #4CAF50;
      --zip-hover: #43a047;
      --folder-header-bg: #151515;
      --folder-name-color: #fff;
      --tree-file-row-bg: #111;
      --footer-color: #444;
      --folder-header-hover-border: #7C3EFF;
      --table-header-bg: #1a1a1a;
    }
    [data-theme="light"] {
      --bg-body: #f5f5f5;
      --text-color: #222;
      --share-color: #000;
      --subtitle-color: #555;
      --card-bg: #ffffff;
      --border-color: #ddd;
      --row-border: #e0e0e0;
      --row-hover: #f0f0f0;
      --name-color: #222;
      --size-color: #666;
      --download-bg: #7C3EFF;
      --download-hover: #5a2db8;
      --download-text: #000;
      --zip-bg: #4CAF50;
      --zip-hover: #43a047;
      --folder-header-bg: #e8e8e8;
      --folder-name-color: #222;
      --tree-file-row-bg: #ffffff;
      --footer-color: #aaa;
      --folder-header-hover-border: #7C3EFF;
      --table-header-bg: #e8e8e8;
    }
    body {
      background: var(--bg-body);
      color: var(--text-color);
      font-family: Arial, sans-serif;
      min-height: 100vh;
      padding: 40px 20px;
      transition: background 0.2s, color 0.2s;
    }
    .header { text-align: center; margin-bottom: 40px; display: flex; flex-direction: column; align-items: center; }
    .logo {
      display: flex;
      gap: 4px;
      justify-content: center;
      align-items: baseline;
      font-size: 2rem;
      font-weight: bold;
    }
    .logo-mayo { color: #7C3EFF; }
    .logo-share { color: var(--share-color); }
    .subtitle { color: var(--subtitle-color); font-size: 1rem; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      max-width: 1000px;
      margin: 0 auto;
      overflow-x: auto;
    }
    .table-wrapper { overflow-x: auto; }
    .file-table {
      width: 100%;
      border-collapse: collapse;
      min-width: 280px;
    }
    .file-table th,
    .file-table td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--row-border);
      vertical-align: middle;
    }
    .file-table th {
      background: var(--table-header-bg);
      font-weight: bold;
      color: var(--text-color);
    }
    .file-table tr:hover { background: var(--row-hover); }
    .file-table .name {
      display: flex;
      align-items: center;
      gap: 8px;
      word-break: break-word;
      max-width: 100%;
    }
    .file-table .file-name {
      overflow-wrap: break-word;
      word-break: break-all;
    }
    .file-table .size { white-space: nowrap; padding-right: 16px; }
    .file-table .action { text-align: right; white-space: nowrap; }
    .download-btn {
      display: inline-block; padding: 6px 16px;
      background: var(--download-bg);
      color: var(--download-text);
      text-decoration: none;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: bold;
      transition: background 0.2s;
      white-space: nowrap;
    }
    .download-btn:hover { background: var(--download-hover); }
    .footer { text-align: center; margin-top: 32px; color: var(--footer-color); font-size: 0.8rem; }
    .file-tree { list-style: none; padding: 0; margin: 0; }
    .file-tree ul { list-style: none; padding-left: 24px; margin: 0; }
    .tree-dir { margin: 8px 0; }
    .folder-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--folder-header-bg);
      border-radius: 4px;
      cursor: pointer;
      font-weight: bold;
      color: var(--folder-name-color);
      transition: border 0.2s;
      border: 1px solid transparent;
    }
    .folder-header:hover { border-color: var(--folder-header-hover-border); }
    .chevron {
      font-size: 0.8rem;
      width: 16px;
      text-align: center;
      transition: transform 0.2s;
    }
    .folder-content { overflow: hidden; transition: max-height 0.2s ease-out; }
    .folder-content.collapsed { display: none; }
    .tree-file { margin: 4px 0; padding: 8px 16px 8px 0; }
    .tree-file-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding: 8px 16px;
      background: var(--tree-file-row-bg);
      border-radius: 6px;
    }
    .tree-file-row .name {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 150px;
      word-break: break-word;
    }
    .tree-file-row .name .file-name {
      overflow-wrap: break-word;
      word-break: break-all;
    }
    .tree-file-row .size { white-space: nowrap; }
    .tree-file-row .action { white-space: nowrap; }
    .zip-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin: 20px auto;
      padding: 10px 20px;
      background: var(--zip-bg);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.2s;
    }
    .zip-btn:hover { background: var(--zip-hover); }
    .download-all-icon {
      width: 20px;
      height: 20px;
      stroke: white;
      fill: none;
    }
    .zip-total-size { font-size: 0.8rem; opacity: 0.8; }
    .navbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: 1000px;
      margin: 0 auto 24px auto;
    }
    .nav-logo { height: 32px; width: auto; display: block; }
    .theme-toggle {
      position: relative;
      width: 56px;
      height: 30px;
      border: none;
      border-radius: 30px;
      cursor: pointer;
      padding: 0;
      background: #3a3a3a;
      transition: background 0.25s ease;
    }
    .toggle-thumb {
      position: absolute;
      top: 3px;
      left: 3px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.25s ease;
      box-shadow: 0 1px 3px rgba(0,0,0,0.4);
    }
    .theme-toggle svg { width: 14px; height: 14px; stroke: #333; stroke-width: 2; fill: none; }
    [data-theme="light"] .theme-toggle { background: #7C3EFF; }
    [data-theme="light"] .toggle-thumb { transform: translateX(26px); }
    @media (max-width: 600px) {
      body { padding: 20px 12px; }
      .logo { font-size: 1.6rem; }
      .subtitle { font-size: 0.9rem; }
      .card { border-radius: 12px; }
      .file-table,
      .file-table tbody,
      .file-table tr,
      .file-table td,
      .file-table th { display: block; }
      .file-table thead { display: none; }
      .file-table tr {
        margin-bottom: 16px;
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 12px;
      }
      .file-table td {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 0;
        border: none;
      }
      .file-table td.name {
        font-weight: bold;
        justify-content: flex-start;
        gap: 8px;
      }
      .file-table td.size::before { content: "Size: "; font-weight: normal; color: var(--size-color); }
      .file-table td.action { justify-content: flex-end; }
      .tree-file-row {
        flex-direction: column;
        align-items: flex-start;
      }
      .tree-file-row .name { width: 100%; }
      .tree-file-row .size,
      .tree-file-row .action { align-self: flex-end; }
      .folder-header { padding: 6px 12px; }
      .file-tree ul { padding-left: 16px; }
      .zip-btn { width: 100%; padding: 10px; font-size: 0.9rem; }
    }
  </style>
  <script src="/jszip.min.js"></script>
</head>
<body>
  <div class="navbar">
    <img class="nav-logo" src="/mayo.png" alt="MAYO Share" />
    <button class="theme-toggle" id="themeToggle" aria-label="Toggle theme">
      <span class="toggle-thumb">
        <svg id="sunIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
          <path fill="none" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M256 48v48M256 416v48M403.08 108.92l-33.94 33.94M142.86 369.14l-33.94 33.94M464 256h-48M96 256H48M403.08 403.08l-33.94-33.94M142.86 142.86l-33.94-33.94"/>
          <circle cx="256" cy="256" r="80" fill="none" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32"/>
        </svg>
        <svg id="moonIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="display: none;">
          <path d="M160 136c0-30.62 4.51-61.61 16-88C99.57 81.27 48 159.32 48 248c0 119.29 96.71 216 216 216 88.68 0 166.73-51.57 200-128-26.39 11.49-57.38 16-88 16-119.29 0-216-96.71-216-216z" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/>
        </svg>
      </span>
    </button>
  </div>
  <div class="header">
    <div class="logo">
      <span class="logo-mayo">MAYO</span>
      <span class="logo-share">Share</span>
    </div>
    <div class="subtitle">${fileCount === 1
      ? t("browserFilesShared_one", "{{count}} file shared with you", { count: fileCount })
      : t("browserFilesShared_other", "{{count}} files shared with you", { count: fileCount })}</div>
  </div>
  <div class="card">
    ${useTree ? "" : ""}
    ${fileListHtml}
    ${useTree ? "" : ""}
    ${useTree ? zipButtonHtml : ""}
  </div>
  <div class="footer">${t("browserSharedVia", "Shared via MAYO Share • Offline P2P File Transfer")}</div>
  <script>
    const __T = ${JSON.stringify(strings)};
    function T(key, fallback, vars){
      var s = (__T && __T[key] != null) ? __T[key] : fallback;
      if (vars) Object.keys(vars).forEach(function(k){ s = s.split('{{'+k+'}}').join(vars[k]); });
      return s;
    }
    const themeToggle = document.getElementById('themeToggle');
    const sunIcon = document.getElementById('sunIcon');
    const moonIcon = document.getElementById('moonIcon');
    function getStoredTheme() { return localStorage.getItem('mayo-download-theme'); }
    function setTheme(theme) {
      if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('mayo-download-theme', 'light');
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('mayo-download-theme', 'dark');
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      }
    }
    function applyStoredTheme() {
      const stored = getStoredTheme();
      if (stored === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      } else {
        document.documentElement.removeAttribute('data-theme');
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      }
    }
    applyStoredTheme();
    themeToggle.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      setTheme(isLight ? 'dark' : 'light');
    });
    function initCollapsibleFolders() {
      const folders = document.querySelectorAll('.tree-dir');
      folders.forEach(folder => {
        const header = folder.querySelector('.folder-header');
        const content = folder.querySelector('.folder-content');
        if (!header || !content) return;
        content.classList.remove('collapsed');
        const chevron = header.querySelector('.chevron');
        if (chevron) chevron.textContent = '▼';
        header.addEventListener('click', (e) => {
          e.stopPropagation();
          const isCollapsed = content.classList.toggle('collapsed');
          if (chevron) chevron.textContent = isCollapsed ? '▶' : '▼';
        });
      });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initCollapsibleFolders);
    } else {
      initCollapsibleFolders();
    }
    const files = ${JSON.stringify(files.map((f) => ({ r: f.relativePath, n: f.fileName })))};
    async function downloadAllAsZip() {
      const a = document.createElement('a');
      a.href = '/download-all.zip';
      a.download = 'mayo-share.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    const zipBtn = document.getElementById('downloadAllBtn');
    if (zipBtn) zipBtn.addEventListener('click', downloadAllAsZip);
  </script>
</body>
</html>`;
}