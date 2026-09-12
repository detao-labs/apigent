// ═══════════════════════════════════════════════════════════════════
// Auth.js Config Factory — Platform 与 Admin 共用
// ═══════════════════════════════════════════════════════════════════
//
// 两个 app 的差异只有三处：scope（决定 cookie 名）、secret、authorize()
// （Admin 还要额外校验 admin_members）。其余——会话策略、cookie 选项、
// JWT/session 回调、登录页路径、trustHost——都在这里定义一次。
//
// 关键约定（docs/tech-design.md §5.4.9）：
//   - 角色**永不**进入 token。token 里只有一个 uid，授权每请求查库解析；
//   - 会话是 JWT 形态（无 session 表），因为 Auth.js 的 credentials 不支持 DB session；
//   - `trustHost: true` 是自托管部署的必需项，否则 Auth.js 会拒绝非 Vercel 的 host。
// ═══════════════════════════════════════════════════════════════════

import Credentials from "next-auth/providers/credentials";
import type { NextAuthConfig, User } from "next-auth";
import { getConfig, loadConfig } from "@apigent/core/config";
import { authCookieNames, type AuthScope } from "./cookies";

export interface CreateAuthConfigOptions {
  scope: AuthScope;
  /** 签名密钥；由各 app 通过 resolveAuthSecret(scope) 取，不在这里回落到别的值 */
  secret: string;
  /** 会话有效期（秒） */
  sessionMaxAge?: number;
  /** 登录页路径，默认 /login */
  signInPage?: string;
  /** 是否使用安全 cookie（`__Secure-` / `__Host-` 前缀）；按请求协议判定，默认 false */
  secure?: boolean;
  /** 凭据校验：返回用户（成功）或 null（失败）；可抛 CredentialsSignin 子类带自定义 code */
  authorize: (credentials: Partial<Record<string, unknown>>) => Promise<User | null>;
}

/**
 * 取某个平面的签名密钥。
 *
 * admin 平面**不**回落到 auth.secret：配置漏了就直接抛，否则"两个平面互相
 * 隔离"会在静默中退化成共用密钥。
 */
export function resolveAuthSecret(scope: AuthScope): string {
  const auth = (() => {
    try {
      return getConfig().auth;
    } catch {
      return loadConfig().auth;
    }
  })();

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

export function resolveSessionMaxAge(): number {
  try {
    return getConfig().auth.sessionMaxAge;
  } catch {
    return loadConfig().auth.sessionMaxAge;
  }
}

export function createAuthConfig(options: CreateAuthConfigOptions): NextAuthConfig {
  const names = authCookieNames(options.scope, options.secure ?? false);

  return {
    secret: options.secret,
    // 自托管部署不在 Vercel 上，Auth.js 需要显式信任 host，否则直接报 UntrustedHost
    trustHost: true,
    session: {
      strategy: "jwt",
      maxAge: options.sessionMaxAge ?? 604800,
    },
    pages: {
      signIn: options.signInPage ?? "/login",
    },
    providers: [
      Credentials({
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        authorize: options.authorize,
      }),
    ],
    // 只覆盖 name：Auth.js 会把默认 options（httpOnly / sameSite=lax / path=/
    // / secure）深合并进来。自己写 options 反而会覆盖掉它的判定。
    cookies: {
      sessionToken: { name: names.sessionToken },
      callbackUrl: { name: names.callbackUrl },
      csrfToken: { name: names.csrfToken },
      pkceCodeVerifier: { name: names.pkceCodeVerifier },
      state: { name: names.state },
      nonce: { name: names.nonce },
    },
    callbacks: {
      jwt({ token, user }) {
        // user 只在登录那一次存在；之后每请求都把 uid 带回去
        if (user?.id) token.uid = user.id;
        return token;
      },
      session({ session, token }) {
        if (session.user && typeof token.uid === "string") {
          session.user.id = token.uid;
        }
        return session;
      },
    },
  };
}
