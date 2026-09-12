import { NextResponse } from "next/server";
import { updateRepo } from "@/services/repos";
import { RepoNotFoundError, deleteRepository } from "@/services/repo-deletion";
import { repoUpdateBodySchema } from "@/lib/openapi-schemas";
import { ForbiddenError } from "@apigent/server/authz";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

export const PATCH = withRoute({ auth: true }, async ({ request, params, user }) => {
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
});

/** 删除仓库。DELETE /api/repos/:id —— 需要 repo_owner。 */
export const DELETE = withRoute({ auth: true }, async ({ params, user }) => {
  const { id } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_owner");
  if (denied) return denied;

  try {
    const result = await deleteRepository(id, user.id);
    return NextResponse.json({
      ok: true,
      name: result.name,
      organizationId: result.organizationId,
    });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof RepoNotFoundError) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    console.error("[repos DELETE]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
