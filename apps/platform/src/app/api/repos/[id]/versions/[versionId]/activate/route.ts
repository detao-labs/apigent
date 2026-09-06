import { NextResponse } from "next/server";
import { setDefaultVersion, VersionNotFoundError } from "@apigent/server/versions";
import { assertRepoAccess, ForbiddenError } from "@apigent/server/authz";
import { withRoute } from "@/lib/route";

/** 设为默认/主版本：POST /api/repos/:id/versions/:versionId/activate */
export const POST = withRoute({ auth: true }, async ({ params, user }) => {
  const { id, versionId } = await params;

  try {
    await assertRepoAccess(user.id, id, "repo_admin");
    await setDefaultVersion(id, versionId);
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
});
