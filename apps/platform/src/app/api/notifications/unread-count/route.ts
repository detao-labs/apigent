import { NextResponse } from "next/server";
import { unreadNotificationCount } from "@apigent/server/notifications";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ user }) => {
  const count = await unreadNotificationCount(user.id);
  return NextResponse.json({ count });
});
