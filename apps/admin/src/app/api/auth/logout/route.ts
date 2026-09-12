import { NextResponse } from "next/server";
import { SESSION_COOKIES } from "@apigent/server/auth";

/** 退出 Admin 会话。POST /api/auth/logout —— 不动 Platform 的 cookie。 */
export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIES.admin, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
