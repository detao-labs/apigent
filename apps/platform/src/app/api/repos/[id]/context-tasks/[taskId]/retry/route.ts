import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { retryContextTask } from "@apigent/server/contexts";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { taskId } = await params;
  try {
    const task = await retryContextTask(taskId);
    return NextResponse.json({ task });
  } catch (err) {
    if (err instanceof Error && /not retryable|not found/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[context-tasks/retry]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
