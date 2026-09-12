// ═══════════════════════════════════════════════════════════════════
// Admin Service — 平台管理员的读写
// ═══════════════════════════════════════════════════════════════════
//
// 授予 / 撤销都在**同一事务内**写入 `admin.grant` / `admin.revoke` 审计行
// （organizationId 为 NULL = 平台级操作，见 docs/tech-design.md §5.4.7）。
//
// 一条硬规则：**不能撤销最后一个管理员**。否则会形成"没有人能再授予管理员"
// 的死锁，只能回命令行救场。
//
// 纯角色/能力映射在 ../authz/admin-capabilities.ts；这里只做读写与事务。
// ═══════════════════════════════════════════════════════════════════

import { asc, eq, inArray, sql } from "drizzle-orm";
import { getDB, adminMembers, users } from "../db";
import { recordOperation, withAuditTransaction } from "../audit";
import { isAdminRole, type AdminRole } from "../authz/admin-capabilities";

export type AdminMemberErrorCode =
  | "user-not-found"
  | "already-admin"
  | "not-admin"
  | "last-admin"
  | "owns-organizations"
  /** 不能对自己执行删除 / 禁用 / 撤销管理员——避免自我锁死，交给另一个管理员做 */
  | "self-not-allowed";

export class AdminMemberError extends Error {
  constructor(public readonly code: AdminMemberErrorCode) {
    super(code);
    this.name = "AdminMemberError";
  }
}

export interface AdminMemberRow {
  userId: string;
  email: string;
  name: string;
  role: AdminRole;
  grantedAt: Date;
  /** 授予人；CLI 引导时为 null（系统写入） */
  grantedBy: string | null;
  grantedByName: string | null;
}

/** 全部平台管理员，按授予时间升序（最早授予的在前）。 */
export async function listAdminMembers(): Promise<AdminMemberRow[]> {
  const db = getDB();
  const rows = await db
    .select({
      userId: adminMembers.userId,
      role: adminMembers.role,
      grantedAt: adminMembers.grantedAt,
      grantedBy: adminMembers.grantedBy,
      email: users.email,
      name: users.name,
    })
    .from(adminMembers)
    .innerJoin(users, eq(users.id, adminMembers.userId))
    .orderBy(asc(adminMembers.grantedAt));

  // 授予人姓名单独查一次，避免在 drizzle 里写自连接别名
  const grantorIds = rows.map((r) => r.grantedBy).filter((id): id is string => Boolean(id));
  const grantors =
    grantorIds.length > 0
      ? await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, grantorIds))
      : [];
  const grantorNames = new Map(grantors.map((g) => [g.id, g.name]));

  return rows.flatMap((row) =>
    isAdminRole(row.role)
      ? [
          {
            userId: row.userId,
            email: row.email,
            name: row.name,
            role: row.role,
            grantedAt: row.grantedAt,
            grantedBy: row.grantedBy,
            grantedByName: row.grantedBy ? (grantorNames.get(row.grantedBy) ?? null) : null,
          },
        ]
      : [],
  );
}

/** 当前管理员数量（用于"最后一个管理员"保护）。 */
export async function countAdmins(): Promise<number> {
  const [row] = await getDB()
    .select({ value: sql<number>`count(*)` })
    .from(adminMembers);
  return Number(row?.value ?? 0);
}

/**
 * 是否允许撤销：至少要留一个管理员。
 *
 * 抽成纯函数是为了能直接单测这条规则——在真实库里构造"只剩最后一个管理员"
 * 需要先删掉现有管理员，风险不值得。
 */
export function canRevokeAdmin(adminCount: number): boolean {
  return adminCount > 1;
}

export interface GrantAdminInput {
  email: string;
  role?: AdminRole;
  /** 操作者；CLI 引导传 null（系统） */
  actorId: string | null;
  /** 审计摘要里的来源标记，默认 "webapp" */
  source?: string;
}

export interface GrantAdminResult {
  userId: string;
  email: string;
  role: AdminRole;
  /** false = 本来就是这个角色，未重复写入 */
  granted: boolean;
}

/** 按邮箱授予平台角色（幂等）。 */
export async function grantAdminRole(input: GrantAdminInput): Promise<GrantAdminResult> {
  const email = input.email.trim().toLowerCase();
  const role: AdminRole = input.role ?? "admin_super";

  const [user] = await getDB()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) throw new AdminMemberError("user-not-found");

  const [existing] = await getDB()
    .select({ role: adminMembers.role })
    .from(adminMembers)
    .where(eq(adminMembers.userId, user.id))
    .limit(1);
  if (isAdminRole(existing?.role) && existing.role === role) {
    return { userId: user.id, email: user.email, role, granted: false };
  }

  await withAuditTransaction(async (tx) => {
    await tx
      .insert(adminMembers)
      .values({ userId: user.id, role, grantedBy: input.actorId })
      .onConflictDoUpdate({
        target: adminMembers.userId,
        set: { role, grantedAt: new Date(), grantedBy: input.actorId },
      });
    await recordOperation(tx, {
      actorId: input.actorId,
      operationType: "admin.grant",
      resourceType: "user",
      resourceId: user.id,
      summary: {
        targetUserId: user.id,
        targetEmail: user.email,
        role,
        source: input.source ?? "webapp",
      },
    });
  });

  return { userId: user.id, email: user.email, role, granted: true };
}

/**
 * 撤销平台角色。
 *
 * 拒绝撤销最后一个管理员——否则没人能再授予管理员，只能回命令行救场。
 */
export async function revokeAdminRole(input: {
  userId: string;
  actorId: string;
}): Promise<{ email: string }> {
  // 不能撤销自己的管理员——否则一个手滑就把自己关在门外，正确做法是让另一个
  // 管理员来操作。
  if (input.userId === input.actorId) throw new AdminMemberError("self-not-allowed");

  const [target] = await getDB()
    .select({ userId: adminMembers.userId, role: adminMembers.role, email: users.email })
    .from(adminMembers)
    .innerJoin(users, eq(users.id, adminMembers.userId))
    .where(eq(adminMembers.userId, input.userId))
    .limit(1);
  if (!target || !isAdminRole(target.role)) throw new AdminMemberError("not-admin");
  if (!canRevokeAdmin(await countAdmins())) throw new AdminMemberError("last-admin");

  await withAuditTransaction(async (tx) => {
    await tx.delete(adminMembers).where(eq(adminMembers.userId, input.userId));
    await recordOperation(tx, {
      actorId: input.actorId,
      operationType: "admin.revoke",
      resourceType: "user",
      resourceId: input.userId,
      summary: {
        targetUserId: input.userId,
        targetEmail: target.email,
        role: target.role,
        source: "webapp",
      },
    });
  });

  return { email: target.email };
}
