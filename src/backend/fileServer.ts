import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import { promises as fs, createReadStream, statSync } from "fs";
import path from "path";
import { EventEmitter } from "events";

interface SharedFile {
  filePath: string;
  fileName: string;
  fileSize: number;
  relativePath: string;
  downloadProgress?: number;
}

export class FileServer extends EventEmitter {
  private server: Server | null = null;
  private port: number = 3000;
  private files: SharedFile[] = [];
  private fileMap: Map<string, SharedFile> = new Map();

  async start(
    filePaths: string[],
    relativePaths?: (string | undefined)[],
    port?: number,
    ip?: string,
    message?: string,
  ): Promise<string> {
    if (this.server) throw new Error("Server already running");
    if (port) this.port = port;

    // Build file list, verify all exist
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
      };
      this.files.push(file);
      this.fileMap.set(relative, file);
    }

    return new Promise((resolve, reject) => {
      this.server = createServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          const url = req.url || "/";
          const method = req.method || "GET";

          // Serve the HTML index page
          if (url === "/" || url === "") {
            const html = buildDownloadPage(this.files);
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(html);
            return;
          }

          // Serve JSZip locally (offline) – fixed path for packaged app
          if (url === "/jszip.min.js") {
            // Use __dirname to locate the file relative to this backend module
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

          // Serve individual files: /file/ followed by the relative path
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

            const stats = statSync(fileEntry.filePath);
            const fileSize = stats.size;
            const etag = `"${fileSize}-${stats.mtimeMs}"`;

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

            // Handle partial request (range)
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
                highWaterMark: 1024 * 1024,
              });
              const fileIndex = this.files.indexOf(fileEntry);
              this.emit("download-started", fileIndex, fileEntry.fileName);
              let bytesSent = 0;
              stream.on("data", (chunk: any) => {
                const length = Buffer.isBuffer(chunk)
                  ? chunk.length
                  : Buffer.byteLength(chunk);
                bytesSent += length;
                const totalSent = start + bytesSent;
                const pct = Math.floor((totalSent / fileSize) * 100);
                this.emit("download-progress", fileEntry.fileName, pct);
              });
              stream.pipe(res);
              stream.on("error", (err) => {
                if (!res.headersSent) {
                  res.writeHead(500);
                  res.end("File read error");
                }
                console.error("Stream error:", err);
              });
              res.on("finish", () => {
                this.emit("download-completed", fileIndex, fileEntry.fileName, clientIp);
              });
              return;
            }

            res.setHeader("Content-Type", "application/octet-stream");
            res.setHeader("Content-Length", fileSize);
            let stream = createReadStream(fileEntry.filePath, { highWaterMark: 1024 * 1024 });

            const fileIndex = this.files.indexOf(fileEntry);
            this.emit("download-started", fileIndex, fileEntry.fileName);

            let bytesSent = 0;
            stream.on("data", (chunk: any) => {
              const length = Buffer.isBuffer(chunk)
                ? chunk.length
                : Buffer.byteLength(chunk);
              bytesSent += length;
              const pct = Math.floor((bytesSent / fileSize) * 100);
              this.emit("download-progress", fileEntry.fileName, pct);
            });

            stream.pipe(res);
            stream.on("error", (err) => {
              if (!res.headersSent) {
                res.writeHead(500);
                res.end("File read error");
              }
              console.error("Stream error:", err);
            });
            res.on("finish", () => {
              this.emit("download-completed", fileIndex, fileEntry.fileName, clientIp);
            });
            return;
          }

          res.writeHead(404);
          res.end("Not found");
        },
      );

      this.server.listen(this.port, "0.0.0.0", () => {
        const usedIP = ip || "192.168.137.1";
        resolve(`http://${usedIP}:${this.port}`);
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
      this.files = [];
      this.fileMap.clear();
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
    if (depth === 0) return childrenHtml; // root
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

// ─── Download Page with dark/light mode toggle, responsive design, and collapsible folders ───
function buildDownloadPage(files: SharedFile[]): string {
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
                <a href="/file/${encodeURIComponent(f.relativePath)}" download="${escapeHtml(f.fileName)}" class="download-btn">Download</a>
              </span>
            </div>
          </li>`;
      }
      return "";
    }
    fileListHtml = `<ul class="file-tree">${renderInteractiveTree(tree)}</ul>`;
  } else {
    // Responsive table: use div wrapper and adjust for mobile
    fileListHtml = `<div class="table-wrapper"><table class="file-table">
      <thead>
        <tr><th>File name</th><th>Size</th><th></th></tr>
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
      <span id="zipBtnLabel">Download All as ZIP</span>
      <span class="zip-total-size">(${formatBytes(totalSize)})</span>
    </button>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>MAYO Share</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    /* Theme variables - dark (default) */
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
      --download-bg: #b169e0;
      --download-hover: #9a4fd4;
      --download-text: #fff;
      --zip-bg: #4CAF50;
      --zip-hover: #43a047;
      --folder-header-bg: #151515;
      --folder-name-color: #fff;
      --tree-file-row-bg: #111;
      --footer-color: #444;
      --folder-header-hover-border: #b169e0;
      --table-header-bg: #1a1a1a;
    }

    /* Light theme */
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
      --download-bg: #b169e0;
      --download-hover: #9a4fd4;
      --download-text: #000;
      --zip-bg: #4CAF50;
      --zip-hover: #43a047;
      --folder-header-bg: #e8e8e8;
      --folder-name-color: #222;
      --tree-file-row-bg: #ffffff;
      --footer-color: #aaa;
      --folder-header-hover-border: #b169e0;
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
    .logo-mayo { color: #b169e0; }
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

    /* Tree styles */
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

    /* ZIP button */
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

    /* Theme toggle button */
.theme-toggle {
  position: fixed;
  top: 20px;
  right: 20px;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 50%;
  width: 44px;
  height: 44px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  transition: all 0.2s ease;
  backdrop-filter: blur(4px);
  box-shadow: 0 2px 10px rgba(0,0,0,0.3);
  background: rgba(0, 0, 0, 0.6);   
}

.theme-toggle svg {
  stroke: #FFFFFF;
  stroke-width: 2;
}

.theme-toggle:hover {
  background: rgba(0,0,0,0.8);
  transform: scale(1.05);
}

[data-theme="light"] .theme-toggle svg {
  stroke: #000000;
}

[data-theme="light"] .theme-toggle {
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

[data-theme="light"] .theme-toggle:hover {
  background: rgba(255, 255, 255, 0.9);
}
    /* Responsive design for mobile */
    @media (max-width: 600px) {
      body { padding: 20px 12px; }
      .logo { font-size: 1.6rem; }
      .subtitle { font-size: 0.9rem; }
      .card { border-radius: 12px; }
      
      /* Table becomes block layout */
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
      
      /* Tree view adjustments */
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
  <button class="theme-toggle" id="themeToggle">
  
<svg id="sunIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <path fill="none" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32" d="M256 48v48M256 416v48M403.08 108.92l-33.94 33.94M142.86 369.14l-33.94 33.94M464 256h-48M96 256H48M403.08 403.08l-33.94-33.94M142.86 142.86l-33.94-33.94"/>
  <circle cx="256" cy="256" r="80" fill="none" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32"/>
</svg>
<svg id="moonIcon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style="display: none;">
  <path d="M160 136c0-30.62 4.51-61.61 16-88C99.57 81.27 48 159.32 48 248c0 119.29 96.71 216 216 216 88.68 0 166.73-51.57 200-128-26.39 11.49-57.38 16-88 16-119.29 0-216-96.71-216-216z" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/>
</svg>

  </button>
  <div class="header">
    <div class="logo">
      <span class="logo-mayo">MAYO</span>
      <span class="logo-share">Share</span>
    </div>
    <div class="subtitle">${fileCount === 1 ? "1 file" : `${fileCount} files`} shared with you</div>
  </div>
  <div class="card">
    ${useTree ? "" : ""}
    ${fileListHtml}
    ${useTree ? "" : ""}
   ${useTree ? zipButtonHtml : ""}
  </div>
  <div class="footer">Shared via MAYO Share • Offline P2P File Transfer</div>

  <script>
    // --- Theme management with dual icons ---
    const themeToggle = document.getElementById('themeToggle');
    const sunIcon = document.getElementById('sunIcon');
    const moonIcon = document.getElementById('moonIcon');

    function getStoredTheme() {
      return localStorage.getItem('mayo-download-theme');
    }
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

    // --- Collapsible folders ---
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

    // --- Download all as ZIP (preserved) ---
    const files = ${JSON.stringify(files.map((f) => ({ r: f.relativePath, n: f.fileName })))};

    async function downloadAllAsZip() {
      const btn = document.getElementById('downloadAllBtn');
      const label = document.getElementById('zipBtnLabel');
      if (!btn || !label) return;
      btn.disabled = true;
      label.textContent = 'Building ZIP...';
      const zip = new JSZip();
      for (const file of files) {
        const resp = await fetch('/file/' + encodeURIComponent(file.r));
        const blob = await resp.blob();
        zip.file(file.r, blob);
      }
      const content = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mayo-share.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      btn.disabled = false;
      label.textContent = 'Download All as ZIP';
    }
    const zipBtn = document.getElementById('downloadAllBtn');
    if (zipBtn) zipBtn.addEventListener('click', downloadAllAsZip);
  </script>
</body>
</html>`;
}