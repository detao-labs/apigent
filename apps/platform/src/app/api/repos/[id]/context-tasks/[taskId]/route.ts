import { NextResponse } from "next/server";
import { getContextTask } from "@apigent/server/contexts";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params }) => {
  const { taskId } = await params;
  const task = await getContextTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  return NextResponse.json({ task });
});
