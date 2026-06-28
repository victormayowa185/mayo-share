// src/backend/solanaManager.ts
// Offline file-integrity using Solana (Ed25519) keys.
// The private key NEVER leaves the main process — the renderer only ever asks
// us to sign or verify, and to compute the shared safety code.

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";


// ─── Shared safety code (anti‑MITM) ──────────────────────────
export function safetyNumber(pubA: string, pubB: string): string {
  // Sort the two public keys lexicographically so both sides get the same order
  const sorted = [pubA, pubB].sort();
  const combined = sorted[0] + sorted[1];
  const hash = crypto.createHash('sha256').update(combined).digest();
  // Use the first 4 bytes as a 32‑bit unsigned integer
  const num = hash.readUInt32BE(0);
  // Format as an 8‑digit number (pad with leading zeros if needed)
  return num.toString().padStart(8, '0').slice(0, 8);
}

let keypair: Keypair | null = null;
let identityPath = "";

// Call once on app start with a stable directory (app userData).
export function initSolana(dir: string) {
  identityPath = path.join(dir, "mayo-identity.json");
  loadOrCreateKeypair();
}

function loadOrCreateKeypair(): Keypair {
  if (keypair) return keypair;
  try {
    const raw = fs.readFileSync(identityPath, "utf-8");
    const secret = Uint8Array.from(JSON.parse(raw));
    keypair = Keypair.fromSecretKey(secret);
  } catch {
    // First run on this machine — mint a new wallet and persist it.
    keypair = Keypair.generate();
    try {
      fs.mkdirSync(path.dirname(identityPath), { recursive: true });
      fs.writeFileSync(
        identityPath,
        JSON.stringify(Array.from(keypair.secretKey)),
        "utf-8",
      );
    } catch (e) {
      console.error("Could not persist Solana identity:", e);
    }
  }
  return keypair;
}

export function getPublicKey(): string {
  return loadOrCreateKeypair().publicKey.toBase58();
}

// Streaming SHA-256 so multi-GB files don't blow up memory.
function hashFile(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest()));
  });
}

// Sign a file: hash it, then sign the 32-byte hash with our Ed25519 secret key.
// 100% offline — no internet needed.
export async function signFile(
  filePath: string,
): Promise<{ hash: string; signature: string; publicKey: string }> {
  const kp = loadOrCreateKeypair();
  const digest = await hashFile(filePath);
  const sig = nacl.sign.detached(new Uint8Array(digest), kp.secretKey);
  return {
    hash: bs58.encode(digest),
    signature: bs58.encode(sig),
    publicKey: kp.publicKey.toBase58(),
  };
}

// Streaming signer: accepts chunks one at a time so the caller can feed
// each chunk as it reads it — no second disk pass, zero extra wait time.
export function createStreamingSigner() {
  const kp = loadOrCreateKeypair();
  const hash = crypto.createHash("sha256");

  return {
    // Call this for every chunk you read (same Buffer/Uint8Array you're sending)
    update(chunk: Buffer | Uint8Array) {
      hash.update(chunk);
    },
    // Call this once after the last chunk — returns the same shape as signFile()
    finalize(): { hash: string; signature: string; publicKey: string } {
      const digest = hash.digest();
      const sig = nacl.sign.detached(new Uint8Array(digest), kp.secretKey);
      return {
        hash: bs58.encode(digest),
        signature: bs58.encode(sig),
        publicKey: kp.publicKey.toBase58(),
      };
    },
  };
}

// Verify a received file against the sender's PINNED public key.
// If a single byte changed in transit (or the key was swapped) -> valid:false.
export async function verifyFile(
  filePath: string,
  signatureB58: string,
  senderPublicKeyB58: string,
): Promise<{ valid: boolean; hash: string; reason?: string }> {
  try {
    const digest = await hashFile(filePath);
    const sig = bs58.decode(signatureB58);
    const pub = bs58.decode(senderPublicKeyB58);
    const valid = nacl.sign.detached.verify(new Uint8Array(digest), sig, pub);
    return {
      valid,
      hash: bs58.encode(digest),
      reason: valid ? undefined : "signature-mismatch",
    };
  } catch (e: any) {
    return { valid: false, hash: "", reason: e?.message || "verify-error" };
  }
}

// A short human-comparable "safety code" derived from BOTH public keys.
// Both devices compute the SAME 8-digit number (keys are sorted first), so the
// two users just read it aloud / eyeball it. Mismatch == possible MITM.
// Verify a signature against a hash (already computed)
export function verifyDigest(
  hashB58: string,
  signatureB58: string,
  publicKeyB58: string
): { valid: boolean; reason?: string } {
  try {
    const digest = bs58.decode(hashB58);
    const sig = bs58.decode(signatureB58);
    const pub = bs58.decode(publicKeyB58);
    const valid = nacl.sign.detached.verify(new Uint8Array(digest), sig, pub);
    return { valid, reason: valid ? undefined : "signature-mismatch" };
  } catch (e: any) {
    return { valid: false, reason: e?.message || "verify-error" };
  }
}

// Streaming verifier (receiver side) – only hashes, no signing.
export function createVerifier() {
  const hash = crypto.createHash("sha256");
  return {
    update(chunk: Buffer | Uint8Array) {
      hash.update(chunk);
    },
    digest(): string {
      return bs58.encode(hash.digest());
    },
  };
}