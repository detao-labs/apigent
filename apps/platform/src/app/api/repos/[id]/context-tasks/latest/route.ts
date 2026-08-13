import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";
import { getLatestContextTask } from "@apigent/server/contexts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const task = await getLatestContextTask(id);
  return NextResponse.json({ task });
}
