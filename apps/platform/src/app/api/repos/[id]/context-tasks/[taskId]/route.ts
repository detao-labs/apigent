import { NextResponse } from "next/server";
import { getContextTask } from "@apigent/server/contexts";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params, user }) => {
  const { id, taskId } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_viewer");
  if (denied) return denied;

  const task = await getContextTask(id, taskId);
  if (!task) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  return NextResponse.json({ task });
});
