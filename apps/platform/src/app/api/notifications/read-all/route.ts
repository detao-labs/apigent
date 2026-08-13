import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { markAllNotificationsRead } from "@apigent/server/notifications";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const count = await markAllNotificationsRead(user.id);
  return NextResponse.json({ count });
}
