import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { getContextTask } from "@apigent/server/contexts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  const task = await getContextTask(taskId);
  if (!task) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  return NextResponse.json({ task });
}
