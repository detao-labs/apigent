import { NextResponse } from "next/server";
import { deleteVersionEntity, getDefaultVersionId, VersionNotFoundError } from "@apigent/server/versions";
import { assertRepoAccess, ForbiddenError } from "@apigent/server/authz";
import { withRoute } from "@/lib/route";

/** 手动删除接口/模型/组件（产一个去掉该实体的新 commit）：DELETE /api/repos/:id/entities/:entityId */
export const DELETE = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id, entityId } = await params;
  const sp = new URL(request.url).searchParams;
  const versionId = sp.get("versionId") ?? (await getDefaultVersionId(id));
  if (!versionId) {
    return NextResponse.json({ error: "no-version" }, { status: 400 });
  }

  try {
    await assertRepoAccess(user.id, id, "repo_editor");
    const result = await deleteVersionEntity(id, versionId, entityId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof VersionNotFoundError) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
});
