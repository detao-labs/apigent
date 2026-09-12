import { NextResponse } from "next/server";
import { listOperationLogs } from "@apigent/server/audit";
import { parsePagination } from "@/lib/pagination";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

/** 仓库操作日志。GET /api/repos/:id/operations —— 只读，repo_viewer 即可。 */
export const GET = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_viewer");
  if (denied) return denied;

  const { limit, offset } = parsePagination(new URL(request.url));
  const page = await listOperationLogs({ repositoryId: id, limit, offset });
  return NextResponse.json(page);
});
