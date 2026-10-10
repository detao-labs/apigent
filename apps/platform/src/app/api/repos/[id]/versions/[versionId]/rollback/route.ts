import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { VersionNotFoundError, rollbackVersionSteps } from "@apigent/server/versions";
import { triggerVectorize } from "@apigent/server/vectorize";
import { assertRepoAccess, ForbiddenError } from "@apigent/server/authz";
import { withRoute } from "@/lib/route";

const bodySchema = z.object({
  /** 往回走 N 步（默认 1） */
  steps: z.number().int().min(1).max(100).optional(),
});

/** 回滚（R1，移指针）：POST /api/repos/:id/versions/:versionId/rollback */
export const POST = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id, versionId } = await params;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // 允许空 body
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    await assertRepoAccess(user.id, id, "repo_admin");
    const commitId = await rollbackVersionSteps(id, versionId, parsed.data.steps ?? 1);
    // 同激活：回滚把 head 指回旧 commit，那里可能还没被索引过（P0-4 说内容寻址
    // 让回滚「零重索引」，前提是那个 commit 的 link 已经存在）。
    await triggerVectorize(id, user.id, { trigger: "version_activate", commitId });
    return NextResponse.json({ ok: true, commitId });
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
