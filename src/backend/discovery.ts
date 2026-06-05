import { EventEmitter } from "events";
import mdns from "multicast-dns";
import os from "os";

const SERVICE_NAME = "mayo-share._p2p.local";

function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (
        addr.family === "IPv4" &&
        !addr.internal &&
        !addr.address.startsWith("192.168.137.") &&
        !addr.address.startsWith("192.168.2.") &&
        !addr.address.startsWith("169.254.")
      ) {
        return addr.address;
      }
    }
  }
  return "127.0.0.1";
}

export class DiscoveryManager extends EventEmitter {
  private mdns: any = null;
  private queryInterval: NodeJS.Timeout | null = null;

  startAdvertising(hostname: string, port: number): void {
    this.stop();
    this.mdns = mdns();
    const localIP = getLocalIP();

    console.log(`[Discovery] Advertising as "${hostname}" on ${localIP}:${port}`);

    this.mdns.on("query", (query: any) => {
      if (query.questions.some((q: any) => q.name === SERVICE_NAME)) {
        console.log("[Discovery] Got query, responding...");
        const txtData = hostname + "\0" + port.toString();
        this.mdns!.respond({
          answers: [
            {
              name: SERVICE_NAME,
              type: "TXT",
              data: [txtData],   // ← must be array
              ttl: 300,
            },
            {
              name: hostname + ".local",
              type: "A",
              data: localIP,     // ← advertise our IP too
              ttl: 300,
            },
          ],
        });
      }
    });
  }

  startBrowsing(): void {
    this.stop();
    this.mdns = mdns();

    console.log("[Discovery] Started browsing for devices...");

    this.mdns.on("response", (response: any) => {
      for (const answer of response.answers) {
        if (answer.name === SERVICE_NAME && answer.type === "TXT") {
          try {
            // answer.data is Buffer[] — concat then decode
            const raw = Array.isArray(answer.data)
              ? Buffer.concat(answer.data.map((d: any) => Buffer.isBuffer(d) ? d : Buffer.from(d)))
              : Buffer.from(answer.data);
            const data = raw.toString("utf8");
            const [name, port] = data.split("\0").filter(Boolean);

            if (name && port) {
              // response.address = actual IP of the sender — most reliable
              const ip = response.address || "127.0.0.1";
              const portNum = parseInt(port, 10);
              console.log(`[Discovery] Found device: ${name} at ${ip}:${portNum}`);
              this.emit("device-found", { name, host: ip, port: portNum });
            }
          } catch (err) {
            console.error("[Discovery] Failed to parse TXT record:", err);
          }
        }
      }
    });

    // Query immediately, then repeat every 5s
    this.mdns.query(SERVICE_NAME, "TXT");
    this.queryInterval = setInterval(() => {
      console.log("[Discovery] Re-querying...");
      this.mdns?.query(SERVICE_NAME, "TXT");
    }, 5000);
  }

  stop(): void {
    if (this.queryInterval) {
      clearInterval(this.queryInterval);
      this.queryInterval = null;
    }
    if (this.mdns) {
      this.mdns.destroy();
      this.mdns = null;
    }
  }
}