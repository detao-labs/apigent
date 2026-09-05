import { NextResponse } from "next/server";
import { getImportTask } from "@apigent/server/imports";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params, user }) => {
  const { taskId } = await params;
  const task = await getImportTask(taskId, user.id);
  if (!task) {
    return NextResponse.json({ error: "task-not-found" }, { status: 404 });
  }
  return NextResponse.json({ task });
});
