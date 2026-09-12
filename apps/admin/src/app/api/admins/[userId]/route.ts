import { NextResponse } from "next/server";
import { AdminMemberError, revokeAdminRole } from "@apigent/server/admin";
import { requireAdminApi } from "@/lib/guard";

/** 撤销平台管理员。DELETE /api/admins/:userId —— 需要 admin:admins:manage。 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ userId: string }> }) {
  const guard = await requireAdminApi("admin:admins:manage");
  if (guard.error) return guard.error;

  const { userId } = await ctx.params;
  try {
    const result = await revokeAdminRole({ userId, actorId: guard.admin.id });
    return NextResponse.json({ ok: true, email: result.email });
  } catch (err) {
    if (err instanceof AdminMemberError) {
      if (err.code === "not-admin") {
        return NextResponse.json({ error: err.code }, { status: 404 });
      }
      // 对自己下手是请求本身的问题（400）；last-admin 是状态冲突（409）
      if (err.code === "self-not-allowed") {
        return NextResponse.json({ error: err.code }, { status: 400 });
      }
      return NextResponse.json({ error: err.code }, { status: 409 });
    }
    console.error("[admin/admins DELETE]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
