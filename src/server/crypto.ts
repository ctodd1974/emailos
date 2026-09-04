/**
 * Crypto primitives — Node/Bun built-ins only (zero runtime deps).
 *
 *   hashPassword/verifyPassword: scrypt (per-user random salt, constant-time compare)
 *   hmacSha256:                 session-cookie integrity (not used for session
 *                               secrets themselves; sessions are opaque DB-backed tokens)
 *   encryptSecret/decryptSecret: AES-256-GCM for storing provider API keys /
 *                               webhook signing secrets at rest (Slice 3 uses this)
 *   sha256Hex:                  session token hashing before DB storage
 *   timingSafeEqualText:        constant-time comparison for arbitrary strings
 */
import { createHash, createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual, createCipheriv, createDecipheriv } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt);
const SCRYPT_KEYLEN = 64;

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** HMAC-SHA256 hex digest. Used for verifying webhook signatures (Svix) and signing non-secret integrity values. */
export function hmacSha256(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hashHex] = parts;
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  const expected = Buffer.from(hashHex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Constant-time string comparison (for signatures/tokens that are not hex-equal-length by construction). */
export function timingSafeEqualText(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface EncryptedValue {
  iv: string; // base64
  tag: string; // base64 (auth tag)
  data: string; // base64 ciphertext
}

export function encryptSecret(secretKey: string, plaintext: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(secretKey, "utf8"), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: enc.toString("base64"),
  };
}

export function decryptSecret(secretKey: string, value: EncryptedValue): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(secretKey, "utf8"),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(value.data, "base64")), decipher.final()]).toString("utf8");
}