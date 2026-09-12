// ═══════════════════════════════════════════════════════════════════
// Admin Auth — Auth.js (NextAuth v5) 实例
// ═══════════════════════════════════════════════════════════════════
//
// 与 Platform 是**两套独立实例**：命名空间 `apigent-admin.*`、密钥
// `auth.adminSecret`（不回落到 auth.secret）。cookie 按主机共享、不区分端口，
// 所以这层隔离必须靠命名空间 + 密钥，而不是靠端口不同。
//
// Admin 只支持账密登录（docs/tech-design.md §5.4.9）：它是权限最高的界面，
// 接第三方登录会让"某个 GitHub 账号被盗"直接变成"控制台沦陷"。
// ═══════════════════════════════════════════════════════════════════

import NextAuth from "next-auth";
import type { NextAuthResult } from "next-auth";
import { CredentialsSignin } from "next-auth";
import { eq } from "drizzle-orm";
import { createAuthConfig, resolveAuthSecret, resolveSessionMaxAge } from "@apigent/auth";
import { recordOperation, withAuditTransaction } from "@apigent/server/audit";
import { verifyPassword } from "@apigent/server/auth";
import { getDB, users } from "@apigent/server/db";
import { getAdminRole } from "@apigent/server/authz";

/**
 * 账号密码正确、但不是平台管理员。
 *
 * 带上自定义 code（会出现在 URL 与 signIn 的返回值里），登录页据此显示
 * "该账号不是平台管理员"而不是笼统的"密码错误"——走到这一步的人已经证明了
 * 自己拥有该账号，告诉他实话更省事。
 */
export class NotAdminError extends CredentialsSignin {
  code = "not-admin";
}

const nextAuth: NextAuthResult = NextAuth((request) =>
  createAuthConfig({
    scope: "admin",
    secret: resolveAuthSecret("admin"),
    sessionMaxAge: resolveSessionMaxAge(),
    // 与 Auth.js 的 useSecureCookies 同源判定：按请求协议，而不是 NODE_ENV
    secure: request?.nextUrl?.protocol === "https:",
    authorize: async (credentials) => {
      const email =
        typeof credentials.email === "string" ? credentials.email.trim().toLowerCase() : "";
      const password = typeof credentials.password === "string" ? credentials.password : "";
      if (!email || !password) return null;

      const [user] = await getDB().select().from(users).where(eq(users.email, email)).limit(1);
      if (!user || !verifyPassword(password, user.passwordHash)) return null;
      // 被禁用的账号不能进控制台（已有会话由 getAdminIdentity 拦）
      if (user.disabledAt) return null;

      // 准入的唯一依据：admin_members 里有没有这一行
      const role = await getAdminRole(user.id);
      if (!role) throw new NotAdminError();

      // 平台方登录留痕（`admin.login`）。审计写入要求事务句柄，这里单开一个只含
      // 审计行的事务——登录没有可捆绑的业务写。
      await withAuditTransaction(async (tx) => {
        await recordOperation(tx, {
          actorId: user.id,
          operationType: "admin.login",
          resourceType: "user",
          resourceId: user.id,
          summary: { targetUserId: user.id, targetEmail: user.email, role },
        });
      });

      return { id: user.id, email: user.email, name: user.name, image: user.avatarUrl ?? null };
    },
  }),
);

export const handlers: NextAuthResult["handlers"] = nextAuth.handlers;
export const auth: NextAuthResult["auth"] = nextAuth.auth;
export const signIn: NextAuthResult["signIn"] = nextAuth.signIn;
export const signOut: NextAuthResult["signOut"] = nextAuth.signOut;
