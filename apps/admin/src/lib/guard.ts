// ═══════════════════════════════════════════════════════════════════
// Admin Guard — API 路由的能力断言
// ═══════════════════════════════════════════════════════════════════
//
// 服务端组件的门禁在 (authed)/layout.tsx；这里是给 **API 路由**用的：
// 页面隐藏按钮不算权限，写操作必须自己再断言一次能力。
// ═══════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { roleHasAdminCapability, type AdminCapability } from "@apigent/server/authz";
import { getAdminSessionUser, type AdminSessionUser } from "@/services/auth";

export type AdminApiGuard =
  { admin: AdminSessionUser; error?: never } | { admin?: never; error: NextResponse };

export async function requireAdminApi(capability: AdminCapability): Promise<AdminApiGuard> {
  const admin = await getAdminSessionUser();
  if (!admin) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!roleHasAdminCapability(admin.role, capability)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { admin };
}
