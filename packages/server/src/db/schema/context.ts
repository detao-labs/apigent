import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { versionCommits } from "./version";
import { endpoints } from "./endpoint";

// ═══════════════════════════════════════════════════════════════════
// Business Contexts — 能力上下文（Endpoint 级，按 commit 版本）
// ═══════════════════════════════════════════════════════════════════
//
// AI Agent 产出的业务语义：能力名 / 意图 / 约束 / 副作用 / 使用场景。
// 与 endpoint 的技术定义分开存放——它回答的是"这个接口在业务上意味着什么"，
// 属于另一层（见 docs/tech-design.md §2 的能力上下文 / 使用上下文划分）。
//
// 唯一键 (entity_type, entity_id, version_id)；人工编辑后 edited_by_human 置位，
// 自动生成会跳过人工编辑过的行（见 docs/modules/business-context.md）。

export const businessContexts = pgTable(
  "business_contexts",
  {
    id: text("id").primaryKey(),
    entityType: varchar("entity_type", { length: 20 }).notNull().default("endpoint"),
    entityId: text("entity_id").notNull(),
    endpointId: text("endpoint_id").references(() => endpoints.id),
    versionId: text("version_id").references(() => versionCommits.id),
    capabilityName: varchar("capability_name", { length: 255 }),
    intent: text("intent"),
    constraints: jsonb("constraints").default([]),
    sideEffects: jsonb("side_effects").$type<string[]>().default([]),
    usageScenarios: jsonb("usage_scenarios").default([]),
    confidence: doublePrecision("confidence"),
    needsReview: boolean("needs_review").default(false),
    editedByHuman: boolean("edited_by_human").default(false),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    sourceContextId: text("source_context_id"),
    fingerprint: varchar("fingerprint", { length: 64 }),
    generatedBy: varchar("generated_by", { length: 100 }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("business_contexts_entity_version_idx").on(
      table.entityType,
      table.entityId,
      table.versionId,
    ),
  ],
);
