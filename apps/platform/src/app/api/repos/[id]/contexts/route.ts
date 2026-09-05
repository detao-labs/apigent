import { NextResponse } from "next/server";
import { listEndpointContexts } from "@/services/contexts";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params }) => {
  const { id } = await params;
  const contexts = await listEndpointContexts(id);
  return NextResponse.json({ contexts });
});
