import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { listEndpointContexts } from "@/services/contexts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const contexts = await listEndpointContexts(id);
  return NextResponse.json({ contexts });
}
