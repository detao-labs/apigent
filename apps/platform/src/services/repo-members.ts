// ═══════════════════════════════════════════════════════════════════
// Repo Members Service — 仓库级角色覆盖（继承 vs 覆盖）
// ═══════════════════════════════════════════════════════════════════
//
// 模型（docs/tech-design.md §2.8.4）：
//   继承角色来自组织角色（org_owner→repo_admin、org_admin→repo_editor、
//   org_member→repo_viewer）；repo_permissions 是单个仓库的显式覆盖，
//   有效角色 = max(继承, 覆盖)——所以覆盖只能升权，永远不会降权。
//
// 组织成员管理留在组织页；仓库成员管理留在仓库设置页，都不进 Admin。
// ═══════════════════════════════════════════════════════════════════

import { and, eq } from "drizzle-orm";
import {
  ForbiddenError,
  assertRepoAccess,
  assignableRepoRoles,
  getEffectiveRepoRole,
  getUserOrgRole,
  isOverrideEffective,
  isRepoRoleAtLeast,
  orgRoleToRepoRole,
  resolveEffectiveRepoRole,
  type OrgRole,
  type RepoRole,
} from "@apigent/server/authz";
import {
  getDB,
  organizationMembers,
  organizations,
  repoPermissions,
  repositories,
  users,
} from "@apigent/server/db";

export type RepoMemberErrorCode =
  | "user-not-found"
  | "not-org-member"
  | "already-overridden"
  | "override-not-found"
  | "override-not-effective";

export class RepoMemberError extends Error {
  constructor(public readonly code: RepoMemberErrorCode) {
    super(code);
    this.name = "RepoMemberError";
  }
}

export interface RepoMemberRow {
  userId: string;
  name: string;
  email: string;
  /** 组织角色；非组织成员为 null */
  orgRole: OrgRole | null;
  isOrgMember: boolean;
  /** 由组织角色继承而来的仓库角色 */
  inheritedRole: RepoRole | null;
  /** 显式覆盖（repo_permissions），无覆盖为 null */
  overrideRole: RepoRole | null;
  /** max(继承, 覆盖) */
  effectiveRole: RepoRole;
  /** 可授予的覆盖角色（严格高于继承角色；org_owner 为空） */
  assignableRoles: RepoRole[];
}

export interface RepoMembersView {
  repoId: string;
  repoName: string;
  orgId: string;
  orgName: string;
  myRole: RepoRole;
  canManage: boolean;
  members: RepoMemberRow[];
}

interface RepoOrg {
  id: string;
  name: string;
  orgId: string;
  orgName: string;
}

async function loadRepoOrg(repoId: string): Promise<RepoOrg | null> {
  const [row] = await getDB()
    .select({
      id: repositories.id,
      name: repositories.name,
      orgId: repositories.orgId,
      orgName: organizations.name,
    })
    .from(repositories)
    .innerJoin(organizations, eq(organizations.id, repositories.orgId))
    .where(eq(repositories.id, repoId))
    .limit(1);
  return row ?? null;
}

interface Person {
  userId: string;
  name: string;
  email: string;
  orgRole: OrgRole | null;
}

function toRow(person: Person, overrideRole: RepoRole | null): RepoMemberRow {
  return {
    ...person,
    isOrgMember: person.orgRole !== null,
    inheritedRole: person.orgRole ? orgRoleToRepoRole(person.orgRole) : null,
    overrideRole,
    effectiveRole: resolveEffectiveRepoRole(person.orgRole, overrideRole)!,
    assignableRoles: assignableRepoRoles(person.orgRole),
  };
}

const RANK: Record<RepoRole, number> = { repo_viewer: 1, repo_editor: 2, repo_admin: 3 };

/**
 * 仓库成员视图：继承组（组织成员）+ 覆盖组（repo_permissions）。
 *
 * 已经不在组织里、但留着覆盖行的用户也会列出来——否则那行权限在界面上
 * 是不可见的，只能靠数据库排查。
 */
