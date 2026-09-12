// ═══════════════════════════════════════════════════════════════════
// Admin Users — 用户列表 / 详情 / 账号生命周期
// ═══════════════════════════════════════════════════════════════════
//
// 这是**实例级账号视角**，与 org/repo 成员是两条轴：这里回答"这台部署上有哪
// 些账号、他们加入了什么"，以及禁用 / 启用 / 删除账号（`admin:users:disable`
// / `admin:users:delete`，见 docs/tech-design.md §4.3）。
//
// 禁用是"软"的：只写 `users.disabled_at`。因为会话是无状态 JWT，没有 session
// 表可清理，所以**每个请求都会现查 users**（两个 app 的 getSessionUser /
// getAdminIdentity 都这么做）——禁用后下一个请求即失效，不必等 token 过期。
//
// 删除是硬的，但拒绝删除"仍然拥有组织"的账号：`organizations.owner_id` 是
// NO ACTION 外键，硬删会留下无主组织。其余引用按 FK 图清理（见下方注释）。
// ═══════════════════════════════════════════════════════════════════

import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import {
  adminMembers,
  getDB,
  notificationPreferences,
  notifications,
  operationLogs,
  organizationMembers,
  organizations,
  repositoryMembers,
  repositoryTasks,
  repositories,
  secretKeys,
  users,
} from "../db";
import { recordOperation, withAuditTransaction } from "../audit";
import { isAdminRole } from "../authz/admin-capabilities";
import { AdminMemberError, canRevokeAdmin, countAdmins } from "./service";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  /** 非空 = 账号已被禁用 */
  disabledAt: Date | null;
  organizationCount: number;
  repositoryCount: number;
}

export interface ListUsersOptions {
  /** 按邮箱 / 姓名模糊搜索（大小写不敏感） */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface AdminUserPage {
  items: AdminUserRow[];
  total: number;
  limit: number;
  offset: number;
}

export async function listUsers(options: ListUsersOptions = {}): Promise<AdminUserPage> {
  const db = getDB();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const search = options.search?.trim();
  const where = search
    ? or(ilike(users.email, `%${search}%`), ilike(users.name, `%${search}%`))
    : undefined;

  const orgCount = sql<number>`(select count(*) from ${organizationMembers} where ${organizationMembers.userId} = ${users.id})`;
  const repoCount = sql<number>`(
    select count(*) from ${repositories}
    where ${repositories.organizationId} in (
      select ${organizationMembers.organizationId} from ${organizationMembers}
      where ${organizationMembers.userId} = ${users.id}
    )
  )`;

  const [rows, [totalRow]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
        disabledAt: users.disabledAt,
        organizationCount: orgCount,
        repositoryCount: repoCount,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ value: count() }).from(users).where(where),
  ]);

  return {
    items: rows.map((row) => ({
      ...row,
      organizationCount: Number(row.organizationCount),
      repositoryCount: Number(row.repositoryCount),
    })),
    total: Number(totalRow?.value ?? 0),
    limit,
    offset,
  };
}

export interface AdminUserDetail {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  disabledAt: Date | null;
  organizations: { id: string; name: string; role: string }[];
  ownedOrganizations: { id: string; name: string }[];
}

/** 用户详情；不存在返回 null。 */
export async function getUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const db = getDB();
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      createdAt: users.createdAt,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const [memberships, owned] = await Promise.all([
    db
      .select({
        id: organizations.id,
        name: organizations.name,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(organizationMembers.userId, userId)),
    db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(and(eq(organizations.ownerId, userId))),
  ]);

  return { ...user, organizations: memberships, ownedOrganizations: owned };
}

// ═══════════════════════════════════════════════════════════════════
// 账号生命周期
// ═══════════════════════════════════════════════════════════════════

async function loadTarget(userId: string) {
  const [user] = await getDB()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new AdminMemberError("user-not-found");
  return user;
}

/**
 * 禁用 / 启用账号。
 *
 * 禁用管理员时套用与撤销相同的保护：不能把最后一个管理员关掉，否则没人能再
 * 打开任何东西（与 `canRevokeAdmin` 同一条死锁防线）。
 */
