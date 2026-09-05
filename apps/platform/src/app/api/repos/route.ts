import { NextResponse } from "next/server";
import { OrgNotFoundError, createRepo, listRepos } from "@/services/repos";
import { repoCreateBodySchema } from "@/lib/openapi-schemas";
import { ForbiddenError } from "@apigent/server/authz";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ user }) => {
  return NextResponse.json({ repos: await listRepos(user.id) });
});

export const POST = withRoute({ auth: true }, async ({ request, user }) => {
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
    const repo = await createRepo(
      {
        orgId: parsed.data.orgId,
        name: parsed.data.name,
        description: parsed.data.description,
      },
      user.id,
    );
    return NextResponse.json({ repo }, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof OrgNotFoundError) {
      return NextResponse.json({ error: "org-not-found" }, { status: 400 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
