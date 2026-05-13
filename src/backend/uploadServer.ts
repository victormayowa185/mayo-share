// src/backend/uploadServer.ts
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { promises as fs, createWriteStream } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import formidable from 'formidable';

const RECEIVE_DIR = 'C:\\mayo-received';
const PORT = 3001;   // different port to avoid conflict

export class UploadServer extends EventEmitter {
    private server: Server | null = null;

    async start(ip?: string): Promise<string> {
        await fs.mkdir(RECEIVE_DIR, { recursive: true });

        return new Promise((resolve, reject) => {
            this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
                const url = req.url || '/';

                // Serve the upload page
                if (req.method === 'GET' && (url === '/' || url === '')) {
                    const html = getUploadHTML();
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(html);
                    return;
                }

                // Handle file/text uploads
                if (req.method === 'POST' && url === '/upload') {
                    const form = formidable({
                        uploadDir: RECEIVE_DIR,
                        keepExtensions: true,
                        maxFileSize: 500 * 1024 * 1024, // 500 MB
                        multiples: true,
                    });

                    form.parse(req, async (err, fields, files) => {
                        if (err) {
                            res.writeHead(500);
                            res.end('Upload error');
                            return;
                        }

                        try {
                            // Handle pasted text (field named 'text')
                            if (fields.text) {
                                const textContent = (Array.isArray(fields.text) ? fields.text[0] : fields.text) as string;
                                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                const fileName = `pasted-${timestamp}.txt`;
                                await fs.writeFile(path.join(RECEIVE_DIR, fileName), textContent, 'utf8');
                                this.emit('file-received', fileName);
                            }

                            // Handle pasted image (field named 'image' contains base64)
                            if (fields.image) {
                                const rawImage = Array.isArray(fields.image) ? fields.image[0] : fields.image;
                                const base64Data = (rawImage as string).replace(/^data:image\/\w+;base64,/, '');
                                const buffer = Buffer.from(base64Data, 'base64');
                                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                                const fileName = `screenshot-${timestamp}.png`;
                                await fs.writeFile(path.join(RECEIVE_DIR, fileName), buffer);
                                this.emit('file-received', fileName);
                            }

                            // Handle regular files (input type="file")
                            const uploadedFiles = files.fileupload;
                            if (uploadedFiles) {
                                const fileList = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];
                                for (const f of fileList) {
                                    // Use the original filename, and preserve folder structure if available
                                    const originalName = f.originalFilename || f.newFilename;
                                    // If the file came from a folder upload, keep its relative path
                                    const relativePath = (f as any).webkitRelativePath || '';
                                    const destFolder = relativePath
                                        ? path.dirname(path.join(RECEIVE_DIR, relativePath))
                                        : RECEIVE_DIR;
                                    await fs.mkdir(destFolder, { recursive: true });
                                    const destPath = path.join(destFolder, originalName);
                                    await fs.rename(f.filepath, destPath);
                                    this.emit('file-received', originalName);
                                }
                            }

                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ status: 'ok' }));
                        } catch (e: any) {
                            console.error('Upload processing error:', e);
                            res.writeHead(500);
                            res.end('Processing error');
                        }
                    });
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
    .logo { font-size: 2rem; font-weight: bold; color: #b169e0; margin-bottom: 8px; }
    .subtitle { color: #888; margin-bottom: 30px; }
    .card { background: #111; border: 1px solid #222; border-radius: 16px; max-width: 500px; margin: 0 auto; padding: 32px 24px; }
    input[type="file"] { display: block; margin: 0 auto 16px; color: #ccc; }
    textarea { width: 100%; height: 80px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #ccc; padding: 12px; font-size: 0.9rem; margin-bottom: 16px; resize: vertical; }
    .btn { padding: 12px 28px; background: #b169e0; color: white; border: none; border-radius: 8px; font-size: 1rem; cursor: pointer; }
    .btn:hover { opacity: 0.9; }
    #status { margin-top: 20px; color: #aaa; }
  </style>
</head>
<body>
  <div class="logo">🦅 MAYO Share</div>
  <div class="subtitle">Send files to this laptop</div>
  <div class="card">
    <input type="file" id="fileInput" multiple webkitdirectory />
    <br>
    <textarea id="pasteArea" placeholder="Paste text or images here (long-press to paste)"></textarea>
    <button class="btn" id="sendBtn">Send</button>
    <div id="status"></div>
  </div>
  <script>
    const fileInput = document.getElementById('fileInput');
    const pasteArea = document.getElementById('pasteArea');
    const sendBtn = document.getElementById('sendBtn');
    const status = document.getElementById('status');

    // Handle paste into textarea
    pasteArea.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          // Convert blob to dataURL for sending
          const reader = new FileReader();
          reader.onload = () => {
            // Show thumbnail indicator
            const img = document.createElement('img');
            img.src = reader.result;
            img.style.maxWidth = '100px';
            img.style.margin = '4px';
            pasteArea.parentNode.insertBefore(img, pasteArea.nextSibling);
            // Store image data for upload
            pasteArea.dataset.image = reader.result;
          };
          reader.readAsDataURL(blob);
        }
      }
    });

    sendBtn.addEventListener('click', async () => {
      const formData = new FormData();

      // Add selected files
      for (const file of fileInput.files) {
        formData.append('fileupload', file);
      }

      // Add pasted image
      if (pasteArea.dataset.image) {
        formData.append('image', pasteArea.dataset.image);
        pasteArea.dataset.image = '';
      }

      // Add pasted text
      const text = pasteArea.value.trim();
      if (text) {
        formData.append('text', text);
      }

      if (!formData.has('fileupload') && !formData.has('image') && !formData.has('text')) {
        alert('Please select files or paste content.');
        return;
      }

      sendBtn.disabled = true;
      status.textContent = 'Sending...';

      try {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/upload');
        xhr.onload = () => {
          if (xhr.status === 200) {
            status.innerHTML = '✅ Sent!';
            fileInput.value = '';
            pasteArea.value = '';
            const imgs = document.querySelectorAll('img');
            imgs.forEach(img => img.remove());
          } else {
            status.textContent = 'Error: ' + xhr.status;
          }
          sendBtn.disabled = false;
        };
        xhr.onerror = () => {
          status.textContent = 'Network error';
          sendBtn.disabled = false;
        };
        xhr.send(formData);
      } catch (err) {
        status.textContent = 'Error: ' + err.message;
        sendBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}