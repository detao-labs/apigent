import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import {
  ImportError,
  RepoNotFoundError,
  importVersion,
} from "@/services/imports";
import { importContentBodySchema } from "@/lib/openapi-schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  const parsed = importContentBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    const version = await importVersion(id, parsed.data.content);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    if (err instanceof ImportError) {
      return NextResponse.json(
        { error: "invalid-openapi", issues: err.issues },
        { status: 422 },
      );
    }
    if (err instanceof RepoNotFoundError) {
      return NextResponse.json({ error: "repo-not-found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
