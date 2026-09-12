// ═══════════════════════════════════════════════════════════════════
// Platform RBAC — 平台平面角色与能力（无 DB 依赖）
// ═══════════════════════════════════════════════════════════════════
//
// 平台平面（Admin Webapp）与租户平面（org_* / repo_*）是**两套独立体系**：
//
//   1. 平台角色永远不持有任何租户权限。能力名一律以 `admin:` 开头，任何
//      `repo:*` / `org:*` 出现在映射里都会让 admin-capabilities.test.ts 失败。
//   2. 因此 "admin 不能改租户数据" 是结构性质，而不是靠代码评审守住的约定。
//
// 与租户侧的区别：租户角色用 rank 直判（roles.ts 的 isRepoRoleAtLeast），平台
// 角色用显式能力映射——角色少、能力集固定，而且"角色 → 能力"必须可被测试断言。
//
// 本文件必须保持**零依赖**（可以安全地被客户端组件导入），所以它只放常量与
// 纯函数；查库的断言在 ./admin.ts。
//
// 设计见 docs/tech-design.md §2.8.5 / §2.8.6 / §2.8.7。
// ═══════════════════════════════════════════════════════════════════

/**
 * 平台角色。一个用户最多一行 admin_members，因此同时只有一个平台角色。
 *
 * 预留（未实现）：`admin_operator`（运营：账号生命周期、统计、审计）、
 * `admin_support`（支持：只读 + 少量受限操作）。刻意避开 `admin_member`
 * （与 org_member 的"最低权限"语义冲突）和 `admin_sub`（说不清能做什么）。
 */
export type AdminRole = "admin_super";

export const ADMIN_ROLES: readonly AdminRole[] = ["admin_super"];

/** 平台能力名：`admin:<domain>:<action>`。 */
export type AdminCapability =
  | "admin:admins:manage"
  | "admin:stats:view"
  | "admin:audit:view"
  | "admin:users:view"
  | "admin:users:disable"
  | "admin:users:delete";

export const ADMIN_CAPABILITIES: readonly AdminCapability[] = [
  "admin:admins:manage",
  "admin:stats:view",
  "admin:audit:view",
  "admin:users:view",
  "admin:users:disable",
  "admin:users:delete",
];

/**
 * 角色 → 能力。`admin_super` 持有 V0 的全部能力，且**只有**这些能力。
 *
 * 注意这里没有 `admin:content:read`：平台管理员默认读不到任何仓库内容
 * （docs/tech-design.md §2.8.6 把它列为待定项，默认不授予）。
 */
export const ADMIN_ROLE_CAPABILITIES: Record<AdminRole, readonly AdminCapability[]> = {
  admin_super: [...ADMIN_CAPABILITIES],
};

/** 是不是合法的平台角色（用于把 DB 里的 text 列收窄）。 */
export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}

/** 角色的能力集；无角色返回空数组。 */
export function adminCapabilitiesOf(
  role: AdminRole | null | undefined,
): readonly AdminCapability[] {
  return role ? ADMIN_ROLE_CAPABILITIES[role] : [];
}

export function roleHasAdminCapability(
  role: AdminRole | null | undefined,
  capability: AdminCapability,
): boolean {
  return role ? ADMIN_ROLE_CAPABILITIES[role].includes(capability) : false;
}
