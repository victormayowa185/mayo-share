import { EventEmitter } from "events";
import mdns from "multicast-dns";

const SERVICE_NAME = "mayo-share._p2p.local";

export class DiscoveryManager extends EventEmitter {
  private mdns: any = null;

  startAdvertising(hostname: string, port: number): void {
    this.stop(); // close any previous instance
    this.mdns = mdns();

    this.mdns.on("query", (query: any) => {
      if (query.questions.some((q: any) => q.name === SERVICE_NAME)) {
        const txtData = hostname + "\x00" + port.toString();
        this.mdns!.respond({
          answers: [
            {
              name: SERVICE_NAME,
              type: "TXT",
              data: txtData,
              ttl: 300,
            },
          ],
        });
      }
    });
  }

  startBrowsing(): void {
    this.stop(); // close any previous instance
    this.mdns = mdns();

    this.mdns.on("response", (response: any) => {
      for (const answer of response.answers) {
        if (answer.name === SERVICE_NAME && answer.type === "TXT") {
          const data = Buffer.from(answer.data).toString("utf8");
          const [name, port] = data.split("\x00").filter(Boolean);
          if (name && port) {
            const ip = response.additionals?.[0]?.data || "127.0.0.1";
            const portNum = parseInt(port, 10);
            this.emit("device-found", { name, host: ip, port: portNum });
          }
        }
      }
    });

    this.mdns.query(SERVICE_NAME, "TXT");
  }

  stop(): void {
    if (this.mdns) {
      this.mdns.destroy();
      this.mdns = null;
    }
  }
}