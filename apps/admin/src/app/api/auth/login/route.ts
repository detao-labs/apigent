import { NextResponse } from "next/server";
import { SESSION_COOKIES, getSessionMaxAge } from "@apigent/server/auth";
import { AdminAuthError, issueAdminSessionToken, loginAdmin } from "@/services/auth";

/**
 * 平台管理员登录。POST /api/auth/login
 *
 * 与 Platform 的登录互不影响：写的是 apigent_admin_session，用 adminSecret 签名。
 *
 * 错误码：
 *   401 invalid-credentials  邮箱或密码不对
 *   403 not-admin            账号密码正确，但不是平台管理员
 *
 * 之所以区分 401/403：本应用是运维控制台，能走到 403 的人已经证明了自己拥有该
 * 账号（密码正确），告诉他"你还不是管理员"比一句含糊的失败更省事。
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  try {
    const admin = await loginAdmin(body);

    const response = NextResponse.json({
      user: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    });
    response.cookies.set(SESSION_COOKIES.admin, issueAdminSessionToken(admin.id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: getSessionMaxAge(),
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (err) {
    if (err instanceof AdminAuthError) {
      const status = err.code === "invalid-credentials" ? 401 : 403;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error("[admin/auth/login]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
