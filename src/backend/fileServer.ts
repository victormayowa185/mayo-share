import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { promises as fs, createReadStream, statSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

interface SharedFile {
  filePath: string;
  fileName: string;
  fileSize: number;
}

export class FileServer extends EventEmitter {
  private server: Server | null = null;
  private port: number = 3000;
  private files: SharedFile[] = [];

  async start(filePaths: string[], port?: number, ip?: string): Promise<string> {
    if (this.server) throw new Error('Server already running');
    if (port) this.port = port;

    // Build file list, verify all exist
    this.files = [];
    for (const fp of filePaths) {
      await fs.access(fp);
      const stat = statSync(fp);
      this.files.push({
        filePath: fp,
        fileName: path.basename(fp),
        fileSize: stat.size,
      });
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = req.url || '/';

        // Serve the HTML index page
        if (url === '/' || url === '') {
          const fileRows = this.files.map((f, i) => `
            <tr>
              <td class="name">
                <span class="icon">${getFileIcon(f.fileName)}</span>
                ${escapeHtml(f.fileName)}
              </td>
              <td class="size">${formatBytes(f.fileSize)}</td>
              <td class="action">
                <a href="/file/${i}" download="${escapeHtml(f.fileName)}" class="download-btn">Download</a>
              </td>
            </tr>`).join('');

          const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MAYO Share</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0A0A0A; color: white; font-family: Arial, sans-serif; min-height: 100vh; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 40px; }
    .logo { font-size: 2rem; font-weight: bold; color: #0066FF; margin-bottom: 8px; }
    .subtitle { color: #888; font-size: 1rem; }
    .count { color: #aaa; font-size: 0.9rem; margin-top: 4px; }
    .card { background: #111; border: 1px solid #222; border-radius: 16px; max-width: 600px; margin: 0 auto; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    tr { border-bottom: 1px solid #1a1a1a; transition: background 0.15s; }
    tr:last-child { border-bottom: none; }
    tr:hover { background: #161616; }
    td { padding: 16px 20px; vertical-align: middle; }
    .name { display: flex; align-items: center; gap: 10px; color: #ddd; font-size: 0.95rem; word-break: break-all; }
    .icon { font-size: 1.2rem; flex-shrink: 0; }
    .size { color: #666; font-size: 0.85rem; white-space: nowrap; text-align: right; padding-right: 16px; }
    .action { text-align: right; white-space: nowrap; }
    .download-btn {
      display: inline-block; padding: 8px 20px;
      background: #0066FF; color: white; text-decoration: none;
      border-radius: 8px; font-size: 0.88rem; font-weight: bold;
      transition: background 0.2s;
    }
    .download-btn:hover { background: #0055dd; }
    .footer { text-align: center; margin-top: 32px; color: #444; font-size: 0.8rem; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">🦅 MAYO Share</div>
    <div class="subtitle">${this.files.length === 1 ? '1 file' : `${this.files.length} files`} shared with you</div>
  </div>
  <div class="card">
    <table>
      ${fileRows}
    </table>
  </div>
  <div class="footer">Shared via MAYO Share • Offline P2P File Transfer</div>
</body>
</html>`;

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }

        // Serve individual files: /file/0, /file/1, etc.
        const fileMatch = url.match(/^\/file\/(\d+)$/);
        if (fileMatch) {
          const index = parseInt(fileMatch[1], 10);
          const fileEntry = this.files[index];
          if (!fileEntry) {
            res.writeHead(404);
            res.end('File not found');
            return;
          }

          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileEntry.fileName)}"`);
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Length', fileEntry.fileSize);

          const readStream = createReadStream(fileEntry.filePath);
          this.emit('download-started', index, fileEntry.fileName);

          readStream.pipe(res);
          readStream.on('error', (err) => {
            if (!res.headersSent) { res.writeHead(500); res.end('File read error'); }
            console.error('Stream error:', err);
          });
          res.on('finish', () => {
            this.emit('download-completed', index, fileEntry.fileName);
          });
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      this.server.listen(this.port, '0.0.0.0', () => {
        const usedIP = ip || '192.168.137.1';
        resolve(`http://${usedIP}:${this.port}`);
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
      this.files = [];
    }
  }
}

function formatBytes(b: number): string {
  if (b === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return '🖼️';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📕';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📋';
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️';
  if (['exe', 'msi'].includes(ext)) return '⚙️';
  if (['apk'].includes(ext)) return '📱';
  if (['txt', 'md'].includes(ext)) return '📄';
  if (['js', 'ts', 'py', 'java', 'cpp', 'c', 'cs'].includes(ext)) return '💻';
  return '📁';
}