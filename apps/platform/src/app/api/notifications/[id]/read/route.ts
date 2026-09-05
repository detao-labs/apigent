import { NextResponse } from "next/server";
import { markNotificationRead } from "@apigent/server/notifications";
import { withRoute } from "@/lib/route";

export const POST = withRoute({ auth: true }, async ({ params, user }) => {
  const { id } = await params;
  const updated = await markNotificationRead(id, user.id);
  return NextResponse.json({ updated });
});
