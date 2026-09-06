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
import { repositories } from "./repo";
import { versionCommits } from "./version";

// ═══════════════════════════════════════════════════════════════════
// Endpoints — 接口定义（内容块 blob，版本无关）
//
// 版本无关：不挂 version/commit，由 version_entity_links 决定"哪个 commit
// 用了哪个 blob"。未变接口跨 commit 复用同一行（content_hash 去重）。
// ═══════════════════════════════════════════════════════════════════

export const endpoints = pgTable(
  "endpoints",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    /** sha256(规范化 head + sorted responses[].hash)，用于复用/对比 */
    contentHash: text("content_hash").notNull(),
    /** operationId ?? METHOD:PATH，跨 commit 匹配 */
    identityKey: text("identity_key").notNull(),
    operationId: varchar("operation_id", { length: 255 }),
    method: varchar("method", { length: 10 }).notNull(),
    path: varchar("path", { length: 500 }).notNull(),
    summary: text("summary"),
    description: text("description"),
    requestContentType: varchar("request_content_type", { length: 100 }),
    requestSchema: jsonb("request_schema"),
    parameters: jsonb("parameters").default([]),
    deprecated: boolean("deprecated").default(false),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    security: jsonb("security").$type<Record<string, string[]>[]>().notNull().default([]),
    /** [{ hash, status_code, content_type }] 廉价索引，不加载完整 schema */
    responsesMeta: jsonb("responses_meta")
      .$type<Array<{ hash: string; statusCode: string; contentType: string | null }>>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("endpoints_repo_content_hash_idx").on(table.repoId, table.contentHash)],
);

// ═══════════════════════════════════════════════════════════════════
// Endpoint Responses — OpenAPI paths.{path}.{method}.responses.{status}
//
// A single endpoint can have many responses; a response with multiple media
// types yields one row per media type. 挂在 endpoint blob 上（不改版本），
// 便于按 status_code / content_type 检索。
// ═══════════════════════════════════════════════════════════════════

export const endpointResponses = pgTable(
  "endpoint_responses",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => endpoints.id, { onDelete: "cascade" }),
    /** sha256(规范化 response)，廉价对比用 */
    respHash: text("resp_hash").notNull(),
    statusCode: varchar("status_code", { length: 3 }).notNull(),
    description: text("description"),
    headers: jsonb("headers").default([]),
    contentType: varchar("content_type", { length: 100 }),
    schema: jsonb("schema"),
    isError: boolean("is_error").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("endpoint_responses_endpoint_status_content_type_idx").on(
      table.endpointId,
      table.statusCode,
      table.contentType,
    ),
  ],
);

// ═══════════════════════════════════════════════════════════════════
// Data Models — OpenAPI components/schemas（内容块 blob，版本无关）
// ═══════════════════════════════════════════════════════════════════

export const dataModels = pgTable(
  "data_models",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    contentHash: text("content_hash").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    schemaType: varchar("schema_type", { length: 50 }),
    schemaRaw: jsonb("schema_raw").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("data_models_repo_content_hash_idx").on(table.repoId, table.contentHash)],
);

// ═══════════════════════════════════════════════════════════════════
// Business Contexts — Endpoint 级 AI Agent 产出（按 commit 版本）
// ═══════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════
// Endpoint Relationships — 接口间依赖/关联（按 commit 版本）
// ═══════════════════════════════════════════════════════════════════

export const endpointRelationships = pgTable(
  "endpoint_relationships",
  {
    id: text("id").primaryKey(),
    sourceEndpointId: text("source_endpoint_id")
      .notNull()
      .references(() => endpoints.id),
    targetEndpointId: text("target_endpoint_id")
      .notNull()
      .references(() => endpoints.id),
    relationType: varchar("relation_type", { length: 50 }).notNull(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    versionId: text("version_id")
      .notNull()
      .references(() => versionCommits.id),
  },
  (table) => [
    uniqueIndex("endpoint_relations_unique_idx").on(
      table.sourceEndpointId,
      table.targetEndpointId,
      table.relationType,
    ),
  ],
);
