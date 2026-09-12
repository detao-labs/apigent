import { NextResponse } from "next/server";
import { AuthError, registerUser } from "@/services/auth";
import { withRoute } from "@/lib/route";

/**
 * 注册。POST /api/register
 *
 * 从 `/api/auth/register` 挪出来：`/api/auth/*` 现在整个归 Auth.js（catch-all
 * 路由），注册不属于它的职责。注册完成后由前端调用 Auth.js 的 credentials
 * 登录，因此这里不再签发任何 cookie。
 */
export const POST = withRoute(async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  try {
    const user = await registerUser(body);
    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      const status = err.code === "email-taken" ? 409 : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error("[auth/register]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
