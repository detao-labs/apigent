// ═══════════════════════════════════════════════════════════════════
// Repo Members Service — 仓库成员（仓库有自己的成员与角色）
// ═══════════════════════════════════════════════════════════════════
//
// 模型（docs/tech-design.md §2.8）：
//   - 仓库目录全站可见；仓库内容由 repository_members 决定
//   - 组织角色只提供隐式成员：org_owner → repo_owner、org_admin → repo_admin
//   - org_member 不隐含任何仓库角色，必须被显式加进来才能访问内容
//   - 有效角色 = max(组织隐含, 显式成员)，所以显式行的角色必须真的改变目标的
//     有效角色；等于或低于其隐含角色的行会在写入时被拒绝
//
// 组织成员管理留在组织页；仓库成员管理在仓库设置页，都不进 Admin。
// ═══════════════════════════════════════════════════════════════════

import { and, eq, inArray } from "drizzle-orm";
import {
  ForbiddenError,
  assertRepoAccess,
  getEffectiveRepoRole,
  getUserOrgRole,
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
  repositoryMembers,
  repositories,
  users,
} from "@apigent/server/db";

export type RepoMemberErrorCode =
  "user-not-found" | "not-org-member" | "already-member" | "member-not-found";

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
  /** 显式写入 repository_members 的角色；隐式成员为 null */
  explicitRole: RepoRole | null;
  /** 成员来源：显式添加 / 组织角色隐含 */
  source: "explicit" | "implied";
  /** 由组织角色隐含的仓库角色 */
  impliedRole: RepoRole | null;
  /** 有效角色 = max(隐含, 显式) */
  effectiveRole: RepoRole;
}

export interface RepoMembersView {
  repoId: string;
  repoName: string;
  orgId: string;
  orgName: string;
  myRole: RepoRole;
  canManage: boolean;
  members: RepoMemberRow[];
  /** 可添加为显式成员的组织成员（排除已有显式行、以及无可授予角色的人） */
  candidates: RepoMemberCandidate[];
}

export interface RepoMemberCandidate {
  userId: string;
  name: string;
  email: string;
  orgRole: OrgRole | null;
  /** 已经作为组织管理员/拥有者隐含拥有仓库？ */
  implied: boolean;
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
  explicitRole: RepoRole | null;
}

function toRow(person: Person): RepoMemberRow {
  return {
    userId: person.userId,
    name: person.name,
    email: person.email,
    orgRole: person.orgRole,
    explicitRole: person.explicitRole,
    source: person.explicitRole ? "explicit" : "implied",
    impliedRole: orgRoleToRepoRole(person.orgRole),
    effectiveRole: resolveEffectiveRepoRole(person.orgRole, person.explicitRole)!,
  };
}

const RANK: Record<RepoRole, number> = {
  repo_viewer: 1,
  repo_member: 2,
  repo_admin: 3,
  repo_owner: 4,
};

