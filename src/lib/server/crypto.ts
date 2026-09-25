import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

/** Hash format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEY_LEN, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

let cachedKey: Buffer | null = null;

/**
 * Encryption key from APP_SECRET. If it is not set, a random secret is
 * generated once and stored next to the database (so self-hosted / Docker
 * installs work out of the box and keep their tokens across restarts).
 */
function secretKey(): Buffer {
  if (cachedKey) return cachedKey;
  let secret = process.env.APP_SECRET;
  if (!secret || secret.length < 32) {
    const dbFile = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "wrkhive.db");
    const file = path.join(path.dirname(dbFile), ".app-secret");
    try {
      secret = fs.readFileSync(file, "utf8").trim();
    } catch {
      secret = randomBytes(48).toString("base64url");
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, secret, { mode: 0o600 });
      console.warn(`[wrkhive] APP_SECRET not set – generated a secret in ${file}`);
    }
    if (!secret || secret.length < 32) throw new Error("Invalid APP_SECRET");
  }
  cachedKey = createHash("sha256").update(secret).digest();
  return cachedKey;
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const [v, iv, tag, data] = payload.split(".");
  if (v !== "v1") throw new Error("Unsupported ciphertext version");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

/** PKCE (RFC 7636) S256 verifier and challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
