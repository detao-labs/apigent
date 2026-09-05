import { NextResponse } from "next/server";
import { AuthError, issueSessionToken, loginUser } from "@/services/auth";
import { getSessionMaxAge, SESSION_COOKIE } from "@apigent/server/auth";
import { withRoute } from "@/lib/route";

export const POST = withRoute(async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  try {
    const user = await loginUser(body);

    const response = NextResponse.json({ user });
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
      const status = err.code === "invalid-credentials" ? 401 : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error("[auth/login]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
