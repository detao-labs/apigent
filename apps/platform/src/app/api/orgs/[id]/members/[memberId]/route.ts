import { NextResponse } from "next/server";
import {
  CannotModifyOwnerError,
  MemberNotFoundError,
  removeOrgMember,
  updateOrgMemberRole,
} from "@/services/orgs";
import { ForbiddenError } from "@apigent/server/authz";
import { withRoute } from "@/lib/route";

export const PATCH = withRoute({ auth: true }, async ({ request, params, user }) => {
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
});

export const DELETE = withRoute({ auth: true }, async ({ params, user }) => {
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
});
