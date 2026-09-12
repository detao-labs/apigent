// ═══════════════════════════════════════════════════════════════════
// Auth Cookies — cookie 命名（沿用 Auth.js 的格式，只换命名空间）
// ═══════════════════════════════════════════════════════════════════
//
// Auth.js 的默认格式是 `<安全前缀><命名空间>.<cookie 名>`：
//
//   authjs.session-token        →  __Secure-authjs.session-token
//   authjs.csrf-token           →  __Host-authjs.csrf-token   ← csrf 用更严格的前缀
//   authjs.pkce.code_verifier   →  __Secure-authjs.pkce.code_verifier
//
// 我们只把命名空间换成平面名，其余保持库的形状（熟悉 Auth.js 的人一看就懂）。
//
// 为什么必须换命名空间：Platform 与 Admin 跑在同一台主机上（只是端口不同），
// 而 cookie 按**主机**共享、不区分端口。同名 cookie 会互相覆盖，而 CSRF token
// 是用各自 secret 派生的——后登录的那个平面会拿到别人的 token，表现为"密码
// 正确却登不进去"，极难排查。
//
// 安全前缀的判定必须与 Auth.js 一致：`url.protocol === "https:"`，**不是**
// NODE_ENV。用 NODE_ENV 会在"production 构建跑在本地 http"时给出带 Secure 的
// cookie，浏览器直接丢弃，表现同样是登录没反应。
// ═══════════════════════════════════════════════════════════════════

export type AuthScope = "platform" | "admin";

export const AUTH_SCOPES: readonly AuthScope[] = ["platform", "admin"];

const NAMESPACE: Record<AuthScope, string> = {
  platform: "apigent",
  admin: "apigent-admin",
};

const SECURE_PREFIX = "__Secure-";
const HOST_PREFIX = "__Host-";

export interface AuthCookieNames {
  sessionToken: string;
  callbackUrl: string;
  csrfToken: string;
  pkceCodeVerifier: string;
  state: string;
  nonce: string;
}

/**
 * 某个平面的全部 cookie 名。
 *
 * @param secure 由调用方按请求协议传入（`https:` 时为 true）——与 Auth.js 的
 *   `useSecureCookies` 判定保持一致。
 */
export function authCookieNames(scope: AuthScope, secure: boolean): AuthCookieNames {
  const ns = NAMESPACE[scope];
  const prefix = secure ? SECURE_PREFIX : "";
  // csrf 用 __Host-（要求 Secure + Path=/ + 不带 Domain），比 __Secure- 更严
  const hostPrefix = secure ? HOST_PREFIX : "";

  return {
    sessionToken: `${prefix}${ns}.session-token`,
    callbackUrl: `${prefix}${ns}.callback-url`,
    csrfToken: `${hostPrefix}${ns}.csrf-token`,
    pkceCodeVerifier: `${prefix}${ns}.pkce.code_verifier`,
    state: `${prefix}${ns}.state`,
    nonce: `${prefix}${ns}.nonce`,
  };
}
