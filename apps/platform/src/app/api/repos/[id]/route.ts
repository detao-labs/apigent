import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { updateRepo } from "@/services/repos";
import { repoUpdateBodySchema } from "@/lib/openapi-schemas";
import { ForbiddenError } from "@apigent/server/authz";

export async function PATCH(
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

  const parsed = repoUpdateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    const repo = await updateRepo(id, parsed.data, user.id);
    return NextResponse.json({ repo });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof Error && err.message.startsWith("Repository not found")) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    console.error("[repos PATCH]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
