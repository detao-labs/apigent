import { NextResponse } from "next/server";
import { revokeSecretKey } from "@apigent/server/keys";
import { withRoute } from "@/lib/route";

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
