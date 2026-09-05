import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { getRepoComponentDefs, type ComponentKind } from "@/services/repos";
import { ForbiddenError } from "@apigent/server/authz";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const kind = new URL(request.url).searchParams.get("kind") as
    | ComponentKind
    | null;

  try {
    const components = await getRepoComponentDefs(
      id,
      user.id,
      kind ?? undefined,
    );
    return NextResponse.json({ components });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
