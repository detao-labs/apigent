import { NextResponse } from "next/server";
import { getImportTask } from "@apigent/server/imports";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params, user }) => {
  const { id, taskId } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_viewer");
  if (denied) return denied;

  const task = await getImportTask(id, taskId, user.id);
  if (!task) {
    return NextResponse.json({ error: "task-not-found" }, { status: 404 });
  }
  return NextResponse.json({ task });
});
