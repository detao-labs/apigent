// ═══════════════════════════════════════════════════════════════════
// Platform Auth Service — session 读取 + 注册
// ═══════════════════════════════════════════════════════════════════
//
// 登录 / 登出交给 Auth.js（见 src/auth.ts）。这里只保留两件事：
//   - getSessionUser()：把 Auth.js 的会话翻译成"当前用户"，作为全平台唯一的
//     会话接缝（调用方拿到的仍是 { id, email, name }）；
//   - registerUser()：注册不属于 Auth.js 的职责范围。
// ═══════════════════════════════════════════════════════════════════

import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { hashPassword } from "@apigent/server/auth";
import { getDB, users } from "@apigent/server/db";
import { generateId } from "@apigent/server/id";
import { registerBodySchema } from "@/lib/openapi-schemas";
import { auth } from "@/auth";
import type { ZodError } from "zod/v4";

export class AuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  // token 里只有 uid：账号被删除 / 禁用、改名都以数据库为准，不缓存进 token。
  // 这也是"禁用立即生效"的实现方式——没有 session 表可清，靠每请求查库。
  const [user] = await getDB()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.disabledAt)))
    .limit(1);
  return user ?? null;
}

/** Guard for server components — redirects to /login when unauthenticated. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function registerUser(input: unknown): Promise<SessionUser> {
  const parsed = registerBodySchema.safeParse(input);
  if (!parsed.success) throw new AuthError(mapRegisterIssue(parsed.error));
  const { name, email, password } = parsed.data;

  const db = getDB();
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) throw new AuthError("email-taken");

  const [user] = await db
    .insert(users)
    .values({
      id: generateId("user"),
      name,
      email: email.trim().toLowerCase(),
      passwordHash: hashPassword(password),
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
    });
  return user;
}

function mapRegisterIssue(error: ZodError): string {
  const field = error.issues[0]?.path[0];
  if (field === "name") return "invalid-name";
  if (field === "password") return "weak-password";
  return "invalid-email";
}
