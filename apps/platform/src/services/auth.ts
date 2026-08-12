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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

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

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<SessionUser> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (!name || name.length > 255) throw new AuthError("invalid-name");
  if (!EMAIL_RE.test(email) || email.length > 255) throw new AuthError("invalid-email");
  if (input.password.length < PASSWORD_MIN || input.password.length > PASSWORD_MAX) {
    throw new AuthError("weak-password");
  }

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
      name,
      email,
      passwordHash: hashPassword(input.password),
    })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
    });
  return user;
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<SessionUser> {
  const email = input.email.trim().toLowerCase();
  const [user] = await getDB()
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user || !verifyPassword(input.password, user.passwordHash)) {
    throw new AuthError("invalid-credentials");
  }
  return { id: user.id, email: user.email, name: user.name };
}

export function issueSessionToken(userId: string): string {
  return createSessionToken(userId);
}