export async function setUserDisabled(input: {
  userId: string;
  disabled: boolean;
  actorId: string;
}): Promise<{ email: string; disabled: boolean }> {
  const target = await loadTarget(input.userId);

  const [adminRow] = await getDB()
    .select({ role: adminMembers.role })
    .from(adminMembers)
    .where(eq(adminMembers.userId, input.userId))
    .limit(1);
  const isAdmin = isAdminRole(adminRow?.role);
  if (input.disabled && isAdmin && !canRevokeAdmin(await countAdmins())) {
    throw new AdminMemberError("last-admin");
  }

  await withAuditTransaction(async (tx) => {
    await tx
      .update(users)
      .set({ disabledAt: input.disabled ? new Date() : null })
      .where(eq(users.id, input.userId));
    await recordOperation(tx, {
      actorId: input.actorId,
      operationType: input.disabled ? "admin.user_disable" : "admin.user_enable",
      resourceType: "user",
      resourceId: input.userId,
      summary: {
        targetUserId: input.userId,
        targetEmail: target.email,
        targetName: target.name,
        isAdmin,
      },
    });
  });

  return { email: target.email, disabled: input.disabled };
}

/**
 * 永久删除账号。
 *
 * 按 `users` 的外键图清理（全部 NO ACTION，除了 admin_members 是 CASCADE）：
 *   - 拒绝：仍拥有任何组织（`organizations.owner_id`）；或删除会带走最后一个管理员
 *   - 删除：通知、通知偏好、密钥、组织成员、仓库成员、admin_members
 *   - 置空：admin_members.granted_by、repository_members.granted_by、operation_logs.actor_id
 *   - 删除：repository_tasks（user_id 为 NOT NULL，无法置空）
 *
 * 审计行**保留**（actor 置空），删掉它等于抹掉"这个人做过什么"的证据。
 */
export async function deleteUser(input: {
  userId: string;
  actorId: string;
}): Promise<{ email: string }> {
  if (input.userId === input.actorId) {
    throw new AdminMemberError("cannot-delete-self");
  }

  const target = await loadTarget(input.userId);

  const [ownedOrg] = await getDB()
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.ownerId, input.userId))
    .limit(1);
  if (ownedOrg) throw new AdminMemberError("owns-organizations");

  const [adminRow] = await getDB()
    .select({ role: adminMembers.role })
    .from(adminMembers)
    .where(eq(adminMembers.userId, input.userId))
    .limit(1);
  if (isAdminRole(adminRow?.role) && !canRevokeAdmin(await countAdmins())) {
    throw new AdminMemberError("last-admin");
  }

  await withAuditTransaction(async (tx) => {
    await recordOperation(tx, {
      actorId: input.actorId,
      operationType: "admin.user_delete",
      resourceType: "user",
      resourceId: input.userId,
      summary: {
        targetUserId: input.userId,
        targetEmail: target.email,
        targetName: target.name,
        wasDisabled: target.disabledAt !== null,
      },
    });

    await tx.delete(notifications).where(eq(notifications.userId, input.userId));
    await tx
      .delete(notificationPreferences)
      .where(eq(notificationPreferences.userId, input.userId));
    await tx.delete(secretKeys).where(eq(secretKeys.userId, input.userId));
    await tx.delete(organizationMembers).where(eq(organizationMembers.userId, input.userId));
    await tx.delete(repositoryMembers).where(eq(repositoryMembers.userId, input.userId));

    // 解除"由他授予/触发"的引用，而不是把这些行一起删掉
    await tx
      .update(repositoryMembers)
      .set({ grantedBy: null })
      .where(eq(repositoryMembers.grantedBy, input.userId));
    // repository_tasks.user_id 是 NOT NULL（"谁触发了这次任务"），无法置空，
    // 随账号一起删除；任务的业务痕迹仍在它产生的版本与审计里。
    await tx.delete(repositoryTasks).where(eq(repositoryTasks.userId, input.userId));
    await tx
      .update(operationLogs)
      .set({ actorId: null })
      .where(eq(operationLogs.actorId, input.userId));
    await tx
      .update(adminMembers)
      .set({ grantedBy: null })
      .where(eq(adminMembers.grantedBy, input.userId));

    await tx.delete(adminMembers).where(eq(adminMembers.userId, input.userId));
    await tx.delete(users).where(eq(users.id, input.userId));
  });

  return { email: target.email };
}
