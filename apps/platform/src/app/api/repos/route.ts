import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { OrgNotFoundError, createRepo, listRepos } from "@/services/repos";
import { repoCreateBodySchema } from "@/lib/openapi-schemas";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ repos: await listRepos() });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  const parsed = repoCreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    const repo = await createRepo({
      orgId: parsed.data.orgId,
      name: parsed.data.name,
      description: parsed.data.description,
    });
    return NextResponse.json({ repo }, { status: 201 });
  } catch (err) {
    if (err instanceof OrgNotFoundError) {
      return NextResponse.json({ error: "org-not-found" }, { status: 400 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
