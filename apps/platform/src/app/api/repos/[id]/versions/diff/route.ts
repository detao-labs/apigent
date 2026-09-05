import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { compareVersions } from "@apigent/server/versions";
import { assertRepoAccess, ForbiddenError } from "@apigent/server/authz";

/** 版本对比（纯规则）：GET /api/repos/:id/versions/diff?from=&to= */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const sp = new URL(request.url).searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  if (!from || !to) {
    return NextResponse.json({ error: "missing-params" }, { status: 400 });
  }

  try {
    await assertRepoAccess(user.id, id, "repo_viewer");
    const diff = await compareVersions(id, from, to);
    return NextResponse.json({ diff });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
