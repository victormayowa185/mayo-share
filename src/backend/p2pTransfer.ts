// ─────────────────────────────────────────────────────────────────────────────
// p2pTransfer.ts
//
// Replaces the old RTCPeerConnection/RTCDataChannel transport for "P2P mode"
// with a direct TLS socket between the two app instances on the same LAN.
//
// WHY: P2P mode only ever runs on the same LAN/hotspot (the old signaling
// already proved this — it swaps SDP over a plain HTTP call to a known LAN
// IP). WebRTC's DTLS+SCTP stack exists to solve NAT traversal across
// different networks, which this app never actually needed. Meanwhile the
// old sender loop read every chunk via a fresh IPC call to the renderer
// (which itself re-opened the file with open/read/close every single
// 256KB), and the receiver appended every chunk via IPC too. All of that
// added latency per-chunk that a raw streaming pipe (like fileServer.ts
// already uses for "web mode") doesn't have.
//
// This module keeps the file entirely inside the main process for both
// sending and receiving: fs.createReadStream -> socket, and socket ->
// fs.WriteStream. Only small, throttled progress events and JSON control
// messages cross the IPC boundary — never raw file bytes.
//
// Wire format (single TLS TCP stream, used for both control JSON messages
// and binary file chunks):
//   [1 byte frame type][4 bytes big-endian length][payload]
//     type 0x00 = control message (UTF-8 JSON)
//     type 0x01 = binary file chunk
//     type 0x02 = pairing request  (payload = 4-digit code, UTF-8)
//     type 0x03 = pairing accepted (payload empty)
//     type 0x04 = pairing rejected (payload empty)
// ─────────────────────────────────────────────────────────────────────────────

import { EventEmitter } from "events";
import * as tls from "tls";
import * as fs from "fs";
import * as path from "path";
import { getServerCert } from "./certs";

export const P2P_PORT = 3005;

const FRAME_HEADER_SIZE = 5;
// 512KB per binary frame: big enough to keep per-frame overhead tiny, small
// enough that a control message (e.g. "cancel") never waits long behind an
// in-flight frame on the same socket.
const CHUNK_SIZE = 512 * 1024;

const FRAME_CONTROL = 0x00;
const FRAME_CHUNK = 0x01;
const FRAME_PAIR_REQUEST = 0x02;
const FRAME_PAIR_OK = 0x03;
const FRAME_PAIR_REJECTED = 0x04;

// ─── Frame decoder: feed it raw socket bytes, get back whole frames ────────
class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  push(data: Buffer, onFrame: (type: number, payload: Buffer) => void) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, data]) : data;

    while (true) {
      if (this.buffer.length < FRAME_HEADER_SIZE) return;
      const type = this.buffer.readUInt8(0);
      const len = this.buffer.readUInt32BE(1);
      const total = FRAME_HEADER_SIZE + len;
      if (this.buffer.length < total) return; // wait for more data

      const payload = this.buffer.subarray(FRAME_HEADER_SIZE, total);
      this.buffer = this.buffer.subarray(total);
      onFrame(type, payload);
    }
  }
}

function writeFrame(socket: tls.TLSSocket, type: number, payload: Buffer): boolean {
  const header = Buffer.alloc(FRAME_HEADER_SIZE);
  header.writeUInt8(type, 0);
  header.writeUInt32BE(payload.length, 1);
  // Two writes to the same socket in the same tick are still delivered in
  // order on a TCP stream, so this is safe without concatenating buffers.
  socket.write(header);
  return socket.write(payload);
}

async function waitForDrain(socket: tls.TLSSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = () => { socket.off("error", onError); resolve(); };
    const onError = (e: Error) => { socket.off("drain", onDrain); reject(e); };
    socket.once("drain", onDrain);
    socket.once("error", onError);
  });
}

interface SendFileOptions {
  filePath: string;
  offset: number;
  size: number;
  onProgress: (sentTotal: number) => void;
  onChunk?: (chunk: Buffer) => void; // e.g. feed the Solana streaming signer
  isCancelled: () => boolean;
}

interface ActiveReceive {
  id: string;
  stream: fs.WriteStream;
  onChunk?: (chunk: Buffer) => void; // e.g. feed the Solana streaming verifier
}

export class P2PManager extends EventEmitter {
  private server: tls.Server | null = null;
  private socket: tls.TLSSocket | null = null;
  private decoder = new FrameDecoder();
  private activeCode = "";
  private activeReceive: ActiveReceive | null = null;
  private currentSendCancel: (() => void) | null = null;

  isConnected(): boolean {
    return !!this.socket && !this.socket.destroyed;
  }

  private generateCode(): string {
    const arr = new Uint32Array(1);
    require("crypto").randomFillSync(arr);
    return String(1000 + (arr[0] % 9000));
  }

  // ─── Host side: start listening, hand out a 4-digit code ─────────────────
  async hostStart(ip: string): Promise<{ code: string; ip: string; port: number }> {
    this.hostStop();
    this.activeCode = this.generateCode();
    const { key, cert } = getServerCert(ip);

    this.server = tls.createServer({ key, cert }, (socket) => {
      // Only one peer at a time; reject anyone else while paired.
      if (this.socket) {
        socket.destroy();
        return;
      }
      this.attachSocket(socket, /* isHost */ true);
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.on("error", reject);
      this.server!.listen(P2P_PORT, "0.0.0.0", () => resolve());
    });

    return { code: this.activeCode, ip, port: P2P_PORT };
  }

