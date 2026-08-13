import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { markNotificationRead } from "@apigent/server/notifications";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const updated = await markNotificationRead(id, user.id);
  return NextResponse.json({ updated });
}