export async function listRepoMembers(repoId: string, actorId: string): Promise<RepoMembersView> {
  await assertRepoAccess(actorId, repoId, "repo_viewer");
  const repo = await loadRepoOrg(repoId);
  if (!repo) throw new ForbiddenError();

  const db = getDB();
  const [orgRows, ownerRows, overrideRows, myRole] = await Promise.all([
    db
      .select({
        userId: organizationMembers.userId,
        role: organizationMembers.role,
        name: users.name,
        email: users.email,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.orgId, repo.orgId)),
    db
      .select({ userId: organizations.ownerId, name: users.name, email: users.email })
      .from(organizations)
      .innerJoin(users, eq(users.id, organizations.ownerId))
      .where(eq(organizations.id, repo.orgId)),
    db
      .select({
        userId: repoPermissions.userId,
        role: repoPermissions.role,
        name: users.name,
        email: users.email,
      })
      .from(repoPermissions)
      .innerJoin(users, eq(users.id, repoPermissions.userId))
      .where(eq(repoPermissions.repoId, repoId)),
    getEffectiveRepoRole(actorId, repoId),
  ]);

  const people = new Map<string, Person>();
  for (const row of orgRows) {
    people.set(row.userId, {
      userId: row.userId,
      name: row.name,
      email: row.email,
      orgRole: row.role as OrgRole,
    });
  }
  // 组织 owner 兜底：旧数据可能没有 organization_members 行
  for (const row of ownerRows) {
    people.set(row.userId, {
      userId: row.userId,
      name: row.name,
      email: row.email,
      orgRole: "org_owner",
    });
  }
  for (const row of overrideRows) {
    if (!people.has(row.userId)) {
      people.set(row.userId, {
        userId: row.userId,
        name: row.name,
        email: row.email,
        orgRole: null,
      });
    }
  }

  const overrides = new Map(overrideRows.map((row) => [row.userId, row.role as RepoRole]));
  const members = Array.from(people.values())
    .map((person) => toRow(person, overrides.get(person.userId) ?? null))
    .sort((a, b) => RANK[b.effectiveRole] - RANK[a.effectiveRole] || a.name.localeCompare(b.name));

  return {
    repoId: repo.id,
    repoName: repo.name,
    orgId: repo.orgId,
    orgName: repo.orgName,
    myRole: myRole ?? "repo_viewer",
    canManage: isRepoRoleAtLeast(myRole, "repo_admin"),
    members,
  };
}

/**
 * 覆盖的写入前置校验：操作者需 repo_admin，目标需是组织成员，且覆盖必须
 * 真的提升有效角色（等于/低于继承角色的行是空操作，直接拒绝）。
 */
async function assertCanOverride(
  repoId: string,
  actorId: string,
  targetUserId: string,
  role: RepoRole,
): Promise<RepoOrg> {
  await assertRepoAccess(actorId, repoId, "repo_admin");
  const repo = await loadRepoOrg(repoId);
  if (!repo) throw new ForbiddenError();

  const [target] = await getDB()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);
  if (!target) throw new RepoMemberError("user-not-found");

  const orgRole = await getUserOrgRole(target.id, repo.orgId);
  if (!orgRole) throw new RepoMemberError("not-org-member");
  if (!isOverrideEffective(orgRole, role)) {
    throw new RepoMemberError("override-not-effective");
  }
  return repo;
}

async function findOverride(repoId: string, userId: string): Promise<RepoRole | null> {
  const [row] = await getDB()
    .select({ role: repoPermissions.role })
    .from(repoPermissions)
    .where(and(eq(repoPermissions.repoId, repoId), eq(repoPermissions.userId, userId)))
    .limit(1);
  return (row?.role as RepoRole) ?? null;
}

/** 授予仓库级覆盖角色。 */
export async function grantRepoPermission(
  repoId: string,
  actorId: string,
  input: { userId: string; role: RepoRole },
): Promise<RepoMemberRow> {
  await assertCanOverride(repoId, actorId, input.userId, input.role);
  if (await findOverride(repoId, input.userId)) {
    throw new RepoMemberError("already-overridden");
  }

  await getDB().insert(repoPermissions).values({ repoId, userId: input.userId, role: input.role });
  return loadMemberRow(repoId, input.userId);
}

/** 变更已有覆盖角色。 */
export async function updateRepoPermission(
  repoId: string,
  actorId: string,
  targetUserId: string,
  role: RepoRole,
): Promise<RepoMemberRow> {
  await assertCanOverride(repoId, actorId, targetUserId, role);
  if (!(await findOverride(repoId, targetUserId))) {
    throw new RepoMemberError("override-not-found");
  }

  await getDB()
    .update(repoPermissions)
    .set({ role })
    .where(and(eq(repoPermissions.repoId, repoId), eq(repoPermissions.userId, targetUserId)));
  return loadMemberRow(repoId, targetUserId);
}

/** 撤销覆盖：成员回落到组织继承角色，人仍在组织里。 */
export async function revokeRepoPermission(
  repoId: string,
  actorId: string,
  targetUserId: string,
): Promise<void> {
  await assertRepoAccess(actorId, repoId, "repo_admin");
  const deleted = await getDB()
    .delete(repoPermissions)
    .where(and(eq(repoPermissions.repoId, repoId), eq(repoPermissions.userId, targetUserId)))
    .returning({ userId: repoPermissions.userId });
  if (deleted.length === 0) throw new RepoMemberError("override-not-found");
}

/** 重新读取单个成员行（写入后返回给前端）。 */
async function loadMemberRow(repoId: string, userId: string): Promise<RepoMemberRow> {
  const orgId = (await loadRepoOrg(repoId))?.orgId;
  const [user] = await getDB()
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new RepoMemberError("user-not-found");

  const orgRole = orgId ? await getUserOrgRole(user.id, orgId) : null;
  return toRow(
    { userId: user.id, name: user.name, email: user.email, orgRole },
    await findOverride(repoId, user.id),
  );
}
