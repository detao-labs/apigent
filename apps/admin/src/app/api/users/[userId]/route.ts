import { NextResponse } from "next/server";
import { AdminMemberError, deleteUser, setUserDisabled } from "@apigent/server/admin";
import { requireAdminApi } from "@/lib/guard";

/** 领域错误 → HTTP。账号生命周期里的每个拒绝理由都对应一个可操作的提示。 */
function errorResponse(err: unknown): NextResponse | null {
  if (!(err instanceof AdminMemberError)) return null;
  switch (err.code) {
    case "user-not-found":
      return NextResponse.json({ error: err.code }, { status: 404 });
    case "cannot-delete-self":
      return NextResponse.json({ error: err.code }, { status: 400 });
    default:
      // last-admin / owns-organizations：状态冲突，调用方需要先处理别的东西
      return NextResponse.json({ error: err.code }, { status: 409 });
  }
}

/** 禁用 / 启用账号。PATCH /api/users/:userId —— 需要 admin:users:disable。 */
export async function PATCH(request: Request, ctx: { params: Promise<{ userId: string }> }) {
  const guard = await requireAdminApi("admin:users:disable");
  if (guard.error) return guard.error;

  const { userId } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const disabled = (body as { disabled?: unknown } | null)?.disabled;
  if (typeof disabled !== "boolean") {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    const result = await setUserDisabled({ userId, disabled, actorId: guard.admin.id });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const mapped = errorResponse(err);
    if (mapped) return mapped;
    console.error("[admin/users PATCH]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

/** 永久删除账号。DELETE /api/users/:userId —— 需要 admin:users:delete。 */
export async function DELETE(_request: Request, ctx: { params: Promise<{ userId: string }> }) {
  const guard = await requireAdminApi("admin:users:delete");
  if (guard.error) return guard.error;

  const { userId } = await ctx.params;
  try {
    const result = await deleteUser({ userId, actorId: guard.admin.id });
    return NextResponse.json({ ok: true, email: result.email });
  } catch (err) {
    const mapped = errorResponse(err);
    if (mapped) return mapped;
    console.error("[admin/users DELETE]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
