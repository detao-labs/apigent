import { NextResponse } from "next/server";
import { AdminMemberError, grantAdminRole } from "@apigent/server/admin";
import { requireAdminApi } from "@/lib/guard";

/** 授予平台管理员。POST /api/admins —— 需要 admin:admins:manage。 */
export async function POST(request: Request) {
  const guard = await requireAdminApi("admin:admins:manage");
  if (guard.error) return guard.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid-json" }, { status: 400 });
  }
  const raw = (body ?? {}) as { email?: unknown };
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  if (!email) return NextResponse.json({ error: "invalid-input" }, { status: 400 });

  try {
    const result = await grantAdminRole({
      email,
      actorId: guard.admin.id,
      source: "webapp",
    });
    return NextResponse.json({ member: result }, { status: result.granted ? 201 : 200 });
  } catch (err) {
    if (err instanceof AdminMemberError) {
      // user-not-found → 404；already-admin 等 → 409
      const status = err.code === "user-not-found" ? 404 : 409;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error("[admin/admins POST]", err);
    return NextResponse.json({ error: "internal" }, { status: 500 });
  }
}
