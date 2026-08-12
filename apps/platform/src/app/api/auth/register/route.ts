import { NextResponse } from "next/server";
import { AuthError, issueSessionToken, registerUser } from "@/services/auth";
import { getSessionMaxAge, SESSION_COOKIE } from "@apigent/server/auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  try {
    const user = await registerUser(body);

    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, issueSessionToken(user.id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: getSessionMaxAge(),
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === "email-taken" ? 409 : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error("[auth/register]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
