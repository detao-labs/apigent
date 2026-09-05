import { NextResponse } from "next/server";
import { getEndpointContext, saveEndpointContext } from "@/services/contexts";
import { withRoute } from "@/lib/route";

export const GET = withRoute({ auth: true }, async ({ params }) => {
  const { id, endpointId } = await params;
  const context = await getEndpointContext(id, endpointId);
  if (!context) {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
  return NextResponse.json({ context });
});

export const PUT = withRoute({ auth: true }, async ({ request, params }) => {
  const { id, endpointId } = await params;
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
