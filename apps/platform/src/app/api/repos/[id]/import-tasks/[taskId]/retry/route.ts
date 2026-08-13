import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { retryImportTask } from "@apigent/server/imports";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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
}
