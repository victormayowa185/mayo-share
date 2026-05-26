import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import { promises as fs } from "fs";
import path from "path";
import { EventEmitter } from "events";
import { formidable } from "formidable";

interface Session {
  id: string;
  status: "pending" | "approved" | "declined";
  senderName: string;
  saveDir: string;
  deviceType: string;
}

interface SSEClient {
  id: string;
  res: ServerResponse;
}
// This will be set dynamically when the server starts
let RECEIVE_DIR = "C:\\mayo-received";
export function setReceiveDir(path: string) {
  RECEIVE_DIR = path;
}
const PORT = 3001;

export class UploadServer extends EventEmitter {
  private server: Server | null = null;
  private sessions = new Map<string, Session>();
  private sseClients = new Map<string, SSEClient>();

  approveSender(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session && session.status === "pending") {
      session.status = "approved";
      const client = this.sseClients.get(sessionId);
      if (client) {
        client.res.write("event: approved\ndata: {}\n\n");
        client.res.end();
        this.sseClients.delete(sessionId);
      }
    }
  }

  declineSender(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session && session.status === "pending") {
      session.status = "declined";
      const client = this.sseClients.get(sessionId);
      if (client) {
        client.res.write("event: declined\ndata: {}\n\n");
        client.res.end();
        this.sseClients.delete(sessionId);
      }
    }
  }

  async start(ip?: string): Promise<string> {
    await fs.mkdir(RECEIVE_DIR, { recursive: true });
    await fs.mkdir(path.join(RECEIVE_DIR, "chunks"), { recursive: true });

    // 1. Kill any previous server still holding the port
    this.stop();
    // 2. Give the OS a moment to release the port
    await new Promise((r) => setTimeout(r, 100));

    return new Promise((resolve, reject) => {
      this.server = createServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          const getField = (val: string | string[] | undefined): string => {
            if (Array.isArray(val)) return val[0] || "";
            return val || "";
          };
          const url = req.url || "/";
          const method = req.method || "GET";

          if (method === "GET" && url === "/favicon.ico") {
            res.writeHead(204);
            res.end();
            return;
          }

          // ─── Session‑aware GET / ───
          if (
            method === "GET" &&
            (url === "/" || url === "" || url?.startsWith("/?sessionId="))
          ) {
            const parsedUrl = new URL(url!, `http://localhost:${PORT}`);
            let sessionId = parsedUrl.searchParams.get("sessionId");

            if (!sessionId) {
              sessionId =
                Date.now().toString(36) +
                Math.random().toString(36).slice(2, 6);
              res.writeHead(302, { Location: `/?sessionId=${sessionId}` });
              res.end();
              return;
            }

            let session = this.sessions.get(sessionId);
            if (!session) {
              const saveDir = path.join(RECEIVE_DIR, `Sender-${sessionId}`);
              session = {
                id: sessionId,
                status: "pending",
                senderName: "",
                saveDir,
                deviceType: "",
              };
              this.sessions.set(sessionId, session);
              this.emit("sender-connected", sessionId, session.senderName);
            }

            if (session.status === "pending") {
              res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
              });
              res.end(getWaitingHTML(session.senderName || "Unknown"));
              return;
            }

            if (session.status === "approved") {
              res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
              });
              res.end(getUploadHTML());
              return;
            }

            if (session.status === "declined") {
              res.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
              });
              res.end(getDeclinedHTML());
              return;
            }
          }

          // ─── SSE endpoint for approval / decline ───
          if (method === "GET" && url?.startsWith("/events")) {
            const parsedUrl = new URL(url!, `http://localhost:${PORT}`);
            const sessionId = parsedUrl.searchParams.get("sessionId");
            if (!sessionId || !this.sessions.has(sessionId)) {
              res.writeHead(404);
              res.end();
              return;
            }
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
              "Access-Control-Allow-Origin": "*",
            });
            res.write(":ok\n\n");
            this.sseClients.set(sessionId, { id: sessionId, res });
            req.on("close", () => {
              this.sseClients.delete(sessionId);
            });
            return;
          }

          // ─── Set sender name ───
          if (method === "POST" && url?.startsWith("/set-name")) {
            const parsedUrl = new URL(url!, `http://localhost:${PORT}`);
            const sessionId = parsedUrl.searchParams.get("sessionId");
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", () => {
              try {
                const { name, deviceType } = JSON.parse(body);
                const session = this.sessions.get(sessionId!);
                if (session) {
                  session.senderName = name;
                  if (deviceType) session.deviceType = deviceType;
                  this.emit(
                    "sender-connected",
                    sessionId,
                    name,
                    session.deviceType,
                  );
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ ok: true }));
                } else {
                  res.writeHead(404);
                  res.end();
                }
              } catch {
                res.writeHead(400);
                res.end();
              }
            });
            return;
          }

          // ─── Resumable: test chunk existence ───
          if (method === "GET" && url?.startsWith("/upload-chunk")) {
            const parsedUrl = new URL(url!, `http://localhost:${PORT}`);
            const sessionId = parsedUrl.searchParams.get("sessionId");
            const identifier =
              parsedUrl.searchParams.get("resumableIdentifier") || "";
            const chunkNumber = parsedUrl.searchParams.get(
              "resumableChunkNumber",
            );
            if (!sessionId || !this.sessions.has(sessionId)) {
              res.writeHead(404);
              res.end();
              return;
            }
            const session = this.sessions.get(sessionId)!;
            if (session.status !== "approved") {
              res.writeHead(403);
              res.end("Not approved");
              return;
            }
            const chunkDir = path.join(RECEIVE_DIR, "chunks", identifier);
            const chunkPath = path.join(chunkDir, chunkNumber || "0");
            try {
              await fs.access(chunkPath);
              res.writeHead(200);
              res.end();
            } catch {
              res.writeHead(204);
              res.end();
            }
            return;
          }

          // ─── Resumable: receive chunk ───
          if (method === "POST" && url?.startsWith("/upload-chunk")) {
            try {
              const parsedUrl = new URL(url!, `http://localhost:${PORT}`);
              const sessionId = parsedUrl.searchParams.get("sessionId") || "";
              const session = this.sessions.get(sessionId);
              if (!session || session.status !== "approved") {
                res.writeHead(403);
                res.end("Not approved");
                return;
              }

              const form = formidable({
                uploadDir: path.join(RECEIVE_DIR, "chunks"),
                keepExtensions: true,
                maxFileSize: 500 * 1024 * 1024,
                multiples: false,
              });

              const [fields, files] = await form.parse(req);

              // Safely get the uploaded chunk file
              const rawFile = files.file;
              const chunkFile = Array.isArray(rawFile) ? rawFile[0] : rawFile;
              if (!chunkFile) {
                res.writeHead(400);
                res.end("No chunk file");
                return;
              }

              const identifier = getField(fields.resumableIdentifier);
              const chunkNumber = getField(fields.resumableChunkNumber) || "0";
              const totalChunks = parseInt(
                getField(fields.resumableTotalChunks) || "0",
                10,
              );
              const originalFilename =
                getField(fields.resumableFilename) || "uploaded-file";

              const chunkDir = path.join(RECEIVE_DIR, "chunks", identifier);
              await fs.mkdir(chunkDir, { recursive: true });
              const destChunkPath = path.join(chunkDir, chunkNumber);
              await fs.rename(chunkFile.filepath, destChunkPath);

              console.log(
                `Chunk ${chunkNumber}/${totalChunks} saved. File: ${originalFilename}`,
              );

              const existingChunks = await fs.readdir(chunkDir);
              console.log(
                `Chunks on disk: ${existingChunks.length}, need: ${totalChunks}`,
              );
              if (existingChunks.length === totalChunks) {
                await fs.mkdir(session.saveDir, { recursive: true });
                const finalPath = path.join(session.saveDir, originalFilename);
                const { createWriteStream } = await import("fs");
                const writeStream = createWriteStream(finalPath);
                await new Promise<void>((resolve, reject) => {
                  writeStream.on("finish", resolve);
                  writeStream.on("error", reject);
                  (async () => {
                    // Resumable.js chunk numbers start at 1, not 0
                    for (let i = 1; i <= totalChunks; i++) {
                      const chunkPath = path.join(chunkDir, i.toString());
                      const data = await fs.readFile(chunkPath);
                      writeStream.write(data);
                      await fs.unlink(chunkPath);
                    }
                    writeStream.end();
                  })().catch(reject);
                });
                try {
                  await fs.rmdir(chunkDir);
                } catch {}
                this.emit("file-received", originalFilename);
              }
              res.writeHead(200, { "Content-Type": "text/plain" });
              res.end("Chunk received");
            } catch (e: any) {
              console.error("Chunk upload error:", e);
              res.writeHead(500);
              res.end("Chunk upload failed: " + (e.message || "unknown error"));
            }
            return;
          }

          // ─── Serve local JS libraries from node_modules (offline) ───
          if (method === "GET" && url === "/jszip.min.js") {
            const filePath = path.join(
              process.cwd(),
              "node_modules/jszip/dist/jszip.min.js",
            );
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

          if (method === "GET" && url === "/resumable.min.js") {
            // Resumable.js doesn't have a minified version; use the normal one
            const filePath = path.join(
              process.cwd(),
              "node_modules/resumablejs/resumable.js",
            );
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

          res.writeHead(404);
          res.end("Not found");
        },
      );

      this.server.listen(PORT, "0.0.0.0", () => {
        const usedIP = ip || "192.168.137.1";
        resolve(`http://${usedIP}:${PORT}`);
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
  }
}

function getUploadHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <title>Send to MAYO Share</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0A0A0A; color: white; font-family: Arial, sans-serif; padding: 40px 20px; text-align: center; }
    .logo { font-size: 2rem; font-weight: bold; color: #b169e0; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .logo svg { width: 32px; height: 32px; fill: #b169e0; }
    .subtitle { color: #888; margin-bottom: 30px; }
    .card { background: #111; border: 1px solid #222; border-radius: 16px; max-width: 520px; margin: 0 auto; padding: 32px 24px; }
    .file-section { margin-bottom: 20px; }
    label { display: block; color: #888; font-size: 0.85rem; margin-bottom: 8px; text-align: left; }
    .file-row { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
    .file-btn { padding: 10px 20px; background: #b169e0; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 0.9rem; }
    .file-btn:hover { opacity: 0.9; }
    .file-list { list-style: none; padding: 0; margin: 0 0 16px 0; }
    .file-item { display: flex; align-items: center; gap: 8px; background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 6px; padding: 8px 12px; margin-bottom: 6px; font-size: 0.85rem; }
    .file-item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ccc; text-align: left; }
    .file-item .size { color: #888; white-space: nowrap; }
    .file-item .remove-btn { background: transparent; border: none; color: #888; cursor: pointer; font-size: 1rem; padding: 0 4px; }
    .file-item .remove-btn:hover { color: #f44336; }
    .paste-toggle { display: flex; align-items: center; justify-content: space-between; color: #888; font-size: 0.85rem; margin-bottom: 8px; cursor: pointer; }
    .paste-toggle svg { width: 14px; height: 14px; transition: transform 0.2s; }
    .paste-toggle.open svg { transform: rotate(90deg); }
    .paste-area { width: 100%; min-height: 80px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #ccc; padding: 12px; font-size: 0.9rem; text-align: left; outline: none; display: none; }
    .paste-area.open { display: block; }
    .btn { width: auto; padding: 14px 32px; background: #b169e0; color: white; border: none; border-radius: 30px; font-size: 1rem; display: inline-block; cursor: pointer; margin-top: 16px; }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    #status { margin-top: 20px; color: #aaa; font-size: 0.95rem; display: flex; align-items: center; justify-content: center; gap: 6px; }
    #status svg { width: 18px; height: 18px; }
    .success-icon { color: #4CAF50; }
    #thumbs img { max-width: 80px; max-height: 80px; margin: 4px; border-radius: 4px; }
    .progress-bar { width: 100%; background: #333; border-radius: 8px; height: 8px; margin: 12px 0; overflow: hidden; display: none; }
    .progress-bar .fill { height: 100%; background: #b169e0; width: 0%; transition: width 0.2s; }
    .mayo-text { color: #b169e0; }
.share-text { color: #fff; }
  </style>
</head>
<body>
  <div class="logo">
  <svg viewBox="0 0 400 354.74" xmlns="http://www.w3.org/2000/svg">
    <circle cx="200" cy="177" r="150" fill="currentColor"/>
  </svg>
  <span class="mayo-text">MAYO</span>
  <span class="share-text">Share</span>
</div>
  <div class="subtitle">Send files to this laptop</div>
  <div class="card">
    <!-- File selection -->
    <div class="file-section">
      <label>Add files or folders:</label>
      <div class="file-row">
        <button class="file-btn" id="addFilesBtn">Add Files</button>
        <button class="file-btn" id="addFolderBtn">Add Folder</button>
      </div>
      <ul class="file-list" id="fileList"></ul>
    </div>

    <!-- Paste section -->
  <!-- Paste section -->
<div class="file-section">
  <label>Paste text or image (Ctrl+V):</label>
  <div class="paste-area open" id="pasteArea" contenteditable="true" style="display:block;" placeholder="Paste text here, or paste an image"></div>
  <div id="thumbs"></div>
</div>

    <button class="btn" id="sendBtn">Send</button>
    <div class="progress-bar" id="progressBar">
      <div class="fill" id="progressFill"></div>
    </div>
    <div id="status"></div>
  </div>

  <!-- LOCAL libraries (served from node_modules) for offline use -->
  <script src="/jszip.min.js"></script>
  <script src="/resumable.min.js"></script>
  <script>
    const addFilesBtn = document.getElementById('addFilesBtn');
    const addFolderBtn = document.getElementById('addFolderBtn');
    const fileListEl = document.getElementById('fileList');
    const pasteArea = document.getElementById('pasteArea');
    const sendBtn = document.getElementById('sendBtn');
    const status = document.getElementById('status');
    const thumbs = document.getElementById('thumbs');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;

    const folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.multiple = true;
    folderInput.webkitdirectory = true;

    let fileEntries = [];
    let pastedImageData = null;

    const sessionId = new URLSearchParams(location.search).get('sessionId');

    function renderFileList() {
      fileListEl.innerHTML = '';
      fileEntries.forEach((entry, idx) => {
        const li = document.createElement('li');
        li.className = 'file-item';
        li.innerHTML = '<span class="name">' + entry.name + '</span>' +
          '<span class="size">' + formatBytes(entry.file.size) + '</span>' +
          '<button class="remove-btn" data-index="' + idx + '">\u2715</button>';
        fileListEl.appendChild(li);
      });
      document.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const index = parseInt(e.target.dataset.index);
          fileEntries.splice(index, 1);
          renderFileList();
        });
      });
    }

    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function addFilesFromInput(input) {
      for (const file of input.files) {
        const relativePath = file.webkitRelativePath || file.name;
        fileEntries.push({ name: relativePath, file, relativePath });
      }
      renderFileList();
      input.value = '';
    }

    addFilesBtn.addEventListener('click', () => fileInput.click());
    addFolderBtn.addEventListener('click', () => folderInput.click());
    fileInput.addEventListener('change', () => addFilesFromInput(fileInput));
    folderInput.addEventListener('change', () => addFilesFromInput(folderInput));

    // Improved paste handler: supports both images and text
    pasteArea.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        // Handle image paste
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          const reader = new FileReader();
          reader.onload = () => {
            pastedImageData = reader.result;
            const img = document.createElement('img');
            img.src = reader.result;
            thumbs.innerHTML = '';
            thumbs.appendChild(img);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }

      // If we reach here, it's text. Prevent default and insert manually.
      e.preventDefault();
      const text = e.clipboardData?.getData('text/plain');
      if (text) {
        document.execCommand('insertText', false, text);
      }
    });

    // Resumable configuration
    const resumable = new Resumable({
      target: '/upload-chunk?sessionId=' + sessionId,
      chunkSize: 1 * 1024 * 1024,  // 1 MB chunks
      simultaneousUploads: 3,
      testChunks: true,            // allow resume
      query: { sessionId: sessionId },
    });

    resumable.on('fileAdded', (file) => {
      // file is already in resumable's queue; we don't need to do anything
    });

    resumable.on('progress', () => {
      const pct = Math.floor(resumable.progress() * 100);
      progressFill.style.width = pct + '%';
      status.textContent = 'Uploading... ' + pct + '%';
    });

    resumable.on('complete', () => {
      status.innerHTML = '<svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Sent successfully!';
      progressBar.style.display = 'none';
      fileEntries = [];
      renderFileList();
      pasteArea.innerHTML = '';
      thumbs.innerHTML = '';
      pastedImageData = null;
      sendBtn.disabled = false;
    });

    resumable.on('error', (message, file) => {
      status.textContent = 'Upload error: ' + message;
      sendBtn.disabled = false;
    });

    sendBtn.addEventListener('click', async () => {
      const text = pasteArea.innerText.trim();
      if (fileEntries.length === 0 && !pastedImageData && !text) {
        status.textContent = 'Please add files or paste something first.';
        return;
      }
      sendBtn.disabled = true;
      status.textContent = 'Preparing...';
      progressBar.style.display = 'block';
      progressFill.style.width = '0%';

      try {
        // 1. Single file (no text, no image)
        if (fileEntries.length === 1 && !pastedImageData && !text) {
          const entry = fileEntries[0];
          resumable.addFile(entry.file);
          resumable.upload();
          status.textContent = 'Starting upload...';
          return;
        }

        // 2. Only text (no files, no image)
        if (fileEntries.length === 0 && text && !pastedImageData) {
          const blob = new Blob([text], { type: 'text/plain' });
          const txtName = 'pasted-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
          const file = new File([blob], txtName, { type: 'text/plain' });
          resumable.addFile(file);
          resumable.upload();
          status.textContent = 'Starting upload...';
          return;
        }

        // 3. Only pasted image (no files, no text)
        if (fileEntries.length === 0 && pastedImageData && !text) {
          const response = await fetch(pastedImageData);
          const blob = await response.blob();
          const imgName = 'screenshot-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
          const file = new File([blob], imgName, { type: 'image/png' });
          resumable.addFile(file);
          resumable.upload();
          status.textContent = 'Starting upload...';
          return;
        }

        // 4. Mixed content (multiple files, or files+text, or files+image) → ZIP
        const zip = new JSZip();
        for (const entry of fileEntries) {
          zip.file(entry.relativePath, entry.file);
        }
        if (pastedImageData) {
          const base64 = pastedImageData.split(',')[1];
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          zip.file('screenshot-' + timestamp + '.png', base64, { base64: true });
        }
        if (text) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          zip.file('pasted-' + timestamp + '.txt', text);
        }

        const blob = await zip.generateAsync({ type: 'blob' });

        // Try to use folder name for the zip file if all files share the same top folder
        let folderName = null;
        if (fileEntries.length > 0) {
          const firstPath = fileEntries[0].relativePath;
          const parts = firstPath.split('/');
          if (parts.length > 1) {
            folderName = parts[0];
            let sameFolder = true;
            for (const entry of fileEntries) {
              const entryParts = entry.relativePath.split('/');
              if (entryParts.length < 2 || entryParts[0] !== folderName) {
                sameFolder = false;
                break;
              }
            }
            if (!sameFolder) folderName = null;
          }
        }

        let zipName;
        if (folderName) {
          zipName = folderName + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip';
        } else {
          zipName = 'mayo-share-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip';
        }

        const file = new File([blob], zipName, { type: 'application/zip' });
        resumable.addFile(file);
        resumable.upload();
        status.textContent = 'Starting upload...';
      } catch (err) {
        status.textContent = 'Preparation error: ' + err.message;
        sendBtn.disabled = false;
      }
    });
  </script>
  <script>
  window.addEventListener('load', function() {
    var tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.from('.logo', { opacity: 0, y: -20, duration: 0.5 });
    tl.from('.subtitle', { opacity: 0, y: 10, duration: 0.4 }, '-=0.3');
    tl.from('.card', { opacity: 0, y: 30, duration: 0.5 }, '-=0.2');
    tl.from('.file-section, .btn, #status', { opacity: 0, y: 10, duration: 0.3, stagger: 0.1 }, '-=0.3');
  });
</script>
</body>
</html>`;
}

function getWaitingHTML(name: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Waiting for Approval – MAYO Share</title>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0A0A0A; color: white; font-family: Arial, sans-serif; padding: 40px 20px; text-align: center; }
    .logo { font-size: 2rem; font-weight: bold; color: #b169e0; margin-bottom: 8px; }
    .subtitle { color: #888; margin-bottom: 30px; }
    .spinner { border: 3px solid #333; border-top: 3px solid #b169e0; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; display: none; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .input-group { margin: 16px auto; max-width: 300px; }
    .input-group input {
      width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #333;
      background: #1a1a1a; color: white; font-size: 1rem; text-align: center;
    }
      .mayo-text { color: #b169e0; }
.share-text { color: #fff; }
    .btn {
      width: auto; padding: 14px; background: #b169e0; color: white; border: none; display: inline-block;
      border-radius: 30px; font-size: 1rem; cursor: pointer; margin-top: 12px;
    }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .waiting-text { display: none; color: #aaa; }
  </style>
</head>
<body>
<div class="logo">
  <span class="mayo-text">MAYO</span>
  <span class="share-text">Share</span>
</div>
  <div class="subtitle">Hi ${name || "there"}!</div>
  <div id="nameForm">
    <p style="color:#aaa; margin-bottom:12px;">Enter your name to request approval:</p>
    <div class="input-group">
      <input type="text" id="senderName" placeholder="Your name" autofocus />
    </div>
    <button class="btn" id="requestBtn">Request Approval</button>
  </div>
  <div id="waitingSection" style="display:none;">
    <p class="waiting-text">Waiting for the receiver to approve your connection…</p>
    <div class="spinner" style="display:block;"></div>
  </div>
  <script>
    const sessionId = new URLSearchParams(location.search).get('sessionId');
    const nameForm = document.getElementById('nameForm');
    const waitingSection = document.getElementById('waitingSection');
    const requestBtn = document.getElementById('requestBtn');
    const senderNameInput = document.getElementById('senderName');

    function detectDeviceType() {
      const ua = navigator.userAgent;
      if (/Mobi|Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
        if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) {
          return 'tablet';
        }
        return 'phone';
      }
      return 'desktop';
    }

    requestBtn.addEventListener('click', async () => {
      const name = senderNameInput.value.trim();
      if (!name) return alert('Please enter a name.');
      requestBtn.disabled = true;
      const deviceType = detectDeviceType();
      try {
        const resp = await fetch('/set-name?sessionId=' + sessionId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, deviceType })
        });
        if (resp.ok) {
          nameForm.style.display = 'none';
          waitingSection.style.display = 'block';
          // Now listen for approval via SSE
          const evtSource = new EventSource('/events?sessionId=' + sessionId);
          evtSource.addEventListener('approved', () => {
            location.reload();
          });
          evtSource.addEventListener('declined', () => {
            document.body.innerHTML = '<h1>Declined</h1><p style="color:#aaa;">The receiver declined your request.</p>';
            evtSource.close();
          });
        } else {
          alert('Failed to send request. Please try again.');
          requestBtn.disabled = false;
        }
      } catch (err) {
        alert('Network error: ' + err.message);
        requestBtn.disabled = false;
      }
    });
  </script>
  <script>
  window.addEventListener('load', function() {
    var tl = gsap.timeline({ defaults: { ease: 'power2.out' } });
    tl.from('.logo', { opacity: 0, y: -20, duration: 0.5 });
    tl.from('.subtitle', { opacity: 0, y: 10, duration: 0.4 }, '-=0.3');
    tl.from('#nameForm', { opacity: 0, y: 20, duration: 0.4 }, '-=0.2');
    // If the waiting section is already visible, animate it too
    if (document.getElementById('waitingSection').style.display !== 'none') {
      tl.from('#waitingSection', { opacity: 0, y: 10, duration: 0.3 }, '-=0.2');
    }
  });
</script>
</body>
</html>`;
}

function getDeclinedHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Declined – MAYO Share</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0A0A0A; color: white; font-family: Arial, sans-serif; padding: 40px 20px; text-align: center; }
    .logo { font-size: 2rem; font-weight: bold; color: #b169e0; margin-bottom: 8px; }
  </style>
</head>
<body>
  <div class="logo">MAYO Share</div>
  <h1>Declined</h1>
  <p style="color:#aaa; margin-top:10px;">The receiver declined your request.</p>
</body>
</html>`;
}
