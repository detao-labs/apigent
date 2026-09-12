import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { ForbiddenError } from "@apigent/server/authz";
import {
  RepoMemberError,
  revokeRepoPermission,
  updateRepoPermission,
} from "@/services/repo-members";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

const roleBodySchema = z.object({
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

/** 变更覆盖角色。PATCH /api/repos/:id/members/:userId */
export const PATCH = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id, memberId } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_admin");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }
  const parsed = roleBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    const member = await updateRepoPermission(id, user.id, memberId, parsed.data.role);
    return NextResponse.json({ member });
  } catch (err) {
    const mapped = memberErrorResponse(err);
    if (mapped) return mapped;
    console.error("[repos members PATCH]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});

/** 撤销覆盖：成员回落到组织继承角色。DELETE /api/repos/:id/members/:userId */
export const DELETE = withRoute({ auth: true }, async ({ params, user }) => {
  const { id, memberId } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_admin");
  if (denied) return denied;

  try {
    await revokeRepoPermission(id, user.id, memberId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const mapped = memberErrorResponse(err);
    if (mapped) return mapped;
    console.error("[repos members DELETE]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
