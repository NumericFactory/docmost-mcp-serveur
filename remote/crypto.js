import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function getKey() {
  const raw = process.env.MASTER_KEY;
  if (!raw) throw new Error("MASTER_KEY env var is not set");
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("MASTER_KEY must be 64 hex characters (32 bytes) — generate one with: openssl rand -hex 32");
  }
  return key;
}

// Returns "iv.authTag.ciphertext", each base64.
export function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload) {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split(".");
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

// Fails fast at startup if MASTER_KEY is missing or malformed, rather than on
// the first request.
export function checkMasterKey() {
  const probe = encrypt("startup-check");
  if (decrypt(probe) !== "startup-check") {
    throw new Error("MASTER_KEY round-trip check failed");
  }
}
