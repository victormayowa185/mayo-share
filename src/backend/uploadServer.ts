import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import { promises as fs, statfs } from "fs";
import path from "path";
import { EventEmitter } from "events";
import { formidable } from "formidable";
import { promisify } from "util";

const statfsAsync = promisify(statfs);

function formatBytesServer(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

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
    this.stop();
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
            req.on("close", () => this.sseClients.delete(sessionId));
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

          // ─── Simple text/image upload endpoint (bypasses Resumable) ───
          if (method === "POST" && url?.startsWith("/upload-simple")) {
            const parsedUrl = new URL(url!, `http://localhost:${PORT}`);
            const sessionId = parsedUrl.searchParams.get("sessionId");
            const session = this.sessions.get(sessionId || "");
            if (!session || session.status !== "approved") {
              res.writeHead(403);
              res.end("Not approved");
              return;
            }
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", async () => {
              try {
                const { content, filename } = JSON.parse(body);
                const buffer = Buffer.from(content, "base64");
                await fs.mkdir(session.saveDir, { recursive: true });
                const savePath = path.join(session.saveDir, filename);
                await fs.writeFile(savePath, buffer);
                this.emit("file-received", filename);
                res.writeHead(200);
                res.end("OK");
              } catch (err) {
                console.error("Simple upload error:", err);
                res.writeHead(500);
                res.end("Error saving file");
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
              let originalFilename =
                getField(fields.resumableFilename) || "uploaded-file";

              if (chunkNumber === "1") {
                const totalSize = parseInt(
                  getField(fields.resumableTotalSize) || "0",
                  10,
                );
                if (totalSize > 0) {
                  const stats = await statfsAsync(RECEIVE_DIR);
                  const freeBytes = stats.bfree * stats.bsize;
                  const safetyMargin = 100 * 1024 * 1024;
                  if (freeBytes < totalSize + safetyMargin) {
                    res.writeHead(507, { "Content-Type": "text/plain" });
                    res.end(
                      `Insufficient disk space. Need at least ${formatBytesServer(totalSize + safetyMargin)} free.`,
                    );
                    return;
                  }
                }
              }

              originalFilename = originalFilename
                .replace(/[<>:"|?*]/g, "_")
                .replace(/\.{2,}/g, ".")
                .replace(/\s+/g, " ")
                .trim();

              const chunkDir = path.join(RECEIVE_DIR, "chunks", identifier);
              await fs.mkdir(chunkDir, { recursive: true });
              const destChunkPath = path.join(chunkDir, chunkNumber);
              await fs.rename(chunkFile.filepath, destChunkPath);

              console.log(
                `Chunk ${chunkNumber}/${totalChunks} saved. File: ${originalFilename}`,
              );
              const existingChunks = await fs.readdir(chunkDir);
              if (existingChunks.length === totalChunks) {
                await fs.mkdir(session.saveDir, { recursive: true });
                const finalPath = path.join(session.saveDir, originalFilename);
                const { createWriteStream } = await import("fs");
                const writeStream = createWriteStream(finalPath);
                await new Promise<void>((resolve, reject) => {
                  writeStream.on("finish", resolve);
                  writeStream.on("error", reject);
                  (async () => {
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
    .paste-area { width: 100%; min-height: 80px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #ccc; padding: 12px; font-size: 0.9rem; text-align: left; outline: none; display: block; }
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
    .action-buttons-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
    .small-icon-btn { background: transparent; border: none; cursor: pointer; padding: 4px; display: inline-flex; align-items: center; color: #ccc; }
    .small-icon-btn:hover { color: #b169e0; }
    .inline-edit { display: flex; flex-direction: column; gap: 8px; width: 100%; }
    .inline-edit textarea { background: #111; border: 1px solid #333; color: #ccc; padding: 8px; border-radius: 6px; font-family: monospace; font-size: 0.85rem; resize: vertical; }
    .inline-edit-actions { display: flex; gap: 8px; justify-content: flex-end; }
  </style>
</head>
<body>
  <div class="logo">
    <svg viewBox="0 0 400 354.74" xmlns="http://www.w3.org/2000/svg"><circle cx="200" cy="177" r="150" fill="currentColor"/></svg>
    <span class="mayo-text">MAYO</span><span class="share-text">Share</span>
  </div>
  <div class="subtitle">Send files to this laptop</div>
  <div class="card">
    <div class="file-section">
      <label>Add files or folders:</label>
      <div class="file-row">
        <button class="file-btn" id="addFilesBtn">Add Files</button>
        <button class="file-btn" id="addFolderBtn">Add Folder</button>
      </div>
      <ul class="file-list" id="fileList"></ul>
    </div>
    <div class="file-section">
      <label>Paste text or image (Ctrl+V):</label>
      <div class="paste-area" id="pasteArea" contenteditable="true" placeholder="Paste text here, or paste an image"></div>
      <div class="action-buttons-row">
        <button class="small-icon-btn" id="addTextAsFileBtn" title="Add text as file">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        </button>
        <span style="color:#555; font-size:0.8rem;">Add as file</span>
      </div>
      <div id="thumbs"></div>
    </div>
    <button class="btn" id="sendBtn">Send</button>
    <div class="progress-bar" id="progressBar"><div class="fill" id="progressFill"></div></div>
    <div id="status"></div>
  </div>
  <script src="/jszip.min.js"></script>
  <script src="/resumable.min.js"></script>
  <script>
    console.log("=== Upload page loaded ===");
    const addFilesBtn = document.getElementById('addFilesBtn');
    const addFolderBtn = document.getElementById('addFolderBtn');
    const fileListEl = document.getElementById('fileList');
    const pasteArea = document.getElementById('pasteArea');
    const sendBtn = document.getElementById('sendBtn');
    const status = document.getElementById('status');
    const thumbs = document.getElementById('thumbs');
    const progressBar = document.getElementById('progressBar');
    const progressFill = document.getElementById('progressFill');
    const addTextAsFileBtn = document.getElementById('addTextAsFileBtn');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    const folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.multiple = true;
    folderInput.webkitdirectory = true;

    let fileEntries = [];
    let pastedImageData = null;
    let lastBytes = 0, lastTime = Date.now(), currentSpeed = 0, totalSize = 0;
    let editingFileId = null, editContent = '';
    const sessionId = new URLSearchParams(location.search).get('sessionId');
    console.log("Session ID:", sessionId);

    function sanitizeId(id) { return id.replace(/\\./g, '_'); }
    function escapeHtml(str) { return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;'); }
    function formatBytes(bytes) { if (bytes===0) return '0 B'; const k=1024,sizes=['B','KB','MB','GB']; const i=Math.floor(Math.log(bytes)/Math.log(k)); return parseFloat((bytes/Math.pow(k,i)).toFixed(1))+' '+sizes[i]; }

    function renderFileList() {
      fileListEl.innerHTML = '';
      fileEntries.forEach(entry => {
        const li = document.createElement('li');
        li.className = 'file-item';
        if (editingFileId === entry.id) {
          const safeId = sanitizeId(entry.id);
          li.innerHTML = \`
            <div class="inline-edit">
              <textarea id="edit-textarea-\${safeId}" rows="3">\${escapeHtml(editContent)}</textarea>
              <div class="inline-edit-actions">
                <button class="small-icon-btn save-edit-btn" data-id="\${entry.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg></button>
                <button class="small-icon-btn cancel-edit-btn" data-id="\${entry.id}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
              </div>
            </div>\`;
          fileListEl.appendChild(li);
          const textarea = li.querySelector('#edit-textarea-'+safeId);
          textarea.addEventListener('input', e => { editContent = e.target.value; });
          li.querySelector('.save-edit-btn').addEventListener('click', () => saveEditedText(entry.id));
          li.querySelector('.cancel-edit-btn').addEventListener('click', () => { editingFileId = null; renderFileList(); });
        } else {
          li.innerHTML = '<span class="name">'+escapeHtml(entry.name)+'</span><span class="size">'+formatBytes(entry.file.size)+'</span>' +
            (entry.name.startsWith('pasted-') && entry.name.endsWith('.txt') ?
              '<button class="edit-btn small-icon-btn" data-id="'+entry.id+'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l4 4-7 7H10v-4l7-7z M15 8l-6 6M21 21H3"/></svg></button>' : '') +
            '<button class="remove-btn" data-id="'+entry.id+'">✕</button>';
          fileListEl.appendChild(li);
        }
      });
      document.querySelectorAll('.remove-btn').forEach(btn => btn.addEventListener('click', () => { fileEntries = fileEntries.filter(f => f.id !== btn.dataset.id); renderFileList(); }));
      document.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', async () => {
        const entry = fileEntries.find(f => f.id === btn.dataset.id);
        if (entry && entry.name.endsWith('.txt')) {
          editContent = await entry.file.text();
          editingFileId = entry.id;
          renderFileList();
        }
      }));
    }

    async function saveEditedText(fileId) {
      const entry = fileEntries.find(f => f.id === fileId);
      if (!entry) return;
      const newBlob = new Blob([editContent], { type: 'text/plain' });
      const newFile = new File([newBlob], entry.name, { type: 'text/plain' });
      entry.file = newFile;
      entry.size = newFile.size;
      editingFileId = null;
      renderFileList();
    }

    function addFilesFromInput(input) {
      for (const file of input.files) {
        fileEntries.push({ name: file.webkitRelativePath || file.name, file, relativePath: file.webkitRelativePath || file.name, id: Date.now().toString()+Math.random(), size: file.size });
      }
      renderFileList();
      input.value = '';
    }

    addFilesBtn.addEventListener('click', () => fileInput.click());
    addFolderBtn.addEventListener('click', () => folderInput.click());
    fileInput.addEventListener('change', () => addFilesFromInput(fileInput));
    folderInput.addEventListener('change', () => addFilesFromInput(folderInput));

    function addTextAsFile() {
      const text = pasteArea.innerText.trim();
      if (!text) return;
      const blob = new Blob([text], { type: 'text/plain' });
      const txtName = 'pasted-'+new Date().toISOString().replace(/[:.]/g, '-')+'.txt';
      const file = new File([blob], txtName, { type: 'text/plain' });
      fileEntries.push({ id: Date.now().toString()+Math.random(), name: txtName, file, relativePath: txtName, size: blob.size });
      pasteArea.innerHTML = '';
      renderFileList();
    }
    addTextAsFileBtn.addEventListener('click', addTextAsFile);

    pasteArea.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file') {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            fileEntries.push({ id: Date.now().toString()+Math.random(), name: file.name, file, relativePath: file.name, size: file.size });
          }
          renderFileList();
          return;
        }
      }
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) {
            const reader = new FileReader();
            reader.onload = () => { pastedImageData = reader.result; thumbs.innerHTML = '<img src="'+reader.result+'"/>'; };
            reader.readAsDataURL(blob);
          }
          return;
        }
      }
      for (const item of items) {
        if (item.type === 'text/plain' || item.kind === 'string') {
          e.preventDefault();
          item.getAsString(text => { pasteArea.innerText += text; });
          return;
        }
      }
    });

    const resumable = new Resumable({ target: '/upload-chunk?sessionId='+sessionId, chunkSize: 10*1024*1024, simultaneousUploads: 8, testChunks: true, query: { sessionId } });
    resumable.on('progress', () => {
      const pct = Math.floor(resumable.progress()*100);
      progressFill.style.width = pct+'%';
      const now = Date.now();
      const elapsed = (now - lastTime)/1000;
      if (totalSize===0) totalSize = resumable.getSize();
      const bytesUploaded = totalSize * resumable.progress();
      const deltaBytes = bytesUploaded - lastBytes;
      if (elapsed >= 0.5) {
        currentSpeed = deltaBytes/elapsed/(1024*1024);
        lastBytes = bytesUploaded;
        lastTime = now;
      }
      const speedText = currentSpeed>0 ? ' – '+currentSpeed.toFixed(1)+' MB/s' : '';
      status.textContent = 'Uploading... '+pct+'%'+speedText;
    });
    resumable.on('complete', () => {
      status.innerHTML = '<svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Sent successfully!';
      progressBar.style.display = 'none';
      fileEntries = []; renderFileList(); pasteArea.innerHTML = ''; thumbs.innerHTML = ''; pastedImageData = null; sendBtn.disabled = false;
      lastBytes = 0; currentSpeed = 0; totalSize = 0; lastTime = Date.now();
      resumable.cancel();
    });
    resumable.on('error', (message) => { status.textContent = 'Upload error: '+message; sendBtn.disabled = false; resumable.cancel(); });

    sendBtn.addEventListener('click', async () => {
      console.log("=== Send button clicked ===");
      let text = pasteArea.innerText.trim();
      if (!text) text = pasteArea.textContent.trim();
      if (!text) text = pasteArea.innerText.trim();
      console.log("Extracted text:", JSON.stringify(text));
      console.log("File entries count:", fileEntries.length);
      console.log("Pasted image data:", !!pastedImageData);

      if (fileEntries.length === 0 && !pastedImageData && !text) {
        status.textContent = 'Please add files, paste text, or paste an image.';
        return;
      }
      sendBtn.disabled = true;
      status.textContent = 'Preparing...';
      progressBar.style.display = 'block';
      progressFill.style.width = '0%';
      lastBytes = 0; lastTime = Date.now(); currentSpeed = 0; totalSize = 0;

      try {
        // 1. Single file only → Resumable
                // 1. Single file only → send via simple upload (fast, one-click)
        if (fileEntries.length === 1 && !pastedImageData && !text) {
          console.log("Branch: Single file (direct fetch)");
          const entry = fileEntries[0];
          // Read the file as base64
          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const base64Content = reader.result.split(',')[1]; // remove data URL prefix
              const filename = entry.name;
              const response = await fetch('/upload-simple?sessionId='+sessionId, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: base64Content, filename })
              });
              if (response.ok) {
                status.innerHTML = '<svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Sent successfully!';
                progressBar.style.display = 'none';
              } else {
                const errText = await response.text();
                status.textContent = 'Upload failed: '+response.status+' '+errText;
              }
            } catch (err) {
              status.textContent = 'Upload error: ' + err.message;
            }
            fileEntries = []; renderFileList(); pasteArea.innerHTML = ''; thumbs.innerHTML = '';
            pastedImageData = null;
            sendBtn.disabled = false;
          };
          reader.readAsDataURL(entry.file);
          status.textContent = 'Uploading...';
          return;
        }

        // 2. Only text (no files, no image)
        if (fileEntries.length === 0 && text && !pastedImageData) {
          console.log("Branch: Text only (direct fetch)");
          const content = btoa(unescape(encodeURIComponent(text)));
          const filename = 'pasted-'+new Date().toISOString().replace(/[:.]/g, '-')+'.txt';
          const url = '/upload-simple?sessionId='+sessionId;
          console.log("Fetching:", url);
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, filename })
          });
          console.log("Response status:", response.status);
          if (response.ok) {
            const respText = await response.text();
            console.log("Response OK:", respText);
            status.innerHTML = '<svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Sent successfully!';
            pasteArea.innerHTML = '';
            thumbs.innerHTML = '';
            progressBar.style.display = 'none';
          } else {
            const errText = await response.text();
            console.error("Fetch failed:", response.status, errText);
            status.textContent = 'Upload failed: '+response.status+' '+errText;
          }
          sendBtn.disabled = false;
          return;
        }

        // 3. Only image (no files, no text)
        if (fileEntries.length === 0 && pastedImageData && !text) {
          console.log("Branch: Image only (direct fetch)");
          const base64 = pastedImageData.split(',')[1];
          const filename = 'screenshot-'+new Date().toISOString().replace(/[:.]/g, '-')+'.png';
          const response = await fetch('/upload-simple?sessionId='+sessionId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: base64, filename })
          });
          if (response.ok) {
            status.innerHTML = '<svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Sent successfully!';
            thumbs.innerHTML = '';
            progressBar.style.display = 'none';
          } else {
            const errText = await response.text();
            status.textContent = 'Upload failed: '+response.status+' '+errText;
          }
          pastedImageData = null;
          sendBtn.disabled = false;
          return;
        }

        // 4. Mixed content → ZIP via Resumable
        console.log("Branch: Mixed content (ZIP + Resumable)");
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
        let folderName = null;
        if (fileEntries.length > 0) {
          const firstPath = fileEntries[0].relativePath;
          const parts = firstPath.split('/');
          if (parts.length > 1) {
            folderName = parts[0];
            let sameFolder = true;
            for (const entry of fileEntries) {
              const entryParts = entry.relativePath.split('/');
              if (entryParts.length < 2 || entryParts[0] !== folderName) { sameFolder = false; break; }
            }
            if (!sameFolder) folderName = null;
          }
        }
        const zipName = folderName ? folderName+'-'+new Date().toISOString().replace(/[:.]/g, '-')+'.zip' : 'mayo-share-'+new Date().toISOString().replace(/[:.]/g, '-')+'.zip';
        fileEntries = []; renderFileList(); pasteArea.innerHTML = ''; thumbs.innerHTML = ''; pastedImageData = null;
        const file = new File([blob], zipName, { type: 'application/zip' });
        resumable.addFile(file);
        resumable.upload();
        status.textContent = 'Starting upload...';
      } catch (err) {
        console.error("Exception in sendBtn:", err);
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
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
  <title>Waiting for Approval – MAYO Share</title>
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
