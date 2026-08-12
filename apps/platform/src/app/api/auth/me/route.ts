import { NextResponse } from "next/server";
import { getSessionUser } from "@/services/auth";

export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ user });
}
