// ═══════════════════════════════════════════════════════════════════
// Password Hashing — Node built-in scrypt (no external deps)
// ═══════════════════════════════════════════════════════════════════

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;

/**
 * Hash a password into a self-describing string:
 * `scrypt$N$r$p$salt$hash` (all base64url-encoded where binary).
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LEN);
  const hash = scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

/**
 * Verify a password against a stored hash. Returns false for malformed
 * stored values instead of throwing.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
  const n = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p)) {
    return false;
  }

  const expected = Buffer.from(hashB64, "base64url");
  if (expected.length === 0) return false;
  const actual = scryptSync(password, Buffer.from(saltB64, "base64url"), expected.length, {
    N: n,
    r,
    p,
  });
  return timingSafeEqual(actual, expected);
}
