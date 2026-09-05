import { NextResponse } from "next/server";
import { markAllNotificationsRead } from "@apigent/server/notifications";
import { withRoute } from "@/lib/route";

export const POST = withRoute({ auth: true }, async ({ user }) => {
  const count = await markAllNotificationsRead(user.id);
  return NextResponse.json({ count });
});
