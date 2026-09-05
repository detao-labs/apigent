import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { MemberNotFoundError, transferOrgOwnership } from "@/services/orgs";
import { ForbiddenError } from "@apigent/server/authz";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  let body: { targetUserId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }
  const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId : "";
  if (!targetUserId) {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }

  try {
    await transferOrgOwnership(id, user.id, targetUserId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof MemberNotFoundError) {
      return NextResponse.json({ error: "member-not-found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
