// ═══════════════════════════════════════════════════════════════════
// Platform RBAC — 查库的准入断言
// ═══════════════════════════════════════════════════════════════════
//
// 纯角色/能力映射在 ./admin-capabilities.ts（零依赖）；这里只做 DB 读取与断言。
//
//   getAdminRole(userId)                 → 平台角色，null 表示不是管理员
//   hasAdminCapability(userId, cap)      → 布尔
//   assertAdminCapability(userId, cap)   → 不足时抛 ForbiddenError（API 层映射 403）
//
// 调用方拿到的 ForbiddenError 与租户侧是同一个类，方便上层统一映射。
// ═══════════════════════════════════════════════════════════════════

import { eq } from "drizzle-orm";
import { getDB, adminMembers } from "../db";
import { ForbiddenError } from "./roles";
import {
  isAdminRole,
  roleHasAdminCapability,
  type AdminCapability,
  type AdminRole,
} from "./admin-capabilities";

export {
  ADMIN_CAPABILITIES,
  ADMIN_ROLES,
  ADMIN_ROLE_CAPABILITIES,
  adminCapabilitiesOf,
  isAdminRole,
  roleHasAdminCapability,
} from "./admin-capabilities";
export type { AdminCapability, AdminRole } from "./admin-capabilities";

/**
 * 用户的平台角色；不是管理员返回 null。
 *
 * `role` 列是 text，读出来必须过一遍 isAdminRole——历史上换个值（比如把
 * `is_platform_admin` 布尔期留下的脏数据）不应该变成"隐式拿到全部能力"。
 */
export async function getAdminRole(userId: string): Promise<AdminRole | null> {
  const [row] = await getDB()
    .select({ role: adminMembers.role })
    .from(adminMembers)
    .where(eq(adminMembers.userId, userId))
    .limit(1);
  return isAdminRole(row?.role) ? row.role : null;
}

/** 是否持有某个平台能力。 */
export async function hasAdminCapability(
  userId: string,
  capability: AdminCapability,
): Promise<boolean> {
  return roleHasAdminCapability(await getAdminRole(userId), capability);
}

/** 断言用户持有某个平台能力，否则抛 ForbiddenError。 */
export async function assertAdminCapability(
  userId: string,
  capability: AdminCapability,
): Promise<void> {
  if (!(await hasAdminCapability(userId, capability))) {
    throw new ForbiddenError();
  }
}
