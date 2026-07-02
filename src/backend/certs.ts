import * as selfsigned from "selfsigned";

let cachedCert: { key: string; cert: string } | null = null;
let cachedForIp: string | null = null;

/**
 * Generates (or reuses) a self-signed TLS certificate valid for the given LAN IP.
 * Regenerates only if the IP changes (e.g. switched networks).
 */
export function getServerCert(ip: string): { key: string; cert: string } {
  if (cachedCert && cachedForIp === ip) {
    return cachedCert;
  }

  const attrs = [{ name: "commonName", value: ip }];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 7, ip }, // type 7 = IP address SAN
          { type: 2, value: "localhost" }, // type 2 = DNS
        ],
      },
    ],
  });

  cachedCert = { key: pems.private, cert: pems.cert };
  cachedForIp = ip;
  return cachedCert;
}