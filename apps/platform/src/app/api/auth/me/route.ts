import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { withRoute } from "@/lib/route";

export const GET = withRoute(async () => {
  const user = await getSessionUser();
  return NextResponse.json({ user });
});
