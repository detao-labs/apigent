// ═══════════════════════════════════════════════════════════════════
// Session Tokens — stateless HMAC-signed cookies
// ═══════════════════════════════════════════════════════════════════
//
// Format: `base64url(JSON {uid,aud,iat,exp}).base64url(HMAC-SHA256)`
// No session table needed — revocation is out of scope for V0.
//
// **两个平面**（见 docs/tech-design.md §4.1）：
//
//   platform  cookie `apigent_session`，       secret = auth.secret
//   admin     cookie `apigent_admin_session`，  secret = auth.adminSecret
//
// 隔离靠两道独立的锁：cookie 名不同，签名密钥不同；token 里的 `aud` 再保证
// 即使两个 secret 被配成同一个值，platform 的 token 也验证不过 admin 的校验。
// 任何一道单独失效，另一道仍然拦得住。
//
// 注意：V0 之前的 token 没有 `aud` 字段，升级后一律失效（重新登录即可）。
// ═══════════════════════════════════════════════════════════════════

import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig, loadConfig } from "@apigent/core/config";

/** 会话所属平面。 */
export type SessionScope = "platform" | "admin";

export const SESSION_SCOPES: readonly SessionScope[] = ["platform", "admin"];

/** 每个平面一个 cookie 名——platform 与 admin 的登录互不顶掉。 */
export const SESSION_COOKIES: Record<SessionScope, string> = {
  platform: "apigent_session",
  admin: "apigent_admin_session",
};

function getAuthConfig() {
  try {
    return getConfig().auth;
  } catch {
    return loadConfig().auth;
  }
}

/**
 * 取某个平面的签名密钥。
 *
 * admin 平面**不**回落到 auth.secret：配置漏了就直接抛，否则"隔离"会在
 * 静默中退化成共用密钥。
 */
function secretFor(scope: SessionScope): string {
  const auth = getAuthConfig();
  if (scope === "admin") {
    if (!auth.adminSecret) {
      throw new Error(
        "Missing required secret: APIGENT_AUTH_ADMIN_SECRET — set it in .env to enable the Admin Webapp",
      );
    }
    return auth.adminSecret;
  }
  return auth.secret;
}

function sign(payload: string, scope: SessionScope): string {
  return createHmac("sha256", secretFor(scope)).update(payload).digest("base64url");
}

export interface SessionPayload {
  uid: string;
  /** 签发这套会话的平面；校验时必须与期望平面一致 */
  aud: SessionScope;
  iat: number;
  exp: number;
}

/** Seconds until the session expires (from config auth.sessionMaxAge). */
export function getSessionMaxAge(): number {
  return getAuthConfig().sessionMaxAge;
}

export function createSessionToken(userId: string, scope: SessionScope = "platform"): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      uid: userId,
      aud: scope,
      iat: now,
      exp: now + getSessionMaxAge(),
    } satisfies SessionPayload),
  ).toString("base64url");
  return `${payload}.${sign(payload, scope)}`;
}

/**
 * 校验 token 并断言它属于 `scope` 平面。
 *
 * `scope` 是必填参数（没有默认值）：调用方必须显式声明自己在验证哪个平面，
 * 免得 admin 侧顺手复用 platform 的校验函数而悄悄放行。
 */
export function verifySessionToken(token: string, scope: SessionScope): SessionPayload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(payload, scope);
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
    !SESSION_SCOPES.includes((parsed as SessionPayload).aud) ||
    typeof (parsed as SessionPayload).iat !== "number" ||
    typeof (parsed as SessionPayload).exp !== "number"
  ) {
    return null;
  }
  // 平面必须匹配：platform 的 token 在 admin 校验里必须失败
  if ((parsed as SessionPayload).aud !== scope) return null;
  if ((parsed as SessionPayload).exp <= Math.floor(Date.now() / 1000)) return null;

  return parsed as SessionPayload;
}
