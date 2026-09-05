import { NextResponse } from "next/server";
import { getLatestContextTask } from "@apigent/server/contexts";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params }) => {
  const { id } = await params;
  const task = await getLatestContextTask(id);
  return NextResponse.json({ task });
});
