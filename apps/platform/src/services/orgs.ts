// ═══════════════════════════════════════════════════════════════════
// Platform Orgs Service — list / get / create organizations
// ═══════════════════════════════════════════════════════════════════
//
// App-level service (single consumer today). If admin/open ever need org
// operations, move this to packages/server verbatim.
// ═══════════════════════════════════════════════════════════════════

import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import {
  endpoints,
  getDB,
  organizationMembers,
  organizations,
  repositories,
  users,
} from "@apigent/server/db";
import {
  ForbiddenError,
  assertOrgRole,
  getUserOrgRole,
  listAccessibleOrgIds,
} from "@apigent/server/authz";
import { generateId } from "@apigent/server/id";

export interface OrgSummary {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  repoCount: number;
  createdAt: Date;
}

export async function listOrgs(userId: string): Promise<OrgSummary[]> {
  const accessible = await listAccessibleOrgIds(userId);
  if (accessible.length === 0) return [];

  const rows = await getDB()
    .select({
      id: organizations.id,
      name: organizations.name,
      description: organizations.description,
      createdAt: organizations.createdAt,
      memberCount: sql<number>`${count(organizationMembers.userId)}::int`,
      repoCount: sql<number>`${count(repositories.id)}::int`,
    })
    .from(organizations)
    .leftJoin(
      organizationMembers,
      eq(organizationMembers.orgId, organizations.id),
    )
    .leftJoin(repositories, eq(repositories.orgId, organizations.id))
    .where(inArray(organizations.id, accessible))
    .groupBy(organizations.id)
    .orderBy(desc(organizations.createdAt));

  return rows.map((row) => ({
    ...row,
    memberCount: Number(row.memberCount ?? 0),
    repoCount: Number(row.repoCount ?? 0),
  }));
}

export async function getOrgById(id: string) {
  const [org] = await getDB()
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return org ?? null;
}

export async function updateOrg(
  id: string,
  input: { name?: string; description?: string },
  userId: string,
) {
  await assertOrgRole(userId, id, "org_admin");
  const [org] = await getDB()
    .update(organizations)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? {
            description:
              input.description.trim() !== "" ? input.description.trim() : null,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, id))
    .returning();
  return org ?? null;
}

export async function createOrg(input: {
  name: string;
  ownerId: string;
  description?: string;
}) {
  const db = getDB();
  const orgId = generateId("org");
  const [org] = await db
    .insert(organizations)
    .values({
      id: orgId,
      name: input.name,
      ownerId: input.ownerId,
      description:
        input.description && input.description.trim() !== ""
          ? input.description.trim()
          : null,
    })
    .returning();
  // 创建者即 org_owner，写入成员表，供 RBAC 生效
  await db.insert(organizationMembers).values({
    orgId,
    userId: input.ownerId,
    role: "org_owner",
  });
  return org;
}

export type OrgMemberRole = "org_owner" | "org_admin" | "org_member";

export class OrgNotFoundError extends Error {
  constructor(id: string) {
    super(`Organization not found: ${id}`);
    this.name = "OrgNotFoundError";
  }
}
export class MemberNotFoundError extends Error {
  constructor() {
    super("Member not found");
    this.name = "MemberNotFoundError";
  }
}
export class UserNotFoundError extends Error {
  constructor() {
    super("User not found");
    this.name = "UserNotFoundError";
  }
}
export class AlreadyMemberError extends Error {
  constructor() {
    super("Already a member");
    this.name = "AlreadyMemberError";
  }
}
export class CannotModifyOwnerError extends Error {
  constructor() {
    super("Cannot modify the owner directly; transfer ownership instead");
    this.name = "CannotModifyOwnerError";
  }
}

export interface OrgMember {
  userId: string;
  name: string;
  email: string;
  role: OrgMemberRole;
}

export interface OrgRepo {
  id: string;
  name: string;
  description: string | null;
  endpointCount: number;
}

export interface OrgDetail {
  id: string;
  name: string;
  description: string | null;
  ownerId: string;
  createdAt: Date;
  updatedAt: Date;
  myRole: OrgMemberRole | null;
  members: OrgMember[];
  repos: OrgRepo[];
}

