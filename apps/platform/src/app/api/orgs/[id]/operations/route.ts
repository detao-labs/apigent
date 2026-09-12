import { NextResponse } from "next/server";
import { listOperationLogs } from "@apigent/server/audit";
import { ForbiddenError, assertOrgRole } from "@apigent/server/authz";
import { parsePagination } from "@/lib/pagination";
import { withRoute } from "@/lib/route";

/** 组织操作日志。GET /api/orgs/:id/operations —— 只读，org_member 即可。 */
export const GET = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id } = await params;
  try {
    await assertOrgRole(user.id, id, "org_member");
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw err;
  }

  const { limit, offset } = parsePagination(new URL(request.url));
  const page = await listOperationLogs({ organizationId: id, limit, offset });
  return NextResponse.json(page);
});
