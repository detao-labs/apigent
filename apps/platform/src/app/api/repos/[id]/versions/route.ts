import { NextResponse } from "next/server";
import {
  createImportTask,
  DuplicateImportError,
  ImportError,
  RepoNotFoundError,
} from "@apigent/server/imports";
import { importContentBodySchema } from "@/lib/openapi-schemas";
import { withRoute } from "@/lib/route";

/**
 * 异步提交导入：202 Accepted + { taskId, status }。
 * 解析/落库由队列 Worker 后台执行，进度通过
 * GET /api/repos/:id/import-tasks/:taskId 查询。
 */
export const POST = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  const parsed = importContentBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    const task = await createImportTask(id, user.id, parsed.data.content);
    return NextResponse.json({ task }, { status: 202 });
  } catch (err) {
    if (err instanceof ImportError) {
      return NextResponse.json({ error: "invalid-openapi", issues: err.issues }, { status: 422 });
    }
    if (err instanceof RepoNotFoundError) {
      return NextResponse.json({ error: "repo-not-found" }, { status: 404 });
    }
    if (err instanceof DuplicateImportError) {
      return NextResponse.json(
        { error: "import-in-progress", taskId: err.activeTaskId },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
