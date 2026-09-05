import { NextResponse } from "next/server";
import { createOrg, listOrgs } from "@/services/orgs";
import { orgCreateBodySchema } from "@/lib/openapi-schemas";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ user }) => {
  return NextResponse.json({ orgs: await listOrgs(user.id) });
});

export const POST = withRoute({ auth: true }, async ({ request, user }) => {
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
});
