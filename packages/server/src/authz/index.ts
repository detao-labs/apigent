// ═══════════════════════════════════════════════════════════════════
// RBAC — 组织角色 + 仓库权限（继承 / 覆盖）
// ═══════════════════════════════════════════════════════════════════
//
// 模型（见 docs/tech-design.md §2.8）：
//   - org_owner  → 继承 repo_admin
//   - org_admin  → 继承 repo_editor
//   - org_member → 继承 repo_viewer
//   - repo_permissions（userId, repoId, role）可覆盖为 repo_admin / repo_editor / repo_viewer
// 有效仓库角色 = max(继承角色, 覆盖角色)。平台级 platform_admin 暂不纳入 V0。
// ═══════════════════════════════════════════════════════════════════

import { and, eq, inArray } from "drizzle-orm";
import {
  getDB,
  organizationMembers,
  organizations,
  repoPermissions,
  repositories,
} from "../db";
import {
  ForbiddenError,
  isOrgRoleAtLeast,
  isRepoRoleAtLeast,
  orgRoleToRepoRole,
  resolveEffectiveRepoRole,
  type OrgRole,
  type RepoRole,
} from "./roles";
export {
  ForbiddenError,
  isOrgRoleAtLeast,
  isRepoRoleAtLeast,
  orgRoleToRepoRole,
  resolveEffectiveRepoRole,
  type OrgRole,
  type RepoRole,
} from "./roles";

export async function getUserOrgRole(
  userId: string,
  orgId: string,
): Promise<OrgRole | null> {
  const db = getDB();
  const [row] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.userId, userId),
        eq(organizationMembers.orgId, orgId),
      ),
    )
    .limit(1);
  if (row) return row.role as OrgRole;
  // 组织 owner 视为隐式 org_owner（兼容缺失成员行的旧数据）
  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  return org?.ownerId === userId ? "org_owner" : null;
}

export async function getRepoOverrideRole(
  userId: string,
  repoId: string,
): Promise<RepoRole | null> {
  const [row] = await getDB()
    .select({ role: repoPermissions.role })
    .from(repoPermissions)
    .where(
      and(
        eq(repoPermissions.userId, userId),
        eq(repoPermissions.repoId, repoId),
      ),
    )
    .limit(1);
  return (row?.role as RepoRole) ?? null;
}

/** 返回用户在仓库的有效角色；仓库不存在或无权限返回 null。 */
export async function getEffectiveRepoRole(
  userId: string,
  repoId: string,
): Promise<RepoRole | null> {
  const [repo] = await getDB()
    .select({ orgId: repositories.orgId })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  if (!repo) return null;
  const orgRole = await getUserOrgRole(userId, repo.orgId);
  const override = await getRepoOverrideRole(userId, repoId);
  return resolveEffectiveRepoRole(orgRole, override);
}

/** 断言用户至少具备仓库的 min 角色，否则抛 ForbiddenError。 */
export async function assertRepoAccess(
  userId: string,
  repoId: string,
  min: RepoRole = "repo_viewer",
): Promise<void> {
  const role = await getEffectiveRepoRole(userId, repoId);
  if (!isRepoRoleAtLeast(role, min)) throw new ForbiddenError();
}

/** 断言用户至少具备组织的 min 角色，否则抛 ForbiddenError。 */
export async function assertOrgRole(
  userId: string,
  orgId: string,
  min: OrgRole = "org_member",
): Promise<void> {
  const role = await getUserOrgRole(userId, orgId);
  if (!isOrgRoleAtLeast(role, min)) throw new ForbiddenError();
}

/** 用户所属（成员 + owner）的组织 ID。 */
async function getAccessibleOrgIds(userId: string): Promise<string[]> {
  const db = getDB();
  const [members, owned] = await Promise.all([
    db
      .select({ orgId: organizationMembers.orgId })
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, userId)),
    db
      .select({ orgId: organizations.id })
      .from(organizations)
      .where(eq(organizations.ownerId, userId)),
  ]);
  const ids = new Set<string>();
  for (const r of members) ids.add(r.orgId);
  for (const r of owned) ids.add(r.orgId);
  return Array.from(ids);
}

/** 用户可访问的仓库 ID（组织成员/owner 继承 + 显式覆盖）。 */
export async function listAccessibleRepoIds(userId: string): Promise<string[]> {
  const db = getDB();
  const [accessibleOrgs, directRepos] = await Promise.all([
    getAccessibleOrgIds(userId),
    db
      .select({ repoId: repoPermissions.repoId })
      .from(repoPermissions)
      .where(eq(repoPermissions.userId, userId)),
  ]);
  const ids = new Set<string>(directRepos.map((r) => r.repoId));
  if (accessibleOrgs.length > 0) {
    const repos = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(inArray(repositories.orgId, accessibleOrgs));
    for (const r of repos) ids.add(r.id);
  }
  return Array.from(ids);
}

/** 用户所属的组织 ID（成员 + owner）。 */
export async function listAccessibleOrgIds(userId: string): Promise<string[]> {
  return getAccessibleOrgIds(userId);
}
