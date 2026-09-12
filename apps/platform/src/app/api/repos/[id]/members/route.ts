import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { ForbiddenError } from "@apigent/server/authz";
import {
  RepoMemberError,
  grantRepoPermission,
  listRepoMembers,
} from "@/services/repo-members";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

const repoPermissionBodySchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["repo_viewer", "repo_editor", "repo_admin"]),
});

/** 仓库成员相关的领域错误 → HTTP 状态码。 */
function memberErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof ForbiddenError) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (err instanceof RepoMemberError) {
    if (err.code === "override-not-effective") {
      return NextResponse.json({ error: err.code }, { status: 422 });
    }
    if (err.code === "user-not-found" || err.code === "override-not-found") {
      return NextResponse.json({ error: err.code }, { status: 404 });
    }
    return NextResponse.json({ error: err.code }, { status: 409 });
  }
  return null;
}

/** 成员列表：继承（组织成员）+ 覆盖（repo_permissions）。GET /api/repos/:id/members */
export const GET = withRoute({ auth: true }, async ({ params, user }) => {
  const { id } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_viewer");
  if (denied) return denied;

  try {
    return NextResponse.json(await listRepoMembers(id, user.id));
  } catch (err) {
    const mapped = memberErrorResponse(err);
    if (mapped) return mapped;
    console.error("[repos members GET]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});

/** 授予仓库级覆盖角色。POST /api/repos/:id/members */
export const POST = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_admin");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }
  const parsed = repoPermissionBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    const member = await grantRepoPermission(id, user.id, parsed.data);
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    const mapped = memberErrorResponse(err);
    if (mapped) return mapped;
    console.error("[repos members POST]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
