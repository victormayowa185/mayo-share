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
    .card { background: #111; border: 1px solid #222; border-radius: 16px; max-width: 500px; margin: 0 auto; padding: 32px 24px; }
    .file-section { margin-bottom: 20px; }
    label { display: block; color: #888; font-size: 0.85rem; margin-bottom: 8px; text-align: left; }
    input[type="file"] { display: block; width: 100%; color: #ccc; margin-bottom: 8px; }
    textarea { width: 100%; height: 80px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #ccc; padding: 12px; font-size: 0.9rem; resize: vertical; }
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
    <!-- Inline SVG logo (same shape as your app logo, simplified) -->
    <svg viewBox="0 0 400 354.74" xmlns="http://www.w3.org/2000/svg">
      <path d="M245.923 1.004 C 237.733 2.226,230.924 4.777,224.887 8.884 ..." fill="currentColor"/>
      <!-- Use your actual logo path if preferred; here we keep it brief -->
    </svg>
    MAYO Share
  </div>
  <div class="subtitle">Send files to this laptop</div>
  <div class="card">
    <div class="file-section">
      <label>Select files:</label>
      <input type="file" id="fileInput" multiple />
    </div>
    <div class="file-section">
      <label>Paste text or image:</label>
      <textarea id="pasteArea" placeholder="Paste text here, or paste an image (Ctrl+V)"></textarea>
      <div id="thumbs"></div>
    </div>
    <button class="btn" id="sendBtn">Send</button>
    <div id="status"></div>
  </div>
  <script>
    const fileInput = document.getElementById('fileInput');
    const pasteArea = document.getElementById('pasteArea');
    const sendBtn = document.getElementById('sendBtn');
    const status = document.getElementById('status');
    const thumbs = document.getElementById('thumbs');
    let pastedImageData = null;

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

      for (const file of fileInput.files) {
        formData.append('fileupload', file);
        hasContent = true;
      }

      if (pastedImageData) {
        formData.append('image', pastedImageData);
        hasContent = true;
      }

      const text = pasteArea.value.trim();
      if (text) {
        formData.append('text', text);
        hasContent = true;
      }

      if (!hasContent) {
        status.textContent = 'Please select files or paste something first.';
        return;
      }

      sendBtn.disabled = true;
      status.innerHTML = 'Sending...';

      try {
        const resp = await fetch('/upload', { method: 'POST', body: formData });
        if (resp.ok) {
          status.innerHTML = '<svg class="success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> Sent successfully!';
          fileInput.value = '';
          pasteArea.value = '';
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