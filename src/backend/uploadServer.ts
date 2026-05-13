import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { formidable } from 'formidable';

const RECEIVE_DIR = 'C:\\mayo-received';
const PORT = 3001;

export class UploadServer extends EventEmitter {
  private server: Server | null = null;

  async start(ip?: string): Promise<string> {
    await fs.mkdir(RECEIVE_DIR, { recursive: true });

    return new Promise((resolve, reject) => {
      this.server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
        const url = req.url || '/';
        const method = req.method || 'GET';

        if (method === 'GET' && url === '/favicon.ico') {
          res.writeHead(204);
          res.end();
          return;
        }

        if (method === 'GET' && (url === '/' || url === '')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(getUploadHTML());
          return;
        }

        if (method === 'POST' && url === '/upload') {
          try {
            const form = formidable({
              uploadDir: RECEIVE_DIR,
              keepExtensions: true,
              maxFileSize: 500 * 1024 * 1024,
              multiples: true,
            });

            // v3 API: parse returns [fields, files] — both come from the same call
            const [fields, files] = await form.parse(req);

            // Handle pasted text
            const textField = fields.text;
            if (textField) {
              const textContent = Array.isArray(textField) ? textField[0] : textField;
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const fileName = `pasted-${timestamp}.txt`;
              await fs.writeFile(path.join(RECEIVE_DIR, fileName), textContent, 'utf8');
              this.emit('file-received', fileName);
            }

            // Handle pasted image (base64 data URL sent as a field)
            const imageField = fields.image;
            if (imageField) {
              const rawImage = Array.isArray(imageField) ? imageField[0] : imageField;
              const base64Data = rawImage.replace(/^data:image\/\w+;base64,/, '');
              const buffer = Buffer.from(base64Data, 'base64');
              const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
              const fileName = `screenshot-${timestamp}.png`;
              await fs.writeFile(path.join(RECEIVE_DIR, fileName), buffer);
              this.emit('file-received', fileName);
            }

            // Handle regular file uploads
            const uploadedFiles = files.fileupload;
            if (uploadedFiles) {
              const fileList = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];
              for (const f of fileList) {
                const originalName = f.originalFilename || f.newFilename || 'unknown';
                const destPath = path.join(RECEIVE_DIR, originalName);
                await fs.mkdir(path.dirname(destPath), { recursive: true });
                await fs.rename(f.filepath, destPath);
                this.emit('file-received', originalName);
              }
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
          } catch (e: any) {
            console.error('Upload error:', e);
            res.writeHead(500);
            res.end('Upload failed: ' + (e.message || 'unknown error'));
          }
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      this.server.listen(PORT, '0.0.0.0', () => {
        const usedIP = ip || '192.168.137.1';
        resolve(`http://${usedIP}:${PORT}`);
      });

      this.server.on('error', (err) => {
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
        li.innerHTML = `
    < span class="name" > ${ entry.name } </span>
      < span class="size" > ${ formatBytes(entry.file.size) } </span>
        < button class="remove-btn" data - index="${idx}" >✕</button>
          `;
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
      // text is automatically inserted into contenteditable
    });

    sendBtn.addEventListener('click', async () => {
      const formData = new FormData();
      let hasContent = false;

      // Add selected files to ZIP
      if (fileEntries.length > 0) {
        const zip = new JSZip();
        fileEntries.forEach(entry => {
          zip.file(entry.relativePath, entry.file);
        });

        // Add pasted image
        if (pastedImageData) {
          const base64 = pastedImageData.split(',')[1];
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          zip.file(`screenshot - ${ timestamp }.png`, base64, { base64: true });
        }

        // Add pasted text
        const text = pasteArea.innerText.trim();
        if (text) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          zip.file(`pasted - ${ timestamp }.txt`, text);
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const zipName = `mayo - share - ${ new Date().toISOString().replace(/[:.]/g, '-') }.zip`;
        formData.append('fileupload', blob, zipName);
        hasContent = true;
      } else {
        // Fallback: only pasted image/text, no files selected
        if (pastedImageData) {
          const base64 = pastedImageData.split(',')[1];
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const blob = new Blob([atob(base64)], { type: 'image/png' });
          formData.append('fileupload', blob, `screenshot - ${ timestamp }.png`);
          hasContent = true;
        }
        const text = pasteArea.innerText.trim();
        if (text) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const blob = new Blob([text], { type: 'text/plain' });
          formData.append('fileupload', blob, `pasted - ${ timestamp }.txt`);
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