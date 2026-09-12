import { NextResponse } from "next/server";
import { retryImportTask } from "@apigent/server/imports";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

export const POST = withRoute({ auth: true }, async ({ params, user }) => {
  const { id, taskId } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_member");
  if (denied) return denied;

  try {
    const task = await retryImportTask(id, taskId, user.id);
    if (!task) {
      return NextResponse.json({ error: "task-not-found" }, { status: 404 });
    }
    return NextResponse.json({ task }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "not-retryable", message }, { status: 409 });
  }
});
