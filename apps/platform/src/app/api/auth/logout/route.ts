import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@apigent/server/auth";
import { withRoute } from "@/lib/route";

export const POST = withRoute(async () => {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
});
