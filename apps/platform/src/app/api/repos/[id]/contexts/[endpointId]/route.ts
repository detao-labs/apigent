import { NextResponse } from "next/server";
import { triggerVectorize } from "@apigent/server/vectorize";
import { getEndpointContext, saveEndpointContext } from "@/services/contexts";
import { guardRepoAccess } from "@/lib/repo-guard";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params, user }) => {
  const { id, endpointId } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_viewer");
  if (denied) return denied;

  const context = await getEndpointContext(id, endpointId);
  if (!context) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  return NextResponse.json({ context });
});

export const PUT = withRoute({ auth: true }, async ({ request, params, user }) => {
  const { id, endpointId } = await params;
  const denied = await guardRepoAccess(user.id, id, "repo_member");
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }

  try {
    await saveEndpointContext(id, endpointId, body as Parameters<typeof saveEndpointContext>[2], {
      source: "human",
    });
    // 摄取触发点之一：业务上下文保存（人工编辑）。走全量对账而不是只重索引这个
    // 接口 —— 只有全量模式才会做删除对账，而未变内容会命中 content_hash 复用、
    // 不花 embedding 的钱（P4-6）。
    await triggerVectorize(id, user.id, { trigger: "context_saved" });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Endpoint not found") {
      return NextResponse.json({ error: "not-found" }, { status: 404 });
    }
    if (err instanceof Error && err.message === "invalid business context payload") {
      return NextResponse.json({ error: "invalid-context" }, { status: 400 });
    }
    console.error("[contexts PUT]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
});
