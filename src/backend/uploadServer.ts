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
const RECEIVE_DIR = "C:\\mayo-received";
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

    // 1. Kill any previous server still holding the port
    this.stop();
    // 2. Give the OS a moment to release the port
    await new Promise((r) => setTimeout(r, 100));

    return new Promise((resolve, reject) => {
      this.server = createServer(
        async (req: IncomingMessage, res: ServerResponse) => {
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

          // ─── Upload handler (modified to use session save dir) ───
          if (method === "POST" && url === "/upload") {
            try {
              const parsedUrl = new URL(req.url!, `http://localhost:${PORT}`);
              const sessionId = parsedUrl.searchParams.get("sessionId") || "";
              const session = this.sessions.get(sessionId);
              if (!session || session.status !== "approved") {
                res.writeHead(403);
                res.end("Not approved");
                return;
              }

              const form = formidable({
                uploadDir: session.saveDir,
                keepExtensions: true,
                maxFileSize: 500 * 1024 * 1024,
                multiples: true,
              });

              const [fields, files] = await form.parse(req);

              // Handle pasted text
              const textField = fields.text;
              if (textField) {
                const textContent = Array.isArray(textField)
                  ? textField[0]
                  : textField;
                const timestamp = new Date()
                  .toISOString()
                  .replace(/[:.]/g, "-");
                const fileName = `pasted-${timestamp}.txt`;
                await fs.writeFile(
                  path.join(session.saveDir, fileName),
                  textContent,
                  "utf8",
                );
                this.emit("file-received", fileName);
              }

              // Handle pasted image
              const imageField = fields.image;
              if (imageField) {
                const rawImage = Array.isArray(imageField)
                  ? imageField[0]
                  : imageField;
                const base64Data = rawImage.replace(
                  /^data:image\/\w+;base64,/,
                  "",
                );
                const buffer = Buffer.from(base64Data, "base64");
                const timestamp = new Date()
                  .toISOString()
                  .replace(/[:.]/g, "-");
                const fileName = `screenshot-${timestamp}.png`;
                await fs.writeFile(
                  path.join(session.saveDir, fileName),
                  buffer,
                );
                this.emit("file-received", fileName);
              }

              // Handle regular file uploads
              const uploadedFiles = files.fileupload;
              if (uploadedFiles) {
                const fileList = Array.isArray(uploadedFiles)
                  ? uploadedFiles
                  : [uploadedFiles];
                for (const f of fileList) {
                  const originalName =
                    f.originalFilename || f.newFilename || "unknown";
                  const destPath = path.join(session.saveDir, originalName);
                  await fs.mkdir(path.dirname(destPath), { recursive: true });
                  await fs.rename(f.filepath, destPath);
                  this.emit("file-received", originalName);
                }
              }

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ status: "ok" }));
            } catch (e: any) {
              console.error("Upload error:", e);
              res.writeHead(500);
              res.end("Upload failed: " + (e.message || "unknown error"));
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
    .btn { width: 100%; padding: 14px; background: #b169e0; color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; margin-top: 16px; }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    #status { margin-top: 20px; color: #aaa; font-size: 0.95rem; display: flex; align-items: center; justify-content: center; gap: 6px; }
    #status svg { width: 18px; height: 18px; }
    .success-icon { color: #4CAF50; }
    #thumbs img { max-width: 80px; max-height: 80px; margin: 4px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="logo">
    <svg viewBox="0 0 400 354.74" xmlns="http://www.w3.org/2000/svg">
      <circle cx="200" cy="177" r="150" fill="currentColor"/>
    </svg>
    MAYO Share
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
    <div class="file-section">
      <div class="paste-toggle" id="pasteToggle">
        <span>Paste text or image</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6"/>
        </svg>
      </div>
      <div class="paste-area" id="pasteArea" contenteditable="true" placeholder="Paste text here, or paste an image (Ctrl+V)"></div>
      <div id="thumbs"></div>
    </div>

    <button class="btn" id="sendBtn">Send</button>
    <div id="status"></div>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
  <script>
    const addFilesBtn = document.getElementById('addFilesBtn');
    const addFolderBtn = document.getElementById('addFolderBtn');
    const fileListEl = document.getElementById('fileList');
    const pasteToggle = document.getElementById('pasteToggle');
    const pasteArea = document.getElementById('pasteArea');
    const sendBtn = document.getElementById('sendBtn');
    const status = document.getElementById('status');
    const thumbs = document.getElementById('thumbs');

    // Hidden file inputs
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;

    const folderInput = document.createElement('input');
    folderInput.type = 'file';
    folderInput.multiple = true;
    folderInput.webkitdirectory = true;

    // Internal storage: { name, file, relativePath }
    let fileEntries = [];
    let pastedImageData = null;

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

    // Paste toggle
    pasteToggle.addEventListener('click', () => {
      pasteArea.classList.toggle('open');
      pasteToggle.classList.toggle('open');
    });

    // Handle paste into the editable div
    pasteArea.addEventListener('paste', (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
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
    });

    sendBtn.addEventListener('click', async () => {
      const formData = new FormData();
      let hasContent = false;

      if (fileEntries.length > 0) {
        const zip = new JSZip();
        fileEntries.forEach(entry => {
          zip.file(entry.relativePath, entry.file);
        });

        if (pastedImageData) {
          const base64 = pastedImageData.split(',')[1];
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          zip.file('screenshot-' + timestamp + '.png', base64, { base64: true });
        }

        const text = pasteArea.innerText.trim();
        if (text) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          zip.file('pasted-' + timestamp + '.txt', text);
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const zipName = 'mayo-share-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip';
        formData.append('fileupload', blob, zipName);
        hasContent = true;
      } else {
        if (pastedImageData) {
          const base64 = pastedImageData.split(',')[1];
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const blob = new Blob([atob(base64)], { type: 'image/png' });
          formData.append('fileupload', blob, 'screenshot-' + timestamp + '.png');
          hasContent = true;
        }
        const text = pasteArea.innerText.trim();
        if (text) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const blob = new Blob([text], { type: 'text/plain' });
          formData.append('fileupload', blob, 'pasted-' + timestamp + '.txt');
          hasContent = true;
        }
      }

      if (!hasContent) {
        status.textContent = 'Please add files or paste something first.';
        return;
      }

      sendBtn.disabled = true;
      status.innerHTML = 'Sending...';

      try {
        const resp = await fetch('/upload', { method: 'POST', body: formData });
        if (resp.ok) {
          status.innerHTML = '<svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Sent successfully!';
          fileEntries = [];
          renderFileList();
          pasteArea.innerHTML = '';
          thumbs.innerHTML = '';
          pastedImageData = null;
        } else {
          const msg = await resp.text();
          status.textContent = 'Error ' + resp.status + ': ' + msg;
        }
      } catch (err) {
        status.textContent = 'Network error: ' + err.message;
      } finally {
        sendBtn.disabled = false;
      }
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
    .btn {
      width: 100%; padding: 14px; background: #b169e0; color: white; border: none;
      border-radius: 8px; font-size: 1rem; cursor: pointer; margin-top: 12px;
    }
    .btn:hover { opacity: 0.9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .waiting-text { display: none; color: #aaa; }
  </style>
</head>
<body>
  <div class="logo">MAYO Share</div>
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
