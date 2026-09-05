import { NextResponse } from "next/server";
import { getLatestImportTask } from "@apigent/server/imports";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params }) => {
  const { id } = await params;
  const task = await getLatestImportTask(id);
  return NextResponse.json({ task });
});
