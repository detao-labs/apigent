import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { activateVersion, VersionNotFoundError } from "@apigent/server/versions";
import { assertRepoAccess, ForbiddenError } from "@apigent/server/authz";

/** 设为当前版本（回滚）：POST /api/repos/:id/versions/:versionId/activate */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, versionId } = await params;

  try {
    await assertRepoAccess(user.id, id, "repo_admin");
    await activateVersion(id, versionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof VersionNotFoundError) {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
