import { pgTable, uuid, varchar, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users, organizations } from "./auth";
import { repositories } from "./repo";
import { endpoints } from "./endpoint";

// ═══════════════════════════════════════════════════════════════════
// Operation Logs — 系统操作日志
// ═══════════════════════════════════════════════════════════════════

export const operationLogs = pgTable(
  "operation_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** NULL = 平台级操作（Admin Webapp） */
    orgId: uuid("org_id").references(() => organizations.id),
    repoId: uuid("repo_id").references(() => repositories.id),
    /** NULL = 系统自动操作 */
    actorId: uuid("actor_id").references(() => users.id),
    operationType: varchar("operation_type", { length: 50 }).notNull(),
    resourceType: varchar("resource_type", { length: 50 }).notNull(),
    resourceId: uuid("resource_id"),
    summary: jsonb("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("op_logs_org_type_time_idx").on(table.orgId, table.operationType, table.createdAt.desc()),
  ],
);

// ═══════════════════════════════════════════════════════════════════
// Operation Log Details — 导入变更明细
// ═══════════════════════════════════════════════════════════════════

export const operationLogDetails = pgTable(
  "operation_log_details",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => operationLogs.id),
    changeType: varchar("change_type", { length: 20 }).notNull(),
    /** Endpoint 的 operationId（跨版本锚点） */
    operationIdRef: varchar("operation_id_ref", { length: 255 }),
    method: varchar("method", { length: 10 }).notNull(),
    path: varchar("path", { length: 500 }).notNull(),
    fromEndpointId: uuid("from_endpoint_id").references(() => endpoints.id),
    toEndpointId: uuid("to_endpoint_id").references(() => endpoints.id),
    fieldsChanged: jsonb("fields_changed").$type<string[]>(),
  },
  (table) => [
    uniqueIndex("op_log_details_unique_idx").on(table.operationId, table.method, table.path),
  ],
);