// 仓库成员列表 = 显式成员（repository_members）+ 隐式成员（该组织的 admin / owner）。
// 隐式成员也列出来，否则"组织管理员本来就能打开这个仓库"这件事在界面上是看
// 不见的，只能靠读代码推断。
export async function listRepoMembers(repoId: string, actorId: string): Promise<RepoMembersView> {
  await assertRepoAccess(actorId, repoId, "repo_viewer");
  const repo = await loadRepoOrg(repoId);
  if (!repo) throw new ForbiddenError();

  const db = getDB();
  const [orgRows, ownerRows, explicitRows, myRole] = await Promise.all([
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
        userId: repositoryMembers.userId,
        role: repositoryMembers.role,
        name: users.name,
        email: users.email,
      })
      .from(repositoryMembers)
      .innerJoin(users, eq(users.id, repositoryMembers.userId))
      .where(eq(repositoryMembers.repoId, repoId)),
    getEffectiveRepoRole(actorId, repoId),
  ]);

  const profiles = new Map<string, { name: string; email: string; orgRole: OrgRole | null }>();
  for (const row of orgRows) {
    profiles.set(row.userId, { name: row.name, email: row.email, orgRole: row.role as OrgRole });
  }
  // 组织 owner 兜底：旧数据可能没有 organization_members 行
  for (const row of ownerRows) {
    profiles.set(row.userId, { name: row.name, email: row.email, orgRole: "org_owner" });
  }
  for (const row of explicitRows) {
    if (!profiles.has(row.userId)) {
      profiles.set(row.userId, { name: row.name, email: row.email, orgRole: null });
    }
  }

  const explicitRoles = new Map(explicitRows.map((row) => [row.userId, row.role as RepoRole]));

  // 参与者 = 显式成员 ∪ 组织的 admin/owner
  const participants = new Set<string>(explicitRoles.keys());
  for (const [userId, profile] of profiles) {
    if (profile.orgRole === "org_admin" || profile.orgRole === "org_owner") {
      participants.add(userId);
    }
  }

  const members = Array.from(participants)
    .flatMap((userId) => {
      const profile = profiles.get(userId);
      if (!profile) return [];
      return [
        toRow({
          userId,
          name: profile.name,
          email: profile.email,
          orgRole: profile.orgRole,
          explicitRole: explicitRoles.get(userId) ?? null,
        }),
      ];
    })
    .sort((a, b) => RANK[b.effectiveRole] - RANK[a.effectiveRole] || a.name.localeCompare(b.name));

  const candidates = Array.from(profiles.entries())
    .flatMap(([userId, profile]) => {
      if (explicitRoles.has(userId)) return [];
      return [
        {
          userId,
          name: profile.name,
          email: profile.email,
          orgRole: profile.orgRole,
          implied: profile.orgRole === "org_admin" || profile.orgRole === "org_owner",
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    repoId: repo.id,
    repoName: repo.name,
    orgId: repo.orgId,
    orgName: repo.orgName,
    myRole: myRole ?? "repo_viewer",
    canManage: isRepoRoleAtLeast(myRole, "repo_admin"),
    members,
    candidates,
  };
}

// 写入前置校验：操作者需 repo_admin+，目标需是组织成员。显式行可以高于或低于
// 目标的组织隐含角色——低于时就是对这个仓库单独收口。
async function assertCanManageMember(
  repoId: string,
  actorId: string,
  targetUserId: string,
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
  return repo;
}

async function findMemberRole(repoId: string, userId: string): Promise<RepoRole | null> {
  const [row] = await getDB()
    .select({ role: repositoryMembers.role })
    .from(repositoryMembers)
    .where(and(eq(repositoryMembers.repoId, repoId), eq(repositoryMembers.userId, userId)))
    .limit(1);
  return (row?.role as RepoRole) ?? null;
}

// 重新读取单个成员行（写入后返回给前端）。
async function loadMemberRow(repoId: string, userId: string): Promise<RepoMemberRow> {
  const orgId = (await loadRepoOrg(repoId))?.orgId;
  const [user] = await getDB()
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new RepoMemberError("user-not-found");

  const orgRole = orgId ? await getUserOrgRole(user.id, orgId) : null;
  return toRow({
    userId: user.id,
    name: user.name,
    email: user.email,
    orgRole,
    explicitRole: await findMemberRole(repoId, user.id),
  });
}

// 添加仓库成员。
export async function addRepoMember(
  repoId: string,
  actorId: string,
  input: { userId: string; role: RepoRole },
): Promise<RepoMemberRow> {
  await assertCanManageMember(repoId, actorId, input.userId);
  if (await findMemberRole(repoId, input.userId)) {
    throw new RepoMemberError("already-member");
  }

  await getDB()
    .insert(repositoryMembers)
    .values({ repoId, userId: input.userId, role: input.role, grantedBy: actorId });
  return loadMemberRow(repoId, input.userId);
}

// 变更成员角色。
export async function updateRepoMember(
  repoId: string,
  actorId: string,
  targetUserId: string,
  role: RepoRole,
): Promise<RepoMemberRow> {
  await assertCanManageMember(repoId, actorId, targetUserId);
  if (!(await findMemberRole(repoId, targetUserId))) {
    throw new RepoMemberError("member-not-found");
  }

  await getDB()
    .update(repositoryMembers)
    .set({ role })
    .where(and(eq(repositoryMembers.repoId, repoId), eq(repositoryMembers.userId, targetUserId)));
  return loadMemberRow(repoId, targetUserId);
}

// 移除仓库成员。只能删显式的 repository_members 行；组织管理员/拥有者是隐式的、不在
// 表里，所以"移除"对他们无效——要收回得改组织角色。
export async function removeRepoMember(
  repoId: string,
  actorId: string,
  targetUserId: string,
): Promise<void> {
  await assertRepoAccess(actorId, repoId, "repo_admin");
  const deleted = await getDB()
    .delete(repositoryMembers)
    .where(and(eq(repositoryMembers.repoId, repoId), eq(repositoryMembers.userId, targetUserId)))
    .returning({ userId: repositoryMembers.userId });
  if (deleted.length === 0) throw new RepoMemberError("member-not-found");
}

// 批量查询某用户在给定仓库集合上的显式成员角色（列表页标记"能不能打开"）。
export async function listRepoMemberRoles(
  repoIds: string[],
  userId: string,
): Promise<Map<string, RepoRole>> {
  if (repoIds.length === 0) return new Map();
  const rows = await getDB()
    .select({ repoId: repositoryMembers.repoId, role: repositoryMembers.role })
    .from(repositoryMembers)
    .where(and(eq(repositoryMembers.userId, userId), inArray(repositoryMembers.repoId, repoIds)));
  return new Map(rows.map((row) => [row.repoId, row.role as RepoRole]));
}
