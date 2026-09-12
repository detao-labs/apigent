// ═══════════════════════════════════════════════════════════════════
// Platform Auth — Auth.js (NextAuth v5) 实例
// ═══════════════════════════════════════════════════════════════════
//
// 认证交给 Auth.js；授权（org_*/repo_* RBAC）仍然在 packages/server/authz，
// 只吃 userId —— 见 docs/tech-design.md §5.4.9。
//
// 会话是 JWT 形态，cookie 名 `apigent_session`，用 auth.secret 签名；Admin
// 用另一套（`apigent_admin_session` + auth.adminSecret），两者互不通用。
// ═══════════════════════════════════════════════════════════════════

import NextAuth from "next-auth";
import type { NextAuthResult } from "next-auth";
import { eq } from "drizzle-orm";
import { createAuthConfig, resolveAuthSecret, resolveSessionMaxAge } from "@apigent/auth";
import { verifyPassword } from "@apigent/server/auth";
import { getDB, users } from "@apigent/server/db";
import { loginBodySchema } from "@/lib/openapi-schemas";

// 显式标注：pnpm 的嵌套 node_modules 布局下，inferred type 会引用到不可移植的
// .pnpm 内部路径（TS2742），标注后类型就从顶层入口解析。
const nextAuth: NextAuthResult = NextAuth((request) =>
  createAuthConfig({
    scope: "platform",
    secret: resolveAuthSecret("platform"),
    sessionMaxAge: resolveSessionMaxAge(),
    // 与 Auth.js 的 useSecureCookies 同源判定：按请求协议，而不是 NODE_ENV
    secure: request?.nextUrl?.protocol === "https:",
    authorize: async (credentials) => {
      const parsed = loginBodySchema.safeParse(credentials);
      if (!parsed.success) return null;

      const email = parsed.data.email.trim().toLowerCase();
      const [user] = await getDB().select().from(users).where(eq(users.email, email)).limit(1);
      if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) return null;
      // 被平台管理员禁用的账号一律不能登录（已有会话由 getSessionUser 拦）
      if (user.disabledAt) return null;

      return { id: user.id, email: user.email, name: user.name, image: user.avatarUrl ?? null };
    },
  }),
);

export const handlers: NextAuthResult["handlers"] = nextAuth.handlers;
export const auth: NextAuthResult["auth"] = nextAuth.auth;
export const signIn: NextAuthResult["signIn"] = nextAuth.signIn;
export const signOut: NextAuthResult["signOut"] = nextAuth.signOut;
