import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import {
  CannotModifyOwnerError,
  MemberNotFoundError,
  removeOrgMember,
  updateOrgMemberRole,
} from "@/services/orgs";
import { ForbiddenError } from "@apigent/server/authz";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, memberId } = await params;
  let body: { role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }
  const role =
    body.role === "org_owner"
      ? "org_owner"
      : body.role === "org_admin"
        ? "org_admin"
        : "org_member";

  try {
    await updateOrgMemberRole(id, user.id, memberId, role);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof CannotModifyOwnerError) {
      return NextResponse.json({ error: "cannot-modify-owner" }, { status: 400 });
    }
    if (err instanceof MemberNotFoundError) {
      return NextResponse.json({ error: "member-not-found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id, memberId } = await params;
  try {
    await removeOrgMember(id, user.id, memberId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof CannotModifyOwnerError) {
      return NextResponse.json({ error: "cannot-modify-owner" }, { status: 400 });
    }
    if (err instanceof MemberNotFoundError) {
      return NextResponse.json({ error: "member-not-found" }, { status: 404 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
