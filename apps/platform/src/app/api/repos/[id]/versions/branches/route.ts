import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { createVersion, VersionNotFoundError } from "@apigent/server/versions";
import { assertRepoAccess, ForbiddenError } from "@apigent/server/authz";
import { withRoute } from "@/lib/route";

const bodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  /** 基于哪个版本 fork；缺省用默认主版本 */
  parentVersionId: z.string().optional(),
  /** 空树新建 */
  empty: z.boolean().optional(),
});

/** 新建版本（分支）：POST /api/repos/:id/versions/branches */
export const POST = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    await assertRepoAccess(user.id, id, "repo_editor");
    const versionId = await createVersion(id, {
      name: parsed.data.name,
      parentVersionId: parsed.data.parentVersionId,
      empty: parsed.data.empty,
    });
    return NextResponse.json({ versionId }, { status: 201 });
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
