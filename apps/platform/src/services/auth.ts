// ═══════════════════════════════════════════════════════════════════
// Platform Auth Service — register / login / session
// ═══════════════════════════════════════════════════════════════════
//
// App-level glue: reads the session cookie via next/headers and talks to
// the shared auth primitives (@apigent/server/auth) + users table.
// ═══════════════════════════════════════════════════════════════════

import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE,
  createSessionToken,
  hashPassword,
  verifyPassword,
  verifySessionToken,
} from "@apigent/server/auth";
import { getDB, users } from "@apigent/server/db";
import { generateId } from "@apigent/server/id";
import {
  loginBodySchema,
  registerBodySchema,
} from "@/lib/openapi-schemas";
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
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const payload = verifySessionToken(token);
  if (!payload) return null;

  const [user] = await getDB()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
    })
    .from(users)
    .where(eq(users.id, payload.uid))
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

export async function loginUser(input: unknown): Promise<SessionUser> {
  const parsed = loginBodySchema.safeParse(input);
  if (!parsed.success) throw new AuthError("invalid-credentials");
  const email = parsed.data.email.trim().toLowerCase();
  const [user] = await getDB()
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
    throw new AuthError("invalid-credentials");
  }
  return { id: user.id, email: user.email, name: user.name };
}

export function issueSessionToken(userId: string): string {
  return createSessionToken(userId);
}

function mapRegisterIssue(error: ZodError): string {
  const field = error.issues[0]?.path[0];
  if (field === "name") return "invalid-name";
  if (field === "password") return "weak-password";
  return "invalid-email";
}
