import { NextResponse } from "next/server";
import { setDefaultVersion, VersionNotFoundError } from "@apigent/server/versions";
import { triggerVectorize } from "@apigent/server/vectorize";
import { assertRepoAccess, ForbiddenError } from "@apigent/server/authz";
import { withRoute } from "@/lib/route";

/** 设为默认/主版本：POST /api/repos/:id/versions/:versionId/activate */
export const POST = withRoute({ auth: true }, async ({ params, user }) => {
  const { id, versionId } = await params;

  try {
    await assertRepoAccess(user.id, id, "repo_admin");
    await setDefaultVersion(id, versionId);
    // 摄取触发点之一：版本激活。不传 commitId = 索引新主版本的 head（P0-4）。
    // 切到一个索引过的旧版本时这轮几乎是空跑（内容全部复用），换到没索引过的
    // 版本时才真正补索引。fire-and-forget：索引失败不该让切版本失败。
    await triggerVectorize(id, user.id, { trigger: "version_activate" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof VersionNotFoundError) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
