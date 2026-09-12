// ═══════════════════════════════════════════════════════════════════
// RBAC — 租户平面（组织角色 + 仓库成员）与平台平面（平台管理员）
// ═══════════════════════════════════════════════════════════════════
//
// **两套独立体系**：租户平面的 org_*/repo_* 管内容，平台平面的 admin_* 管
// 部署本身。平台角色不持有任何租户权限（见 admin-capabilities.ts 与它的测试）。
//
// 模型（见 docs/tech-design.md §2.8）：
//   - 仓库**目录**全站可见；仓库**内容**是显式成员制
//   - repository_members（repositoryId, userId, role）是访问仓库内容的唯一显式来源
//   - 组织角色只提供隐式成员：org_owner → repo_owner、org_admin → repo_admin
//   - org_member 不隐含任何仓库角色
// 有效仓库角色 = max(组织隐含, 显式成员)；为 null 即无权访问内容（→ 403）。
// ═══════════════════════════════════════════════════════════════════

import { and, eq, inArray } from "drizzle-orm";
import { getDB, organizationMembers, organizations, repositoryMembers, repositories } from "../db";
import {
  ForbiddenError,
  isOrgRoleAtLeast,
  isRepoRoleAtLeast,
  resolveEffectiveRepoRole,
  type OrgRole,
  type RepoRole,
} from "./roles";
export {
  ForbiddenError,
  REPO_ROLES,
  isOrgRoleAtLeast,
  isRepoRoleAtLeast,
  orgRoleToRepoRole,
  resolveEffectiveRepoRole,
  type OrgRole,
  type RepoRole,
} from "./roles";

// 平台平面：admin_super 与实际权限断言
export {
  ADMIN_CAPABILITIES,
  ADMIN_ROLES,
  ADMIN_ROLE_CAPABILITIES,
  adminCapabilitiesOf,
  assertAdminCapability,
  getAdminRole,
  hasAdminCapability,
  isAdminRole,
  roleHasAdminCapability,
  type AdminCapability,
  type AdminRole,
} from "./admin";

export async function getUserOrgRole(
  userId: string,
  organizationId: string,
): Promise<OrgRole | null> {
  const db = getDB();
  const [row] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (row) return row.role as OrgRole;
  // 组织 owner 视为隐式 org_owner（兼容缺失成员行的旧数据）
  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  return org?.ownerId === userId ? "org_owner" : null;
}

/** 用户在仓库上的显式成员角色；不是成员返回 null。 */
export async function getRepoMemberRole(
  userId: string,
  repositoryId: string,
): Promise<RepoRole | null> {
  const [row] = await getDB()
    .select({ role: repositoryMembers.role })
    .from(repositoryMembers)
    .where(
      and(eq(repositoryMembers.userId, userId), eq(repositoryMembers.repositoryId, repositoryId)),
    )
    .limit(1);
  return (row?.role as RepoRole) ?? null;
}

/**
 * 用户在仓库的有效角色；仓库不存在、或既非成员也无组织隐含角色时返回 null。
 * null 即"不能访问仓库内容"，API 层映射为 403（仓库不存在则是 404）。
 */
export async function getEffectiveRepoRole(
  userId: string,
  repositoryId: string,
): Promise<RepoRole | null> {
  const [repo] = await getDB()
    .select({ organizationId: repositories.organizationId })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .limit(1);
  if (!repo) return null;
  const orgRole = await getUserOrgRole(userId, repo.organizationId);
  const memberRole = await getRepoMemberRole(userId, repositoryId);
  return resolveEffectiveRepoRole(orgRole, memberRole);
}

/** 断言用户至少具备仓库的 min 角色，否则抛 ForbiddenError。 */
export async function assertRepoAccess(
  userId: string,
  repositoryId: string,
  min: RepoRole = "repo_viewer",
): Promise<void> {
  const role = await getEffectiveRepoRole(userId, repositoryId);
  if (!isRepoRoleAtLeast(role, min)) throw new ForbiddenError();
}

/** 断言用户至少具备组织的 min 角色，否则抛 ForbiddenError。 */
export async function assertOrgRole(
  userId: string,
  organizationId: string,
  min: OrgRole = "org_member",
): Promise<void> {
  const role = await getUserOrgRole(userId, organizationId);
  if (!isOrgRoleAtLeast(role, min)) throw new ForbiddenError();
}

/** 用户所属（成员 + owner）的组织 ID。 */
async function getAccessibleOrganizationIds(userId: string): Promise<string[]> {
  const db = getDB();
  const [members, owned] = await Promise.all([
    db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId)),
    db
      .select({ organizationId: organizations.id })
      .from(organizations)
      .where(eq(organizations.ownerId, userId)),
  ]);
  const ids = new Set<string>();
  for (const r of members) ids.add(r.organizationId);
  for (const r of owned) ids.add(r.organizationId);
  return Array.from(ids);
}

/** 用户以组织管理员/拥有者身份隐含掌握的组织 ID（org_admin+）。 */
async function getRepositoryAdminOrganizationIds(userId: string): Promise<string[]> {
  const db = getDB();
  const [adminRows, owned] = await Promise.all([
    db
      .select({ organizationId: organizationMembers.organizationId })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.userId, userId),
          inArray(organizationMembers.role, ["org_owner", "org_admin"]),
        ),
      ),
    db
      .select({ organizationId: organizations.id })
      .from(organizations)
      .where(eq(organizations.ownerId, userId)),
  ]);
  const ids = new Set<string>();
  for (const r of adminRows) ids.add(r.organizationId);
  for (const r of owned) ids.add(r.organizationId);
  return Array.from(ids);
}

/**
 * 用户**能访问内容**的仓库 ID。
 *
 * 仓库目录是全站可见的，这张列表只回答"哪些仓库的内容打得开"：
 * 显式 `repository_members` 行 ∪ 我是 org_admin/org_owner 的组织下全部仓库。
 * `org_member` 不隐含仓库角色，因此不计入。
 */
export async function listAccessibleRepositoryIds(userId: string): Promise<string[]> {
  const db = getDB();
  const [adminOrgs, memberships] = await Promise.all([
    getRepositoryAdminOrganizationIds(userId),
    db
      .select({ repositoryId: repositoryMembers.repositoryId })
      .from(repositoryMembers)
      .where(eq(repositoryMembers.userId, userId)),
  ]);
  const ids = new Set<string>(memberships.map((r) => r.repositoryId));
  if (adminOrgs.length > 0) {
    const repos = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(inArray(repositories.organizationId, adminOrgs));
    for (const r of repos) ids.add(r.id);
  }
  return Array.from(ids);
}

/** 用户所属的组织 ID（成员 + owner）。 */
export async function listAccessibleOrganizationIds(userId: string): Promise<string[]> {
  return getAccessibleOrganizationIds(userId);
}