/** 组织详情（org + 成员 + 仓库 + 我的角色）。无权限抛 ForbiddenError；不存在返回 null。 */
export async function getOrgDetail(
  id: string,
  userId: string,
): Promise<OrgDetail | null> {
  await assertOrgRole(userId, id, "org_member");
  const db = getDB();
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  if (!org) return null;

  const [memberRows, repoRows, myRole] = await Promise.all([
    db
      .select({
        userId: organizationMembers.userId,
        name: users.name,
        email: users.email,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.orgId, id))
      .orderBy(organizationMembers.role, users.name),
    db
      .select({
        id: repositories.id,
        name: repositories.name,
        description: repositories.description,
        endpointCount: sql<number>`${count(endpoints.id)}::int`,
      })
      .from(repositories)
      .leftJoin(endpoints, eq(endpoints.repoId, repositories.id))
      .where(eq(repositories.orgId, id))
      .groupBy(repositories.id)
      .orderBy(repositories.name),
    getUserOrgRole(userId, id),
  ]);

  return {
    ...org,
    myRole,
    members: memberRows.map((m) => ({ ...m, role: m.role as OrgMemberRole })),
    repos: repoRows.map((r) => ({ ...r, endpointCount: Number(r.endpointCount ?? 0) })),
  };
}

export type OrgLoadResult =
  | { status: "ok"; org: OrgDetail }
  | { status: "forbidden"; org: null }
  | { status: "not-found"; org: null };

/** 页面侧：区分 无权限 / 不存在 / 正常，避免冒泡成 500。 */
export async function loadOrgForPage(
  id: string,
  userId: string,
): Promise<OrgLoadResult> {
  try {
    const org = await getOrgDetail(id, userId);
    return org ? { status: "ok", org } : { status: "not-found", org: null };
  } catch (err) {
    if (err instanceof ForbiddenError) return { status: "forbidden", org: null };
    throw err;
  }
}

/** 邀请成员（按邮箱找到已有用户并加入）。仅 org_admin+。 */
export async function inviteOrgMember(
  orgId: string,
  actorId: string,
  input: { email: string; role: "org_admin" | "org_member" },
) {
  await assertOrgRole(actorId, orgId, "org_admin");
  const db = getDB();
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.email, input.email.trim().toLowerCase()))
    .limit(1);
  if (!user) throw new UserNotFoundError();
  const [existing] = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.orgId, orgId),
        eq(organizationMembers.userId, user.id),
      ),
    )
    .limit(1);
  if (existing) throw new AlreadyMemberError();
  await db.insert(organizationMembers).values({
    orgId,
    userId: user.id,
    role: input.role,
  });
  return { userId: user.id, name: user.name, email: user.email, role: input.role };
}

/** 变更成员角色。仅 org_admin+；owner 只能通过转移所有权变更。 */
export async function updateOrgMemberRole(
  orgId: string,
  actorId: string,
  targetUserId: string,
  role: OrgMemberRole,
) {
  await assertOrgRole(actorId, orgId, "org_admin");
  const db = getDB();
  const [member] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.orgId, orgId),
        eq(organizationMembers.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!member) throw new MemberNotFoundError();
  if (member.role === "org_owner") throw new CannotModifyOwnerError();
  await db
    .update(organizationMembers)
    .set({ role })
    .where(
      and(
        eq(organizationMembers.orgId, orgId),
        eq(organizationMembers.userId, targetUserId),
      ),
    );
}

/** 移除成员。仅 org_admin+；owner 不能直接移除。 */
export async function removeOrgMember(
  orgId: string,
  actorId: string,
  targetUserId: string,
) {
  await assertOrgRole(actorId, orgId, "org_admin");
  const db = getDB();
  const [member] = await db
    .select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.orgId, orgId),
        eq(organizationMembers.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!member) throw new MemberNotFoundError();
  if (member.role === "org_owner") throw new CannotModifyOwnerError();
  await db
    .delete(organizationMembers)
    .where(
      and(
        eq(organizationMembers.orgId, orgId),
        eq(organizationMembers.userId, targetUserId),
      ),
    );
}

/** 转移所有权：新 owner 升为 org_owner，原 owner 降为 org_admin。仅当前 owner。 */
export async function transferOrgOwnership(
  orgId: string,
  actorId: string,
  targetUserId: string,
) {
  await assertOrgRole(actorId, orgId, "org_owner");
  const db = getDB();
  const [target] = await db
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(
      and(
        eq(organizationMembers.orgId, orgId),
        eq(organizationMembers.userId, targetUserId),
      ),
    )
    .limit(1);
  if (!target) throw new MemberNotFoundError();

  await db.transaction(async (tx) => {
    await tx
      .update(organizations)
      .set({ ownerId: targetUserId, updatedAt: new Date() })
      .where(eq(organizations.id, orgId));
    await tx
      .update(organizationMembers)
      .set({ role: "org_admin" })
      .where(
        and(
          eq(organizationMembers.orgId, orgId),
          eq(organizationMembers.userId, actorId),
        ),
      );
    await tx
      .update(organizationMembers)
      .set({ role: "org_owner" })
      .where(
        and(
          eq(organizationMembers.orgId, orgId),
          eq(organizationMembers.userId, targetUserId),
        ),
      );
  });
}
