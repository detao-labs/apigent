import { NextResponse } from "next/server";
import { retryContextTask } from "@apigent/server/contexts";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

export const POST = withRoute({ auth: true }, async ({ params, user }) => {
  const { id, taskId } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_member");
  if (denied) return denied;

  try {
    const task = await retryContextTask(id, taskId);
    return NextResponse.json({ task });
  } catch (err) {
    if (err instanceof Error && /not retryable|not found/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[context-tasks/retry]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
