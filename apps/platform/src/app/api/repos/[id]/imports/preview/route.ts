import { NextResponse } from "next/server";
import { RepoNotFoundError, previewImport } from "@/services/imports";
import { importContentBodySchema } from "@/lib/openapi-schemas";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

export const POST = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_member");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  const parsed = importContentBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    const preview = await previewImport(id, parsed.data.content);
    return NextResponse.json({ preview });
  } catch (err) {
    if (err instanceof RepoNotFoundError) {
      return NextResponse.json({ error: "repo-not-found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
