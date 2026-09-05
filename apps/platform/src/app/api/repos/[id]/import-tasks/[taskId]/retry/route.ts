import { NextResponse } from "next/server";
import { retryImportTask } from "@apigent/server/imports";
import { withRoute } from "@/lib/route";

export const POST = withRoute({ auth: true }, async ({ params, user }) => {
  const { taskId } = await params;
  try {
    const task = await retryImportTask(taskId, user.id);
    if (!task) {
      return NextResponse.json({ error: "task-not-found" }, { status: 404 });
    }
    return NextResponse.json({ task }, { status: 202 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: "not-retryable", message }, { status: 409 });
  }
});
