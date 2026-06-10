import { EventEmitter } from "events";
import mdns from "multicast-dns";
import os from "os";

const SERVICE_NAME = "mayo-share._p2p.local";

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  // Prefer 192.168.x.x (LAN/hotspot)
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (
        addr.family === "IPv4" &&
        !addr.internal &&
        addr.address.startsWith("192.168.")
      ) {
        return addr.address;
      }
    }
  }
  // Fallback to any non‑internal IPv4
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }
  return "127.0.0.1";
}

export class DiscoveryManager extends EventEmitter {
  private mdns: any = null;
  private advertiseInterval: NodeJS.Timeout | null = null;
  private queryInterval: NodeJS.Timeout | null = null;
  private seenDevices = new Set<string>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  startAdvertising(hostname: string, port: number): void {
    this.stop();
    this.mdns = mdns({ interfaces: "0.0.0.0" });
    const localIP = getLocalIP();

    const txtData = JSON.stringify({ name: hostname, port });
    const announcePacket = {
      answers: [
        { name: SERVICE_NAME, type: "PTR", data: hostname + ".local", ttl: 300 },
        { name: hostname + ".local", type: "SRV", data: { port, target: hostname + ".local" }, ttl: 300 },
        { name: SERVICE_NAME, type: "TXT", data: [txtData], ttl: 300 },
        { name: hostname + ".local", type: "A", data: localIP, ttl: 300 },
      ],
    };

    this.mdns.on("query", (query: any) => {
      const relevant = query.questions.some(
        (q: any) => q.name === SERVICE_NAME && (q.type === "PTR" || q.type === "TXT")
      );
      if (relevant) this.mdns!.respond(announcePacket);
    });

    // ✅ Proactively announce on start + repeat every 4s
    setTimeout(() => this.mdns?.respond(announcePacket), 100);
    this.advertiseInterval = setInterval(() => this.mdns?.respond(announcePacket), 4000);
  }

  startBrowsing(): void {
    if (this.queryInterval) {
      clearInterval(this.queryInterval);
      this.queryInterval = null;
    }
    this.mdns = mdns({ interfaces: "0.0.0.0" });
    this.seenDevices.clear();
    this.cleanupInterval = setInterval(() => {
      this.seenDevices.clear();
    }, 30000);

    console.log("[Discovery] Started browsing for devices...");

    this.mdns.on("response", (response: any) => {
      for (const answer of response.answers) {
        if (answer.name === SERVICE_NAME && answer.type === "TXT") {
          try {
            // Concatenate TXT record data (may be split into multiple buffers)
            const raw = Array.isArray(answer.data)
              ? Buffer.concat(
                answer.data.map((d: any) =>
                  Buffer.isBuffer(d) ? d : Buffer.from(d)
                )
              )
              : Buffer.from(answer.data);
            const rawString = raw.toString("utf8");
            const { name, port } = JSON.parse(rawString);
            const ip = response.address || "127.0.0.1";
            const portNum = parseInt(port, 10);

            const deviceId = `${ip}:${portNum}`;
            if (this.seenDevices.has(deviceId)) {
              console.log(`[Discovery] Ignoring duplicate: ${name} at ${ip}:${portNum}`);
              return;
            }
            this.seenDevices.add(deviceId);

            console.log(`[Discovery] Found device: ${name} at ${ip}:${portNum}`);
            this.emit("device-found", { name, host: ip, port: portNum });
          } catch (err) {
            // Malformed packet – log but don't crash the listener
            console.error("[Discovery] Invalid TXT record (ignored):", err);
          }
        }
      }
    });

    // Query both PTR and TXT to maximise compatibility
    this.mdns.query(SERVICE_NAME, "PTR");
    this.mdns.query(SERVICE_NAME, "TXT");
    this.queryInterval = setInterval(() => {
      console.log("[Discovery] Re-querying...");
      this.mdns?.query(SERVICE_NAME, "PTR");
      this.mdns?.query(SERVICE_NAME, "TXT");
    }, 5000);
  }

  stop(): void {
    if (this.advertiseInterval) {
      clearInterval(this.advertiseInterval);
      this.advertiseInterval = null;
    }
    if (this.queryInterval) {
      clearInterval(this.queryInterval);
      this.queryInterval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    if (this.mdns) {
      this.mdns.destroy();
      this.mdns = null;
    }
    this.seenDevices.clear();
  }
}