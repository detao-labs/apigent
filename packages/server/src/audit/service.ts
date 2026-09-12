// ═══════════════════════════════════════════════════════════════════
// Audit Service — 操作日志写入与查询
// ═══════════════════════════════════════════════════════════════════
//
// 写入规则（见 docs/tech-design.md §5.4.7）：
//
//   1. 审计行必须与它记录的**业务写在同一个事务里**提交。否则会出现"操作成功、
//      日志缺失"，而这条日志是"平台管理员不能触碰租户数据"这条边界唯一可验证的
//      证据，缺失即等于不可信。因此 recordOperation 只接受事务句柄，不接受普通
//      连接——拿不到 tx 就写不了日志，编译期就会暴露。
//   2. `organizationId` 为 null = 平台级操作，索引单独建（见 schema/audit.ts）。
//   3. `summary` 是结构化 JSONB，前端直接渲染，不做 i18n。
//
// 用法：
//   await withAuditTransaction(async (tx) => {
//     await tx.insert(repositoryMembers).values({ ... });
//     await recordOperation(tx, {
//       actorId,
//       organizationId,
//       repositoryId,
//       operationType: "repo.member_add",
//       resourceType: "repository_member",
//       resourceId: targetUserId,
//       summary: { email, role },
//     });
//   });
// ═══════════════════════════════════════════════════════════════════

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDB, operationLogs, users, type DBClient } from "../db";
import { generateId } from "../id";
import type {
  ListOperationLogsOptions,
  OperationLogEntry,
  OperationLogInput,
  OperationLogPage,
} from "./types";

/** Drizzle 事务句柄类型。 */
export type DBTransaction = Parameters<Parameters<DBClient["transaction"]>[0]>[0];

/**
 * 开启一个"业务写 + 审计写"事务。
 *
 * 所有需要留痕的 mutation 都必须经过它：回调里的写操作一律用 `tx`，审计用
 * `recordOperation(tx, ...)`，两者一起提交或一起回滚。
 */
export function withAuditTransaction<T>(run: (tx: DBTransaction) => Promise<T>): Promise<T> {
  return getDB().transaction(run);
}

/**
 * 在事务内写入一条操作日志，返回日志 id。
 *
 * 只接受事务句柄：调用方必须用 {@link withAuditTransaction} 包裹业务写，
 * 把同一个 `tx` 传进来。
 */
export async function recordOperation(
  tx: DBTransaction,
  input: OperationLogInput,
): Promise<string> {
  const id = generateId("log");
  await tx.insert(operationLogs).values({
    id,
    operationType: input.operationType,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    actorId: input.actorId ?? null,
    organizationId: input.organizationId ?? null,
    repositoryId: input.repositoryId ?? null,
    summary: input.summary ?? {},
  });
  return id;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * 查询操作日志，按时间倒序（最新在前）。
 *
 * 三个过滤维度互斥使用：`platformOnly` 用于 Admin 审计页，`organizationId`
 * 用于组织审计页，`repositoryId` 用于仓库审计页。
 */
export async function listOperationLogs(
  options: ListOperationLogsOptions = {},
): Promise<OperationLogPage> {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(options.offset ?? 0, 0);

  const conditions = [
    ...(options.platformOnly ? [isNull(operationLogs.organizationId)] : []),
    ...(options.organizationId ? [eq(operationLogs.organizationId, options.organizationId)] : []),
    ...(options.repositoryId ? [eq(operationLogs.repositoryId, options.repositoryId)] : []),
  ];
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const db = getDB();
  const [rows, [countRow]] = await Promise.all([
    db
      .select({
        id: operationLogs.id,
        operationType: operationLogs.operationType,
        resourceType: operationLogs.resourceType,
        resourceId: operationLogs.resourceId,
        summary: operationLogs.summary,
        createdAt: operationLogs.createdAt,
        actorId: users.id,
        actorName: users.name,
        actorEmail: users.email,
      })
      .from(operationLogs)
      .leftJoin(users, eq(users.id, operationLogs.actorId))
      .where(where)
      .orderBy(desc(operationLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ value: sql<number>`count(*)` })
      .from(operationLogs)
      .where(where),
  ]);

  const items: OperationLogEntry[] = rows.map((row) => ({
    id: row.id,
    operationType: row.operationType,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    summary: (row.summary ?? {}) as Record<string, unknown>,
    actor:
      row.actorId && row.actorName && row.actorEmail
        ? { id: row.actorId, name: row.actorName, email: row.actorEmail }
        : null,
    createdAt: row.createdAt,
  }));

  return { items, total: Number(countRow?.value ?? 0), limit, offset };
}

/** 某个仓库最近一次操作时间，用于列表页排序/标记（无记录返回 null）。 */
export async function lastOperationAt(repositoryId: string): Promise<Date | null> {
  const [row] = await getDB()
    .select({ createdAt: operationLogs.createdAt })
    .from(operationLogs)
    .where(eq(operationLogs.repositoryId, repositoryId))
    .orderBy(desc(operationLogs.createdAt))
    .limit(1);
  return row?.createdAt ?? null;
}
