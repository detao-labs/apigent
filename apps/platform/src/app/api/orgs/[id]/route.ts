import { NextResponse } from "next/server";
import { getOrgDetail, updateOrg } from "@/services/orgs";
import { OrgNotEmptyError, OrgNotFoundError, deleteOrganization } from "@/services/org-deletion";
import { orgUpdateBodySchema } from "@/lib/openapi-schemas";
import { ForbiddenError } from "@apigent/server/authz";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params, user }) => {
  const { id } = await params;
  try {
    const org = await getOrgDetail(id, user.id);
    if (!org) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    return NextResponse.json({ org });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});

export const PATCH = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  const parsed = orgUpdateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    const org = await updateOrg(id, parsed.data, user.id);
    if (!org) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    return NextResponse.json({ org });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});

/** 删除组织。DELETE /api/orgs/:id —— 需要 org_owner，且其下已无仓库。 */
export const DELETE = withRoute({ auth: true }, async ({ params, user }) => {
  const { id } = await params;
  try {
    const result = await deleteOrganization(id, user.id);
    return NextResponse.json({ ok: true, name: result.name });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof OrgNotFoundError) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    if (err instanceof OrgNotEmptyError) {
      // 409 + 剩余仓库数：前端据此提示"先删完仓库"
      return NextResponse.json(
        { error: "org-not-empty", repositoryCount: err.repositoryCount },
        { status: 409 },
      );
    }
    console.error("[orgs DELETE]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
