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
  currentUpload?: {
    fileId: string;
    filename: string;
    totalChunks: number;
    uploadedChunks: Set<number>;
  };
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
  private strings: Record<string, string> = {};
  private lang: string = "en";
  private sessions = new Map<string, Session>();



  private sseClients = new Map<string, SSEClient>();
  private adminClients = new Set<ServerResponse>();
  private fileAssemblyLocks = new Map<string, Promise<void>>();

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
      this.broadcastAdminUpdate();
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
      this.broadcastAdminUpdate();
    }
  }

  private broadcastAdminUpdate() {
    const sessionsList = Array.from(this.sessions.values()).map(s => ({
      id: s.id,
      senderName: s.senderName,
      status: s.status,
      deviceType: s.deviceType,
      currentUpload: s.currentUpload ? {
        filename: s.currentUpload.filename,
        totalChunks: s.currentUpload.totalChunks,
        uploadedChunks: Array.from(s.currentUpload.uploadedChunks)
      } : null
    }));
    const data = `data: ${JSON.stringify(sessionsList)}\n\n`;
    this.adminClients.forEach(client => {
      try {
        client.write(data);
      } catch { /* client disconnected */ }
    });
  }

  async start(ip?: string, strings?: Record<string, string>, lang?: string): Promise<string> {
    this.strings = strings || {};
    this.lang = lang || "en";
    await fs.mkdir(RECEIVE_DIR, { recursive: true });



    await fs.mkdir(path.join(RECEIVE_DIR, "chunks"), { recursive: true });
    this.stop();
    await new Promise((r) => setTimeout(r, 100));

    return new Promise((resolve, reject) => {
      this.server = createServer(
        async (req: IncomingMessage, res: ServerResponse) => {
          // CORS
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
          res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");

          if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
          }

          const url = req.url || "/";
          const method = req.method || "GET";

          // FIX: Move this to the VERY top to stop the "Double Load"
          if (url === "/favicon.ico") {
            res.writeHead(204);
            res.end();
            return;
          }

          if (method === "GET" && url === "/favicon.ico") {
            res.writeHead(204);
            res.end();
            return;
          }

          // Admin dashboard
          if (method === "GET" && (url === "/admin" || url === "/admin.html")) {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(getAdminHTML());
            return;
          }

          // Admin SSE
          if (method === "GET" && url === "/admin/events") {
            res.writeHead(200, {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive"
            });
            this.adminClients.add(res);
            const sessionsList = Array.from(this.sessions.values()).map(s => ({
              id: s.id,
              senderName: s.senderName,
              status: s.status,
              deviceType: s.deviceType,
              currentUpload: s.currentUpload ? {
                filename: s.currentUpload.filename,
                totalChunks: s.currentUpload.totalChunks,
                uploadedChunks: Array.from(s.currentUpload.uploadedChunks)
              } : null
            }));
            res.write(`data: ${JSON.stringify(sessionsList)}\n\n`);
            req.on("close", () => this.adminClients.delete(res));
            return;
          }

          // Upload status (resume)
          if (method === "GET" && url?.startsWith("/upload-status")) {
            const parsedUrl = new URL(url!, `http://localhost:${PORT}`);
            const sessionId = parsedUrl.searchParams.get("sessionId");
            const fileId = parsedUrl.searchParams.get("fileId");
            const session = this.sessions.get(sessionId || "");
            if (!session || session.status !== "approved") {
              res.writeHead(403);
              res.end("Not approved");
              return;
            }
            const chunkDir = path.join(RECEIVE_DIR, "chunks", fileId || "none");
            try {
              const files = await fs.readdir(chunkDir);
              const uploadedIndices = files
                .filter(f => f.startsWith("chunk-"))
                .map(f => parseInt(f.split("-")[1], 10))
                .filter(n => !isNaN(n));
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ uploadedChunks: uploadedIndices }));
            } catch {
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ uploadedChunks: [] }));
            }
            return;
          }

          // Session‑aware GET /
          if (method === "GET" && (url === "/" || url === "" || url?.startsWith("/?sessionId="))) {
            const parsedUrl = new URL(url!, `http://localhost:${PORT}`);
            let sessionId = parsedUrl.searchParams.get("sessionId");
            if (!sessionId) {
              sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
              res.writeHead(302, { Location: `/?sessionId=${sessionId}` });
              res.end();
              return;
            }
            let session = this.sessions.get(sessionId);
            if (!session) {

              const saveDir = path.join(RECEIVE_DIR, "MAYO Share", `Sender-${sessionId}`);
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
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              res.end(getWaitingHTML(session.senderName || "Unknown"));
              return;
            }
            if (session.status === "approved") {
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              res.end(getUploadHTML());
              return;
            }
            if (session.status === "declined") {
              res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
              res.end(getDeclinedHTML());
              return;
            }
          }

          // SSE for approval
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

          // Set sender name
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
                  const safeName = name.replace(/[^a-zA-Z0-9_\- ]/g, "").trim() || sessionId!;
                  session.saveDir = path.join(RECEIVE_DIR, "MAYO Share", `Sender-${safeName}`);
                  this.emit("sender-connected", sessionId, name, session.deviceType);
                  this.broadcastAdminUpdate();
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

          // Simple text/image upload
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
                if (filename.includes('..') || path.isAbsolute(filename)) {
                  res.writeHead(400);
                  res.end('Invalid filename');
                  return;
                }
                const buffer = Buffer.from(content, "base64");
                await fs.mkdir(session.saveDir, { recursive: true });
                const savePath = path.join(session.saveDir, filename);
                await fs.writeFile(savePath, buffer);
                this.emit("file-received", filename);
                this.broadcastAdminUpdate();
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

          // ✅ FIXED: Chunk upload endpoint using formidable
          if (method === "POST" && url?.startsWith("/upload-chunk")) {
            try {
              const parsedUrl = new URL(url!, `http://localhost:${PORT}`);
              const sessionId = parsedUrl.searchParams.get("sessionId") || "";
              const fileId = parsedUrl.searchParams.get("fileId") || "";
              const chunkIndex = parseInt(parsedUrl.searchParams.get("chunkIndex") || "0", 10);
              const totalChunks = parseInt(parsedUrl.searchParams.get("totalChunks") || "0", 10);
              const filename = parsedUrl.searchParams.get("filename") || "file";

              const session = this.sessions.get(sessionId);
              if (!session || session.status !== "approved") {
                res.writeHead(403);
                res.end("Not approved");
                return;
              }

              // Parse multipart form data
              const form = formidable({ multiples: false });
              const [fields, files] = await form.parse(req);
              const chunkFile = files.chunk?.[0];
              if (!chunkFile) {
                res.writeHead(400);
                res.end("Missing chunk file");
                return;
              }

              // Read the actual binary chunk data
              const chunkData = await fs.readFile(chunkFile.filepath);
              // Clean up temp file
              await fs.unlink(chunkFile.filepath).catch(() => { });

              // Update session tracking
              if (chunkIndex === 0) {
                session.currentUpload = {
                  fileId,
                  filename,
                  totalChunks,
                  uploadedChunks: new Set()
                };
              }
              if (session.currentUpload && session.currentUpload.fileId === fileId) {
                session.currentUpload.uploadedChunks.add(chunkIndex);
              }

              const chunkDir = path.join(RECEIVE_DIR, "chunks", fileId);
              await fs.mkdir(chunkDir, { recursive: true });
              const chunkPath = path.join(chunkDir, `chunk-${chunkIndex}`);
              await fs.writeFile(chunkPath, chunkData);
              console.log(`[Server] Chunk ${chunkIndex}/${totalChunks} saved for ${filename}`);

              // Check completeness
              const chunks = await fs.readdir(chunkDir);
              if (chunks.length === totalChunks) {
                if (this.fileAssemblyLocks.has(fileId)) {
                  await this.fileAssemblyLocks.get(fileId);
                  res.writeHead(200, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ ok: true, complete: true }));
                  return;
                }

                const assemblyPromise = (async () => {
                  try {
                    await fs.mkdir(session.saveDir, { recursive: true });
                    const finalPath = path.join(session.saveDir, filename);
                    const { createWriteStream } = await import("fs");
                    const writeStream = createWriteStream(finalPath);

                    // Assemble chunks in correct order
                    for (let i = 0; i < totalChunks; i++) {
                      const data = await fs.readFile(path.join(chunkDir, `chunk-${i}`));
                      await new Promise<void>((resolve, reject) => {
                        writeStream.write(data, (err) => err ? reject(err) : resolve());
                      });
                    }
                    writeStream.end();
                    await new Promise<void>((resolve, reject) => {
                      writeStream.on("finish", resolve);
                      writeStream.on("error", reject);
                    });

                    console.log(`[Server] File complete: ${filename}`);
                    this.emit("file-received", filename);
                    if (session.currentUpload && session.currentUpload.fileId === fileId) {
                      session.currentUpload = undefined;
                    }
                    this.broadcastAdminUpdate();

                    // Clean up chunks in background
                    (async () => {
                      try {
                        for (let i = 0; i < totalChunks; i++) {
                          await fs.unlink(path.join(chunkDir, `chunk-${i}`));
                        }
                        await fs.rmdir(chunkDir);
                      } catch (err) {
                        console.error("Cleanup error:", err);
                      }
                    })();
                  } finally {
                    this.fileAssemblyLocks.delete(fileId);
                  }
                })();

                this.fileAssemblyLocks.set(fileId, assemblyPromise);
                await assemblyPromise;

                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, complete: true }));
              } else {
                this.broadcastAdminUpdate();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, complete: false }));
              }
            } catch (err) {
              console.error("Chunk upload error:", err);
              res.writeHead(500);
              res.end("Error saving chunk");
            }
            return;
          }

          // Serve the MAYO logo (copied into dist/backend at build time)
          if (method === "GET" && url === "/mayo.png") {
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

          // Serve GSAP
          if (method === "GET" && url === "/gsap.min.js") {

            const filePath = path.join(__dirname, "../../node_modules/gsap/dist/gsap.min.js");
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
        }
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

// ========================
// HTML GENERATORS (unchanged)
// ========================

function getAdminHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>MAYO Share - Admin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0A0A0A; color: white; font-family: Arial, sans-serif; padding: 40px 20px; }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 2rem; color: #7C3EFF; margin-bottom: 20px; }
    .user-card { background: #111; border: 1px solid #222; border-radius: 12px; padding: 20px; margin-bottom: 20px; }
    .user-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
    .user-name { font-size: 1.3rem; font-weight: bold; color: #7C3EFF; }
    .user-status { font-size: 0.85rem; padding: 4px 8px; border-radius: 20px; background: #2a2a2a; }
    .status-pending { color: #ffaa44; }
    .status-approved { color: #44ff88; }
    .status-declined { color: #ff4444; }
    .progress-section { margin-top: 12px; }
    .progress-bar-bg { background: #333; border-radius: 8px; height: 8px; overflow: hidden; margin: 8px 0; }
    .progress-fill { background: #7C3EFF; width: 0%; height: 100%; transition: width 0.2s; }
    .details { font-size: 0.85rem; color: #aaa; margin-top: 8px; }
    .button-group { margin-top: 12px; }
    button { background: #7C3EFF; border: none; padding: 8px 16px; border-radius: 6px; color: white; cursor: pointer; margin-right: 8px; }
    button:hover { opacity: 0.9; }
    .btn-decline { background: #aa3333; }
  </style>
</head>
<body>
<div class="container">
  <h1>MAYO Share - Connected Users</h1>
  <div id="usersList"></div>
</div>
<script>
  const usersDiv = document.getElementById('usersList');
  const evtSource = new EventSource('/admin/events');
  evtSource.onmessage = (e) => {
    const users = JSON.parse(e.data);
    renderUsers(users);
  };
  function renderUsers(users) {
    usersDiv.innerHTML = '';
    users.forEach(user => {
      const card = document.createElement('div');
      card.className = 'user-card';
      let statusText = user.status;
      let statusClass = 'status-' + user.status;
      let progressHtml = '';
      let uploadInfo = '';
      if (user.currentUpload && user.status === 'approved') {
        const uploaded = user.currentUpload.uploadedChunks.length;
        const total = user.currentUpload.totalChunks;
        const percent = total > 0 ? (uploaded / total * 100).toFixed(1) : 0;
        progressHtml = \`
          <div class="progress-section">
            <div>Uploading: \${escapeHtml(user.currentUpload.filename)}</div>
            <div class="progress-bar-bg"><div class="progress-fill" style="width: \${percent}%;"></div></div>
            <div class="details">\${uploaded} / \${total} chunks (\${percent}%)</div>
          </div>
        \`;
      } else if (user.status === 'approved') {
        uploadInfo = '<div class="details">Waiting for files...</div>';
      }
      card.innerHTML = \`
        <div class="user-header">
          <span class="user-name">\${escapeHtml(user.senderName || 'Unknown')}</span>
          <span class="user-status \${statusClass}">\${statusText}</span>
        </div>
        <div class="details">Device: \${user.deviceType || 'unknown'}</div>
        \${progressHtml}
        \${uploadInfo}
        <div class="button-group">
          <button onclick="approve('\${user.id}')">Approve</button>
          <button class="btn-decline" onclick="decline('\${user.id}')">Decline</button>
        </div>
      \`;
      usersDiv.appendChild(card);
    });
  }
  function escapeHtml(str) { return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;'); }
  async function approve(sessionId) {
    await fetch('/approve?sessionId=' + sessionId, { method: 'POST' });
  }
  async function decline(sessionId) {
    await fetch('/decline?sessionId=' + sessionId, { method: 'POST' });
  }
</script>
</body>
</html>`;
}

function getUploadHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="/gsap.min.js"></script>
  <title>Send to MAYO Share</title>
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
      --name-color: #ccc;
      --size-color: #888;
      --btn-bg: #7C3EFF;
      --btn-hover: #5a2db8;
      --btn-text: #fff;
      --paste-bg: #1a1a1a;
      --paste-border: #333;
      --paste-text: #ccc;
      --status-color: #aaa;
      --progress-bg: #333;
      --progress-fill: #7C3EFF;
      --remove-hover: #f44336;
      --small-icon: #888;
      --small-icon-hover: #7C3EFF;
      --edit-bg: #111;
      --edit-border: #333;
      --edit-text: #ccc;
      --assembling-border: #555;
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
      --btn-bg: #7C3EFF;
      --btn-hover: #5a2db8;
      --btn-text: #000;
      --paste-bg: #ffffff;
      --paste-border: #ccc;
      --paste-text: #222;
      --status-color: #555;
      --progress-bg: #e0e0e0;
      --progress-fill: #7C3EFF;
      --remove-hover: #f44336;
      --small-icon: #666;
      --small-icon-hover: #7C3EFF;
      --edit-bg: #f9f9f9;
      --edit-border: #ddd;
      --edit-text: #222;
      --assembling-border: #ccc;
    }
    
    body {
      background: var(--bg-body);
      color: var(--text-color);
      font-family: Arial, sans-serif;
      padding: 40px 20px;
      text-align: center;
      transition: background 0.2s, color 0.2s;
    }
    .logo { font-size: 2rem; font-weight: bold; color: #7C3EFF; margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 10px; }
    .logo svg { width: 32px; height: 32px; fill: #7C3EFF; }
    .subtitle { color: var(--subtitle-color); margin-bottom: 30px; }
    .card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 16px; max-width: 520px; margin: 0 auto; padding: 32px 24px; }
    .file-section { margin-bottom: 20px; }
    label { display: block; color: var(--subtitle-color); font-size: 0.85rem; margin-bottom: 8px; text-align: left; }
    .file-row { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    .file-btn { padding: 10px 20px; background: var(--btn-bg); color: var(--btn-text); border: none; border-radius: 8px; cursor: pointer; font-size: 0.9rem; transition: background 0.2s; }
    .file-btn:hover { background: var(--btn-hover); }
    .file-list { list-style: none; padding: 0; margin: 0 0 16px 0; max-height: 200px; overflow-y: auto; }
    .file-item { display: flex; align-items: center; gap: 8px; background: var(--row-hover); border: 1px solid var(--row-border); border-radius: 6px; padding: 8px 12px; margin-bottom: 6px; font-size: 0.85rem; }
    .file-item .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--name-color); text-align: left; }
    .file-item .size { color: var(--size-color); white-space: nowrap; }
    .file-item button { background: transparent; border: none; color: var(--small-icon); cursor: pointer; padding: 0 4px; display: inline-flex; align-items: center; }
    .file-item button:hover { color: var(--small-icon-hover); }
    .remove-btn:hover { color: var(--remove-hover) !important; }
    .paste-area { width: 100%; min-height: 80px; background: var(--paste-bg); border: 1px solid var(--paste-border); border-radius: 8px; color: var(--paste-text); padding: 12px; font-size: 0.9rem; text-align: left; outline: none; display: block; }
    .btn { width: auto; padding: 14px 32px; background: var(--btn-bg); color: var(--btn-text); border: none; border-radius: 30px; font-size: 1rem; display: inline-block; cursor: pointer; margin-top: 16px; transition: background 0.2s; }
    .btn:hover { background: var(--btn-hover); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    #status { margin-top: 20px; color: var(--status-color); font-size: 0.95rem; display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; }
    .success-check { width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
    #thumbs img { max-width: 80px; max-height: 80px; margin: 4px; border-radius: 4px; }
    .progress-bar { width: 100%; background: var(--progress-bg); border-radius: 8px; height: 8px; margin: 12px 0; overflow: hidden; display: none; }
    .progress-bar .fill { height: 100%; background: var(--progress-fill); width: 0%; transition: width 0.2s; }
    .mayo-text { color: #7C3EFF; }
    .share-text { color: var(--share-color); }
    .action-buttons-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; justify-content: flex-end; }
    .small-icon-btn { background: transparent; border: none; cursor: pointer; padding: 4px; display: inline-flex; align-items: center; color: var(--small-icon); transition: color 0.2s; }
    .small-icon-btn:hover { color: var(--small-icon-hover); }
    .inline-edit { display: flex; flex-direction: column; gap: 8px; width: 100%; }
    .inline-edit textarea { background: var(--edit-bg); border: 1px solid var(--edit-border); color: var(--edit-text); padding: 8px; border-radius: 6px; font-family: monospace; font-size: 0.85rem; resize: vertical; }
    .inline-edit-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .resume-btn { background: #ffaa44; color: #111; margin-left: 8px; }
    .assembling-notice { color: var(--btn-bg); margin-top: 12px; font-size: 0.9rem; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .assembling-spinner { width: 12px; height: 12px; border: 2px solid var(--assembling-border); border-top: 2px solid var(--btn-bg); border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }





     /* Top navbar: logo left, theme switch right */
    .navbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      max-width: 520px;
      margin: 0 auto 24px auto;
    }
    .nav-logo { height: 32px; width: auto; display: block; }

    /* Apple-style theme switch */
    .theme-toggle {
      position: relative;
      width: 56px;
      height: 30px;
      border: none;
      border-radius: 30px;
      cursor: pointer;
      padding: 0;
      background: #3a3a3a;              /* dark-mode track */
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






  </style>
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

<div class="logo">
  <span class="mayo-text">MAYO</span><span class="share-text">Share</span>
</div>




<div class="subtitle">Send files to this laptop</div>
<div class="card" id="dropZone">
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

<script>
  // Theme management
  const themeToggle = document.getElementById('themeToggle');
  const sunIcon = document.getElementById('sunIcon');
  const moonIcon = document.getElementById('moonIcon');

  function getStoredTheme() { return localStorage.getItem('mayo-upload-theme'); }
  function setTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('mayo-upload-theme', 'light');
      sunIcon.style.display = 'none';
      moonIcon.style.display = 'block';
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('mayo-upload-theme', 'dark');
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

  // ---------- DOM elements ----------
  const addFilesBtn = document.getElementById('addFilesBtn');
  const addFolderBtn = document.getElementById('addFolderBtn');
  const fileListEl = document.getElementById('fileList');
  const pasteArea = document.getElementById('pasteArea');
  const sendBtn = document.getElementById('sendBtn');
  const statusDiv = document.getElementById('status');
  const thumbs = document.getElementById('thumbs');
  const progressBar = document.getElementById('progressBar');
  const progressFill = document.getElementById('progressFill');
  const addTextAsFileBtn = document.getElementById('addTextAsFileBtn');
  const dropZone = document.getElementById('dropZone');

  const sessionId = new URLSearchParams(location.search).get('sessionId');
  const CHUNK_SIZE = 5 * 1024 * 1024;
  const PARALLEL_CHUNKS = 4;
  const MAX_RETRIES = 3;

  let fileEntries = [];
  let pastedImageData = null;
  let isUploading = false;
  let currentQueue = [];
  let currentFileIndex = 0;
  let currentFileId = null;
  let currentTotalChunks = 0;
  let uploadedChunks = new Set();
  let activeUploads = new Map();
  let paused = false;
  let pauseResolve = null;

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024, sizes = ['B','KB','MB','GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function escapeHtml(str) {
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
  }

  function getSuccessIcon() {
    return '<svg class="success-check" viewBox="0 0 24 24" fill="none" stroke="#4CAF50" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  }

  function renderFileList() {
    fileListEl.innerHTML = '';
    fileEntries.forEach(entry => {
      const li = document.createElement('li');
      li.className = 'file-item';
      const isText = entry.isTextFile || (entry.name && entry.name.endsWith('.txt'));
      li.innerHTML = \`
        <span class="name">\${escapeHtml(entry.name)}</span>
        <span class="size">\${formatBytes(entry.file.size)}</span>
        \${isText ? \`<button class="edit-btn" data-id="\${entry.id}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3l4 4-7 7H10v-4l7-7z M15 8l-6 6M21 21H3"/></svg></button>\` : ''}
        <button class="remove-btn" data-id="\${entry.id}">✕</button>
      \`;
      fileListEl.appendChild(li);
    });
    document.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        fileEntries = fileEntries.filter(f => f.id !== btn.dataset.id);
        renderFileList();
      });
    });
    document.querySelectorAll('.edit-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const entry = fileEntries.find(f => f.id === btn.dataset.id);
        if (entry && (entry.isTextFile || entry.name.endsWith('.txt'))) {
          const textContent = await entry.file.text();
          const newContent = prompt("Edit text file content:", textContent);
          if (newContent !== null) {
            const blob = new Blob([newContent], { type: 'text/plain' });
            const newFile = new File([blob], entry.name, { type: 'text/plain' });
            entry.file = newFile;
            renderFileList();
          }
        }
      });
    });
  }

  function addFilesFromInput(input) {
    for (const file of input.files) {
      fileEntries.push({
        id: Date.now().toString() + Math.random(),
        name: file.webkitRelativePath || file.name,
        file: file,
        isTextFile: file.type === 'text/plain' || file.name.endsWith('.txt')
      });
    }
    renderFileList();
    input.value = '';
  }

  addFilesBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', () => addFilesFromInput(input));
    input.click();
  });
  addFolderBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    input.addEventListener('change', () => addFilesFromInput(input));
    input.click();
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.border = '2px dashed #b169e0';
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.style.border = 'none';
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.style.border = 'none';
    const items = e.dataTransfer.items;
    const files = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    for (const file of files) {
      fileEntries.push({
        id: Date.now().toString() + Math.random(),
        name: file.name,
        file: file,
        isTextFile: file.type === 'text/plain' || file.name.endsWith('.txt')
      });
    }
    renderFileList();
  });

  addTextAsFileBtn.addEventListener('click', () => {
    const text = pasteArea.innerText.trim();
    if (!text) return;
    const blob = new Blob([text], { type: 'text/plain' });
    const filename = 'pasted-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
    const file = new File([blob], filename, { type: 'text/plain' });
    fileEntries.push({
      id: Date.now().toString() + Math.random(),
      name: filename,
      file: file,
      isTextFile: true
    });
    pasteArea.innerHTML = '';
    renderFileList();
  });

  pasteArea.addEventListener('paste', async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.kind === 'file') {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          fileEntries.push({
            id: Date.now().toString() + Math.random(),
            name: file.name,
            file: file,
            isTextFile: file.type === 'text/plain' || file.name.endsWith('.txt')
          });
          renderFileList();
        }
        return;
      }
    }
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = () => {
            pastedImageData = reader.result;
            thumbs.innerHTML = '<img src="' + reader.result + '"/>';
          };
          reader.readAsDataURL(blob);
        }
        return;
      }
    }
  });

  async function checkUploadedChunks(fileId) {
    const res = await fetch(\`/upload-status?sessionId=\${sessionId}&fileId=\${fileId}\`);
    if (res.ok) {
      const data = await res.json();
      return new Set(data.uploadedChunks);
    }
    return new Set();
  }

  async function uploadChunk(file, fileId, chunkIndex, totalChunks, retryCount = 0) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    const formData = new FormData();
    formData.append('chunk', chunk);
    const url = \`/upload-chunk?sessionId=\${sessionId}&fileId=\${fileId}&chunkIndex=\${chunkIndex}&totalChunks=\${totalChunks}&filename=\${encodeURIComponent(file.name)}\`;
    try {
      const response = await fetch(url, { method: 'POST', body: formData });
      if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
      const data = await response.json();
      return { success: true, complete: data.complete };
    } catch (err) {
      if (retryCount < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 1000 * (retryCount + 1)));
        return uploadChunk(file, fileId, chunkIndex, totalChunks, retryCount + 1);
      }
      throw err;
    }
  }

  async function uploadFile(file) {
    const fileId = Date.now().toString() + Math.random().toString(36).slice(2);
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    let uploaded = await checkUploadedChunks(fileId);
    let completedChunks = uploaded.size;
    let complete = false;

    progressBar.style.display = 'block';
    function updateProgress() {
      const pct = totalChunks > 0 ? (completedChunks / totalChunks) * 100 : 0;
      progressFill.style.width = pct + '%';
      statusDiv.textContent = \`Uploading \${file.name}... \${Math.floor(pct)}% (\${completedChunks}/\${totalChunks} chunks)\`;
    }
    updateProgress();

    const chunksToUpload = [];
    for (let i = 0; i < totalChunks; i++) {
      if (!uploaded.has(i)) chunksToUpload.push(i);
    }

    let index = 0;
    const workers = new Array(Math.min(PARALLEL_CHUNKS, chunksToUpload.length)).fill().map(async () => {
      while (index < chunksToUpload.length && !complete && !paused) {
        const chunkIdx = chunksToUpload[index++];
        try {
          const result = await uploadChunk(file, fileId, chunkIdx, totalChunks);
          if (result.complete) {
            complete = true;
            statusDiv.innerHTML = \`<div class="assembling-notice"><div class="assembling-spinner"></div>Assembling file...</div>\`;
          }
          uploaded.add(chunkIdx);
          completedChunks = uploaded.size;
          updateProgress();
        } catch (err) {
          console.error(\`Failed chunk \${chunkIdx}\`, err);
          paused = true;
          statusDiv.innerHTML = \`<span style="color:#ffaa44;">⚠️ Upload paused (chunk \${chunkIdx+1} failed). <button id="resumeBtn" class="resume-btn">Resume</button></span>\`;
          sendBtn.disabled = true;
          await new Promise(resolve => { pauseResolve = resolve; });
          paused = false;
          statusDiv.innerHTML = \`Resuming...\`;
          sendBtn.disabled = true;
          index--;
          continue;
        }
        if (complete) break;
      }
    });
    await Promise.all(workers);

    if (complete) {
      await new Promise(r => setTimeout(r, 800));
      statusDiv.innerHTML = getSuccessIcon() + ' File sent successfully!';
      return true;
    } else {
      throw new Error('Upload incomplete');
    }
  }

  async function uploadMultipleFiles(files) {
    for (let i = 0; i < files.length; i++) {
      statusDiv.textContent = \`Preparing file \${i+1} of \${files.length}: \${files[i].name}\`;
      await uploadFile(files[i].file);
      if (i < files.length - 1) {
        progressFill.style.width = '0%';
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  sendBtn.addEventListener('click', async () => {
    if (isUploading) return;
    if (fileEntries.length === 0 && !pastedImageData && !pasteArea.innerText.trim()) {
      statusDiv.textContent = 'Please add files, paste text, or paste an image.';
      return;
    }
    isUploading = true;
    sendBtn.disabled = true;
    statusDiv.textContent = 'Starting...';
    progressBar.style.display = 'block';
    progressFill.style.width = '0%';

    try {
      if (pastedImageData && fileEntries.length === 0) {
        const base64 = pastedImageData.split(',')[1];
        const filename = 'screenshot-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
        const response = await fetch('/upload-simple?sessionId=' + sessionId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: base64, filename })
        });
        if (response.ok) {
          statusDiv.innerHTML = getSuccessIcon() + ' Image sent!';
          thumbs.innerHTML = '';
          pastedImageData = null;
        } else {
          throw new Error('Image upload failed');
        }
        isUploading = false;
        sendBtn.disabled = false;
        progressBar.style.display = 'none';
        return;
      }

      const text = pasteArea.innerText.trim();
      if (fileEntries.length === 0 && text && !pastedImageData) {
        const content = btoa(unescape(encodeURIComponent(text)));
        const filename = 'pasted-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
        const response = await fetch('/upload-simple?sessionId=' + sessionId, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content, filename })
        });
        if (response.ok) {
          statusDiv.innerHTML = getSuccessIcon() + ' Text sent!';
          pasteArea.innerHTML = '';
        } else {
          throw new Error('Text upload failed');
        }
        isUploading = false;
        sendBtn.disabled = false;
        progressBar.style.display = 'none';
        return;
      }

      await uploadMultipleFiles(fileEntries);
      statusDiv.innerHTML = getSuccessIcon() + ' All files sent!';
      fileEntries = [];
      renderFileList();
      pasteArea.innerHTML = '';
      thumbs.innerHTML = '';
      pastedImageData = null;
    } catch (err) {
      console.error(err);
      statusDiv.textContent = 'Error: ' + err.message;
    } finally {
      isUploading = false;
      sendBtn.disabled = false;
      progressBar.style.display = 'none';
      paused = false;
      if (pauseResolve) { pauseResolve(); pauseResolve = null; }
    }
  });

  window.addEventListener('load', () => {
    gsap.timeline()
      .from('.logo', { opacity: 0, y: -20, duration: 0.5 })
      .from('.subtitle', { opacity: 0, y: 10, duration: 0.4 }, '-=0.3')
      .from('.card', { opacity: 0, y: 30, duration: 0.5 }, '-=0.2');
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
  <script src="/gsap.min.js"></script>
  <title>Waiting for Approval – MAYO Share</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0A0A0A; color: white; font-family: Arial, sans-serif; padding: 40px 20px; text-align: center; }
    .logo { font-size: 2rem; font-weight: bold; color: #7C3EFF; margin-bottom: 8px; }
    .subtitle { color: #888; margin-bottom: 30px; }
    .spinner { border: 3px solid #333; border-top: 3px solid #7C3EFF; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; display: none; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .input-group { margin: 16px auto; max-width: 300px; }
    .input-group input { width: 100%; padding: 12px; border-radius: 8px; border: 1px solid #333; background: #1a1a1a; color: white; font-size: 1rem; text-align: center; }
    .mayo-text { color: #7C3EFF; }
    .share-text { color: #fff; }
    .btn { width: auto; padding: 14px; background: #7C3EFF; color: white; border: none; display: inline-block; border-radius: 30px; font-size: 1rem; cursor: pointer; margin-top: 12px; }
    .btn:hover { opacity: 0.9; }
  </style>
</head>
<body>
<div class="logo"><span class="mayo-text">MAYO</span><span class="share-text">Share</span></div>
<div class="subtitle">Hi ${name || "there"}!</div>
<div id="nameForm">
  <p style="color:#aaa; margin-bottom:12px;">Enter your name to request approval:</p>
  <div class="input-group">
    <input style="border-radius:40px;" type="text" id="senderName" placeholder="Your name" autofocus />
  </div>
  <button class="btn" id="requestBtn">Request Approval</button>
</div>
<div id="waitingSection" style="display:none;">
  <p style="color:#aaa;">Waiting for approval…</p>
  <div class="spinner"></div>
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
      return /iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) ? 'tablet' : 'phone';
    }
    return 'desktop';
  }
  requestBtn.addEventListener('click', async () => {
    const name = senderNameInput.value.trim();
    if (!name) return alert('Please enter a name.');
    requestBtn.disabled = true;
    try {
      const resp = await fetch('/set-name?sessionId=' + sessionId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, deviceType: detectDeviceType() })
      });
      if (resp.ok) {
        nameForm.style.display = 'none';
        waitingSection.style.display = 'block';
        const evtSource = new EventSource('/events?sessionId=' + sessionId);
        evtSource.addEventListener('approved', () => location.reload());
        evtSource.addEventListener('declined', () => {
          document.body.innerHTML = '<h1>Declined</h1><p>The receiver declined your request.</p>';
          evtSource.close();
        });
      } else {
        alert('Failed to send request.');
        requestBtn.disabled = false;
      }
    } catch (err) {
      alert('Network error: ' + err.message);
      requestBtn.disabled = false;
    }
  });
  window.addEventListener('load', () => {
    gsap.timeline()
      .from('.logo', { opacity: 0, y: -20, duration: 0.5 })
      .from('.subtitle', { opacity: 0, y: 10, duration: 0.4 }, '-=0.3')
      .from('#nameForm', { opacity: 0, y: 20, duration: 0.4 }, '-=0.2');
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
  <title>Declined – MAYO Share</title>
  <style>
    body { background: #0A0A0A; color: white; font-family: Arial, sans-serif; text-align: center; padding: 40px; }
    .logo { font-size: 2rem; font-weight: bold; color: #7C3EFF; }
  </style>
</head>
<body>
<div class="logo">MAYO Share</div>
<h1>Declined</h1>
<p>The receiver declined your request.</p>
</body>
</html>`;
}