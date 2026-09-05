import { NextResponse } from "next/server";
import { getRepoComponentDefs, type ComponentKind } from "@/services/repos";
import { ForbiddenError } from "@apigent/server/authz";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id } = await params;
  const kind = new URL(request.url).searchParams.get("kind") as ComponentKind | null;

  try {
    const components = await getRepoComponentDefs(id, user.id, kind ?? undefined);
    return NextResponse.json({ components });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
