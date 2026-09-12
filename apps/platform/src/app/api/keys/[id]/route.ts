import { NextResponse } from "next/server";
import { SecretKeyError, revokeSecretKey, updateSecretKeyScope } from "@apigent/server/keys";
import { withRoute } from "@/lib/route";

/**
 * 修改密钥的仓库白名单。PATCH /api/keys/:id
 *
 * 空数组 = 不限制（沿用用户全部可访问仓库）；非空时每个 id 都必须是调用者
 * 当前可访问的仓库，服务端会校验。
 */
export const PATCH = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const raw = (body ?? {}) as { repositoryIds?: unknown };
  if (!Array.isArray(raw.repositoryIds)) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }
  const repositoryIds = raw.repositoryIds.filter((v): v is string => typeof v === "string");

  try {
    const updated = await updateSecretKeyScope({ userId: user.id, keyId: id, repositoryIds });
    if (!updated) return NextResponse.json({ error: "not-found" }, { status: 404 });
    return NextResponse.json({ key: updated });
  } catch (err) {
    if (err instanceof SecretKeyError) {
      return NextResponse.json({ error: err.code }, { status: 400 });
    }
    console.error("[keys PATCH]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});

/**
 * 吊销 API 密钥。DELETE /api/keys/:id
 *
 * 软删除（写 revoked_at）；不属于当前用户的 key 与不存在同样返回 404，
 * 避免用它探测别人有哪些密钥。
 */
export const DELETE = withRoute({ auth: true }, async ({ params, user }) => {
  const { id } = await params;
  try {
    const revoked = await revokeSecretKey({ userId: user.id, keyId: id });
    if (!revoked) return NextResponse.json({ error: "not-found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[keys DELETE]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
