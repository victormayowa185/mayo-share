import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export class FileServer extends EventEmitter {
  private server: Server | null = null;
  private port: number = 3000;
  private filePath: string = '';

  async start(filePath: string, port?: number, ip?: string): Promise<string> {
    if (this.server) {
      throw new Error('Server already running');
    }

    this.filePath = filePath;
    if (port) this.port = port;

    await fs.access(this.filePath);

    return new Promise((resolve, reject) => {
      this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
        const fileName = path.basename(this.filePath);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        const readStream = createReadStream(this.filePath);
        this.emit('download-started');   // <-- notify

        readStream.pipe(res);

        readStream.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(500);
            res.end('File read error');
          }
          console.error('Stream error:', err);
        });

        res.on('finish', () => {
          this.emit('download-completed');   // <-- notify
        });
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
    }
  }
}