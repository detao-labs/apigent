// ═══════════════════════════════════════════════════════════════════
// Admin Users — 用户列表与详情（只读）
// ═══════════════════════════════════════════════════════════════════
//
// 这是**实例级账号视角**，与 org/repo 成员是两条轴：这里只回答"这台部署上有
// 哪些账号、他们加入了什么"。账号禁用 / 删除（`admin:users:disable` /
// `admin:users:delete`）在 V0 预留未实现（docs/tech-design.md §4.3）。
// ═══════════════════════════════════════════════════════════════════

import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { getDB, organizationMembers, organizations, repositories, users } from "../db";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
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
