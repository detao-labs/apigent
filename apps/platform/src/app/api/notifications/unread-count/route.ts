import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { unreadNotificationCount } from "@apigent/server/notifications";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const count = await unreadNotificationCount(user.id);
  return NextResponse.json({ count });
}
