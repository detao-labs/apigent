import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import {
  createContextTask,
  DuplicateContextTaskError,
  RepoNotFoundError,
} from "@apigent/server/contexts";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  let body: { endpointIds?: unknown; force?: unknown } = {};
  try {
    body = (await request.json()) as { endpointIds?: unknown; force?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  const endpointIds = Array.isArray(body.endpointIds)
    ? body.endpointIds.filter((v): v is string => typeof v === "string")
    : undefined;
  const force = body.force === true;

  try {
    const task = await createContextTask(id, user.id, {
      scope: { endpointIds, force },
    });
    return NextResponse.json({ task }, { status: 202 });
  } catch (err) {
    if (err instanceof DuplicateContextTaskError) {
      return NextResponse.json(
        { error: "context-task-in-progress", taskId: err.activeTaskId },
        { status: 409 },
      );
    }
    if (err instanceof RepoNotFoundError) {
      return NextResponse.json({ error: "repo-not-found" }, { status: 404 });
    }
    console.error("[contexts/generate]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
