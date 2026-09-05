import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import {
  AlreadyMemberError,
  UserNotFoundError,
  getOrgDetail,
  inviteOrgMember,
} from "@/services/orgs";
import { ForbiddenError } from "@apigent/server/authz";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  try {
    const org = await getOrgDetail(id, user.id);
    if (!org) return NextResponse.json({ error: "not-found" }, { status: 404 });
    return NextResponse.json({ members: org.members, myRole: org.myRole });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  let body: { email?: string; role?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-input" }, { status: 400 });
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = body.role === "org_admin" ? "org_admin" : "org_member";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "invalid-email" }, { status: 400 });
  }

  try {
    const member = await inviteOrgMember(id, user.id, { email, role });
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (err instanceof UserNotFoundError) {
      return NextResponse.json({ error: "user-not-found" }, { status: 404 });
    }
    if (err instanceof AlreadyMemberError) {
      return NextResponse.json({ error: "already-member" }, { status: 409 });
    }
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
