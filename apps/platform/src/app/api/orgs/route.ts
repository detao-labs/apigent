import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { createOrg, listOrgs } from "@/services/orgs";
import { orgCreateBodySchema } from "@/lib/openapi-schemas";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ orgs: await listOrgs() });
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  const parsed = orgCreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  const org = await createOrg({
    name: parsed.data.name,
    description: parsed.data.description,
    ownerId: user.id,
  });
  return NextResponse.json({ org }, { status: 201 });
}
