import { NextResponse } from "next/server";
import { listEndpointContexts } from "@/services/contexts";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params, user }) => {
  const { id } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_viewer");
  if (denied) return denied;

  const contexts = await listEndpointContexts(id);
  return NextResponse.json({ contexts });
});
