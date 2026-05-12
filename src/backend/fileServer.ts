import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { promises as fs, createReadStream, statSync } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

interface SharedFile {
  filePath: string;        // absolute disk path for reading
  fileName: string;        // basename, used for Content-Disposition
  fileSize: number;
  relativePath: string;    // e.g. "Brave/brave.exe" or just "photo.jpg"
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
    ip?: string
  ): Promise<string> {
    if (this.server) throw new Error('Server already running');
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
      this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const url = req.url || '/';

        // Serve the HTML index page
        if (url === '/' || url === '') {
          const html = buildDownloadPage(this.files);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }

        // Serve individual files: /file/ followed by the relative path
        if (url.startsWith('/file/')) {
          const relative = decodeURIComponent(url.slice(6)); // everything after /file/
          let fileEntry = this.fileMap.get(relative);
          if (!fileEntry) {
            // fallback: try matching just the filename (for backwards compatibility)
            const byName = this.files.find(f => f.relativePath === relative || f.fileName === relative);
            if (!byName) {
              res.writeHead(404);
              res.end('File not found');
              return;
            }
            fileEntry = byName;
          }

          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileEntry.fileName)}"`);
          res.setHeader('Content-Type', 'application/octet-stream');
          res.setHeader('Content-Length', fileEntry.fileSize);

          const readStream = createReadStream(fileEntry.filePath);
          this.emit('download-started', this.files.indexOf(fileEntry), fileEntry.fileName);

          readStream.pipe(res);
          readStream.on('error', (err) => {
            if (!res.headersSent) {
              res.writeHead(500);
              res.end('File read error');
            }
            console.error('Stream error:', err);
          });
          res.on('finish', () => {
            this.emit('download-completed', this.files.indexOf(fileEntry), fileEntry.fileName);
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
      this.fileMap.clear();
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────

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
  if (['jpg','jpeg','png','gif','webp','bmp','svg'].includes(ext)) return '🖼️';
  if (['mp4','mkv','avi','mov','webm'].includes(ext)) return '🎬';
  if (['mp3','wav','aac','flac','ogg'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📕';
  if (['doc','docx'].includes(ext)) return '📝';
  if (['xls','xlsx'].includes(ext)) return '📊';
  if (['ppt','pptx'].includes(ext)) return '📋';
  if (['zip','rar','7z','tar','gz'].includes(ext)) return '🗜️';
  if (['exe','msi'].includes(ext)) return '⚙️';
  if (['apk'].includes(ext)) return '📱';
  if (['txt','md'].includes(ext)) return '📄';
  if (['js','ts','py','java','cpp','c','cs'].includes(ext)) return '💻';
  return '📁';
}

// ─── Tree Builder ────────────────────────────────────────

interface TreeNode {
  name: string;
  isDir: boolean;
  children?: TreeNode[];
  file?: SharedFile;
}

function buildTree(files: SharedFile[]): TreeNode {
  const root: TreeNode = { name: '/', isDir: true, children: [] };

  for (const f of files) {
    const parts = f.relativePath.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = current.children?.find(c => c.name === part);
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
      .map(child => renderTree(child, depth + 1))
      .join('');
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
  return '';
}

function hasSubfolders(files: SharedFile[]): boolean {
  return files.some(f => f.relativePath.includes('/'));
}

// ─── Download Page ───────────────────────────────────────

function buildDownloadPage(files: SharedFile[]): string {
  const fileCount = files.length;
  const useTree = hasSubfolders(files);
  let fileListHtml = '';

  if (useTree) {
    const tree = buildTree(files);
    fileListHtml = `<ul class="file-tree">${renderTree(tree)}</ul>`;
  } else {
    fileListHtml = files.map(f => `
      <tr>
        <td class="name">
          <span class="icon">${getFileIcon(f.fileName)}</span>
          ${escapeHtml(f.fileName)}
        </td>
        <td class="size">${formatBytes(f.fileSize)}</td>
        <td class="action">
          <a href="/file/${encodeURIComponent(f.relativePath)}" download="${escapeHtml(f.fileName)}" class="download-btn">Download</a>
        </td>
      </tr>`).join('');
  }

  const zipButtonHtml = `
    <button id="downloadAllBtn" class="zip-btn" onclick="downloadAllAsZip()">
      ⬇️ Download All as ZIP
    </button>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MAYO Share</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #0A0A0A; color: white; font-family: Arial, sans-serif; min-height: 100vh; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 40px; }
    .logo { font-size: 2rem; font-weight: bold; color: #b169e0; margin-bottom: 8px; }
    .subtitle { color: #888; font-size: 1rem; }
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
      background: #b169e0; color: white; text-decoration: none;
      border-radius: 8px; font-size: 0.88rem; font-weight: bold;
      transition: background 0.2s;
    }
    .download-btn:hover { background: #9a4fd4; }
    .footer { text-align: center; margin-top: 32px; color: #444; font-size: 0.8rem; }

    /* Tree styles */
    .file-tree { list-style: none; padding: 0; margin: 0; }
    .file-tree ul { list-style: none; padding-left: 24px; }
    .tree-dir { margin: 8px 0; }
    .folder-name { font-weight: bold; display: block; padding: 8px 16px; background: #151515; border-radius: 4px; }
    .tree-file { margin: 4px 0; padding: 8px 16px 8px 0; }
    .tree-file-row {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 16px; background: #111; border-radius: 6px;
    }
    .zip-btn {
      display: block; margin: 20px auto; padding: 12px 24px;
      background: #4CAF50; color: white; border: none; border-radius: 8px;
      font-size: 1rem; cursor: pointer;
    }
    .zip-btn:hover { background: #43a047; }
  </style>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>
</head>
<body>
  <div class="header">
    <div class="logo">🦅 MAYO Share</div>
    <div class="subtitle">${fileCount === 1 ? '1 file' : `${fileCount} files`} shared with you</div>
  </div>
  <div class="card">
    ${useTree ? '' : '<table>'}
    ${fileListHtml}
    ${useTree ? '' : '</table>'}
    ${fileCount > 1 ? zipButtonHtml : ''}
  </div>
  <div class="footer">Shared via MAYO Share • Offline P2P File Transfer</div>

  <script>
    const files = ${JSON.stringify(files.map(f => ({ r: f.relativePath, n: f.fileName })))};

    async function downloadAllAsZip() {
      const btn = document.getElementById('downloadAllBtn');
      btn.disabled = true;
      btn.textContent = 'Building ZIP...';
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
      btn.textContent = '⬇️ Download All as ZIP';
    }
  </script>
</body>
</html>`;
}