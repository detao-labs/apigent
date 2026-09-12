// ═══════════════════════════════════════════════════════════════════
// Admin Auth Service — Admin Webapp 的登录 / 会话 / 准入
// ═══════════════════════════════════════════════════════════════════
//
// 与 Platform 完全隔离（docs/tech-design.md §4.1）：
//
//   cookie  apigent_admin_session（≠ platform 的 apigent_session）
//   secret  auth.adminSecret（≠ auth.secret，缺配置直接报错）
//   token   payload.aud === "admin"
//
// 所以：能把人放进来 ≠ 已经登录过 Platform；登录过 Platform 也进不来 Admin。
// 准入的唯一依据是 admin_members 里有没有一行（见 §2.8.5）。
// ═══════════════════════════════════════════════════════════════════

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIES,
  createSessionToken,
  verifyPassword,
  verifySessionToken,
} from "@apigent/server/auth";
import { getDB, users } from "@apigent/server/db";
import { getAdminRole, type AdminRole } from "@apigent/server/authz";

/** 平台侧登录错误：invalid-credentials（邮箱或密码错） / not-admin（是用户但不是管理员）。 */
export class AdminAuthError extends Error {
  constructor(public readonly code: "invalid-credentials" | "not-admin") {
    super(code);
    this.name = "AdminAuthError";
  }
}

export interface AdminIdentity {
  id: string;
  email: string;
  name: string;
}

export interface AdminSessionUser extends AdminIdentity {
  role: AdminRole;
}

/** cookie 有效且用户存在 —— 不判断是否管理员。 */
export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  const token = (await cookies()).get(SESSION_COOKIES.admin)?.value;
  if (!token) return null;

  const payload = verifySessionToken(token, "admin");
  if (!payload) return null;

  const [user] = await getDB()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, payload.uid))
    .limit(1);
  return user ?? null;
}

/**
 * 已登录**且**仍是平台管理员。
 *
 * 管理员资格每次请求现查 admin_members：撤销之后，手里那张还没过期的 cookie
 * 立刻失效，不需要等 session 过期（V0 没有会话表，这是不引入黑名单的唯一办法）。
 */
export async function getAdminSessionUser(): Promise<AdminSessionUser | null> {
  const identity = await getAdminIdentity();
  if (!identity) return null;

  const role = await getAdminRole(identity.id);
  if (!role) return null;
  return { ...identity, role };
}

/** 服务端页面守卫：未登录 → /login；已登录但已被撤权 → /forbidden。 */
export async function requireAdmin(): Promise<AdminSessionUser> {
  const identity = await getAdminIdentity();
  if (!identity) redirect("/login");

  const role = await getAdminRole(identity.id);
  if (!role) redirect("/forbidden");
  return { ...identity, role };
}

export async function loginAdmin(input: unknown): Promise<AdminSessionUser> {
  const body = (input ?? {}) as { email?: unknown; password?: unknown };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) throw new AdminAuthError("invalid-credentials");

  const [user] = await getDB().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new AdminAuthError("invalid-credentials");
  }

  const role = await getAdminRole(user.id);
  if (!role) throw new AdminAuthError("not-admin");

  return { id: user.id, email: user.email, name: user.name, role };
}

export function issueAdminSessionToken(userId: string): string {
  return createSessionToken(userId, "admin");
}
