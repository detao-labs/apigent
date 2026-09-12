import { sql } from "drizzle-orm";
import { pgTable, varchar, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { organizations } from "./organization";
import { repositories } from "./repository";
import { endpoints } from "./endpoint";

// ═══════════════════════════════════════════════════════════════════
// Operation Logs — 系统操作日志
// ═══════════════════════════════════════════════════════════════════

export const operationLogs = pgTable(
  "operation_logs",
  {
    id: text("id").primaryKey(),
    /** NULL = 平台级操作（Admin Webapp） */
    organizationId: text("organization_id").references(() => organizations.id),
    repositoryId: text("repository_id").references(() => repositories.id),
    /** NULL = 系统自动操作 */
    actorId: text("actor_id").references(() => users.id),
    operationType: varchar("operation_type", { length: 50 }).notNull(),
    resourceType: varchar("resource_type", { length: 50 }).notNull(),
    resourceId: text("resource_id"),
    summary: jsonb("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("operation_logs_organization_type_time_idx").on(
      table.organizationId,
      table.operationType,
      table.createdAt.desc(),
    ),
    // 仓库审计页：WHERE repository_id = ? ORDER BY created_at DESC
    index("operation_logs_repository_time_idx").on(table.repositoryId, table.createdAt.desc()),
    // 平台级事件（organization_id IS NULL）不参与上面的复合索引，单独建部分索引，
    // 否则 Admin 审计页的查询会退化成全表扫描。
    index("operation_logs_platform_time_idx")
      .on(table.createdAt.desc())
      .where(sql`${table.organizationId} is null`),
  ],
);

// ═══════════════════════════════════════════════════════════════════
// Operation Log Details — 导入变更明细
// ═══════════════════════════════════════════════════════════════════

export const operationLogDetails = pgTable(
  "operation_log_details",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => operationLogs.id),
    changeType: varchar("change_type", { length: 20 }).notNull(),
    /** Endpoint 的 operationId（跨版本锚点） */
    operationIdRef: varchar("operation_id_ref", { length: 255 }),
    method: varchar("method", { length: 10 }).notNull(),
    path: varchar("path", { length: 500 }).notNull(),
    fromEndpointId: text("from_endpoint_id").references(() => endpoints.id),
    toEndpointId: text("to_endpoint_id").references(() => endpoints.id),
    fieldsChanged: jsonb("fields_changed").$type<string[]>(),
  },
  (table) => [
    uniqueIndex("operation_log_details_unique_idx").on(table.operationId, table.method, table.path),
  ],
);