  hostStop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.activeCode = "";
  }

  // ─── Joiner side: connect + pair with a code ──────────────────────────────
  async join(ip: string, code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(
        { host: ip, port: P2P_PORT, rejectUnauthorized: false },
        () => {
          writeFrame(socket, FRAME_PAIR_REQUEST, Buffer.from(code, "utf8"));
        },
      );

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("timeout"));
      }, 8000);

      const decoder = new FrameDecoder();
      const onData = (data: Buffer) => {
        decoder.push(data, (type) => {
          if (type === FRAME_PAIR_OK) {
            clearTimeout(timeout);
            socket.off("data", onData);
            this.attachSocket(socket, /* isHost */ false);
            resolve();
          } else if (type === FRAME_PAIR_REJECTED) {
            clearTimeout(timeout);
            socket.destroy();
            reject(new Error("wrong_code"));
          }
        });
      };
      socket.on("data", onData);
      socket.on("error", (err) => { clearTimeout(timeout); reject(err); });
    });
  }

  private attachSocket(socket: tls.TLSSocket, isHost: boolean) {
    // Large-file streaming benefits from disabling Nagle, same as fileServer.ts.
    socket.setNoDelay(true);
    this.socket = socket;
    this.decoder = new FrameDecoder();

    if (isHost) {
      // First frame from a fresh connection must be a pairing request.
      let paired = false;
      const pairDecoder = new FrameDecoder();
      const onFirstData = (data: Buffer) => {
        if (paired) return;
        pairDecoder.push(data, (type, payload) => {
          if (paired) return;
          if (type === FRAME_PAIR_REQUEST && payload.toString("utf8") === this.activeCode) {
            paired = true;
            writeFrame(socket, FRAME_PAIR_OK, Buffer.alloc(0));
            socket.off("data", onFirstData);
            this.bindDataHandler(socket);
            this.emit("connected");
          } else {
            writeFrame(socket, FRAME_PAIR_REJECTED, Buffer.alloc(0));
            socket.destroy();
            this.socket = null;
          }
        });
      };
      socket.on("data", onFirstData);
    } else {
      this.bindDataHandler(socket);
      this.emit("connected");
    }

    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      this.emit("disconnected");
    });
    socket.on("error", () => { /* surfaced via close */ });
  }

  private bindDataHandler(socket: tls.TLSSocket) {
    socket.on("data", (data: Buffer) => {
      this.decoder.push(data, (type, payload) => {
        if (type === FRAME_CONTROL) {
          try {
            this.emit("control", JSON.parse(payload.toString("utf8")));
          } catch {
            // ignore malformed control frame
          }
        } else if (type === FRAME_CHUNK) {
          this.handleIncomingChunk(payload);
        }
      });
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.hostStop();
  }

  // ─── Control (JSON) messages — cheap, infrequent, fine over the socket ────
  sendControl(obj: any) {
    if (!this.socket || this.socket.destroyed) return;
    writeFrame(this.socket, FRAME_CONTROL, Buffer.from(JSON.stringify(obj), "utf8"));
  }

  // ─── Sending a file: fully main-process, streamed straight to the socket ──
  async sendFile(opts: SendFileOptions): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.destroyed) throw new Error("not connected");

    return new Promise<void>((resolve, reject) => {
      const stream = fs.createReadStream(opts.filePath, {
        start: opts.offset,
        highWaterMark: CHUNK_SIZE,
      });

      let sent = opts.offset;
      let cleanedUp = false;
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        this.currentSendCancel = null;
        stream.destroy();
      };
      this.currentSendCancel = cleanup;

      stream.on("data", async (chunk: Buffer) => {
        if (opts.isCancelled()) { cleanup(); resolve(); return; }
        stream.pause();
        try {
          opts.onChunk?.(chunk);
          const ok = writeFrame(socket, FRAME_CHUNK, chunk);
          sent += chunk.length;
          opts.onProgress(sent);
          if (!ok) await waitForDrain(socket);
          if (!cleanedUp) stream.resume();
        } catch (err) {
          cleanup();
          reject(err as Error);
        }
      });

      stream.on("end", () => { cleanup(); resolve(); });
      stream.on("error", (err) => { cleanup(); reject(err); });
    });
  }

  cancelCurrentSend() {
    this.currentSendCancel?.();
  }

  // ─── Receiving a file: incoming chunk frames go straight to disk ──────────
  async beginReceive(id: string, savePath: string, resume: boolean, onChunk?: (c: Buffer) => void): Promise<void> {
    await fs.promises.mkdir(path.dirname(savePath), { recursive: true });
    if (this.activeReceive) {
      await this.endReceive();
    }
    const stream = fs.createWriteStream(savePath, { flags: resume ? "a" : "w" });
    this.activeReceive = { id, stream, onChunk };
  }

  private handleIncomingChunk(payload: Buffer) {
    const active = this.activeReceive;
    if (!active) return;
    active.onChunk?.(payload);
    if (!active.stream.write(payload)) {
      // Respect disk backpressure: pause the socket until the write stream
      // drains so we don't balloon memory if disk is slower than the LAN.
      this.socket?.pause();
      active.stream.once("drain", () => this.socket?.resume());
    }
    this.emit("receive-progress", { id: active.id, chunkLength: payload.length });
  }

  async endReceive(): Promise<void> {
    const active = this.activeReceive;
    if (!active) return;
    this.activeReceive = null;
    await new Promise<void>((resolve, reject) => {
      active.stream.once("error", reject);
      active.stream.end(() => resolve());
    });
  }
}