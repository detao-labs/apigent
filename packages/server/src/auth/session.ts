// ═══════════════════════════════════════════════════════════════════
// Session Tokens — stateless HMAC-signed cookies
// ═══════════════════════════════════════════════════════════════════
//
// Format: `base64url(JSON {uid,iat,exp}).base64url(HMAC-SHA256)`
// Signed with auth.secret from the project config (APIGENT_AUTH_SECRET).
// No session table needed — revocation is out of scope for V0.
// ═══════════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig, loadConfig } from "@apigent/core/config";

export const SESSION_COOKIE = "apigent_session";

function getAuthConfig() {
  try {
    return getConfig().auth;
  } catch {
    return loadConfig().auth;
  }
}

function sign(payload: string): string {
  return createHmac("sha256", getAuthConfig().secret).update(payload).digest("base64url");
}

export interface SessionPayload {
  uid: string;
  iat: number;
  exp: number;
}

/** Seconds until the session expires (from config auth.sessionMaxAge). */
export function getSessionMaxAge(): number {
  return getAuthConfig().sessionMaxAge;
}

export function createSessionToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({ uid: userId, iat: now, exp: now + getSessionMaxAge() } satisfies SessionPayload),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as SessionPayload).uid !== "string" ||
    typeof (parsed as SessionPayload).iat !== "number" ||
    typeof (parsed as SessionPayload).exp !== "number"
  ) {
    return null;
  }
  if ((parsed as SessionPayload).exp <= Math.floor(Date.now() / 1000)) return null;

  return parsed as SessionPayload;
}
