// ═══════════════════════════════════════════════════════════════════
// Admin Auth Service — 会话读取与门禁
// ═══════════════════════════════════════════════════════════════════
//
// 登录/登出由 Auth.js 负责（见 src/auth.ts，含 authorize 与 not-admin 错误码）。
// 这里只做两件事：
//   - getAdminIdentity()：Auth.js 会话 → 用户（不判断是否管理员）
//   - getAdminSessionUser() / requireAdmin()：再叠加 admin_members 判定
//
// 管理员资格**每次请求现查数据库**，不写进 token：撤权后下一个请求立刻生效，
// 手里那张还没过期的 cookie 会被送到 /forbidden。
// ═══════════════════════════════════════════════════════════════════

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDB, users } from "@apigent/server/db";
import { getAdminRole, type AdminRole } from "@apigent/server/authz";
import { auth } from "@/auth";

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
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const [user] = await getDB()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.disabledAt)))
    .limit(1);
  return user ?? null;
}

/** 已登录**且**仍是平台管理员。 */
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
