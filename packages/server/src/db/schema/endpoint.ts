import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  doublePrecision,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { repositories, repoVersions, modules } from "./repo";

// ═══════════════════════════════════════════════════════════════════
// Endpoints — OpenAPI paths.{path}.{method}
// ═══════════════════════════════════════════════════════════════════

export const endpoints = pgTable(
  "endpoints",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => repoVersions.id),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    /** OpenAPI operationId — 跨版本身份标识 */
    operationId: varchar("operation_id", { length: 255 }),
    method: varchar("method", { length: 10 }).notNull(),
    path: varchar("path", { length: 500 }).notNull(),
    summary: text("summary"),
    description: text("description"),
    /** Media type of the request body, e.g. "application/json" / "multipart/form-data" */
    requestContentType: varchar("request_content_type", { length: 100 }),
    requestSchema: jsonb("request_schema"),
    parameters: jsonb("parameters").default([]),
    deprecated: boolean("deprecated").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("endpoints_version_method_path_idx").on(table.versionId, table.method, table.path),
  ],
);

// ═══════════════════════════════════════════════════════════════════
// Endpoint ↔ Module (M:N — OpenAPI operation.tags)
// ═══════════════════════════════════════════════════════════════════

export const endpointModules = pgTable(
  "endpoint_modules",
  {
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => endpoints.id),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id),
  },
  (table) => [primaryKey({ columns: [table.endpointId, table.moduleId] })],
);

// ═══════════════════════════════════════════════════════════════════
// Endpoint Responses — OpenAPI paths.{path}.{method}.responses.{status}
//
// A single endpoint can have many responses (200/400/401/409/500...).
// A response with multiple media types yields one row per media type.
// Modeled as a separate table so AI agents and tooling can annotate/manage
// each status code independently instead of rewriting one big jsonb blob.
// ═══════════════════════════════════════════════════════════════════

export const endpointResponses = pgTable(
  "endpoint_responses",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => endpoints.id, { onDelete: "cascade" }),
    statusCode: varchar("status_code", { length: 3 }).notNull(),
    description: text("description"),
    headers: jsonb("headers").default([]),
    /** Media type, e.g. "application/json" (NULL when the status has no content) */
    contentType: varchar("content_type", { length: 100 }),
    /** SchemaRef ({ schema, ref, unresolved }) for this media type */
    schema: jsonb("schema"),
    /** Denormalized from statusCode for cheap filtering of error responses */
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
// Data Models — OpenAPI components/schemas
// ═══════════════════════════════════════════════════════════════════

export const dataModels = pgTable(
  "data_models",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => repoVersions.id),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    name: varchar("name", { length: 255 }).notNull(),
    schemaType: varchar("schema_type", { length: 50 }),
    schemaRaw: jsonb("schema_raw").notNull(),
    description: text("description"),
    isModified: boolean("is_modified").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("data_models_version_name_idx").on(table.versionId, table.name)],
);

// ═══════════════════════════════════════════════════════════════════
// Business Contexts — Endpoint 级 AI Agent 产出
// ═══════════════════════════════════════════════════════════════════

export const businessContexts = pgTable(
  "business_contexts",
  {
    id: text("id").primaryKey(),
    endpointId: text("endpoint_id")
      .notNull()
      .references(() => endpoints.id),
    versionId: text("version_id")
      .notNull()
      .references(() => repoVersions.id),
    capabilityName: varchar("capability_name", { length: 255 }),
    intent: text("intent"),
    constraints: jsonb("constraints").default([]),
    sideEffects: jsonb("side_effects").$type<string[]>().default([]),
    usageScenarios: jsonb("usage_scenarios").default([]),
    /** 自动推断置信度 0-1；人工编辑后置 1 */
    confidence: doublePrecision("confidence"),
    /** confidence < minConfidence 时 true */
    needsReview: boolean("needs_review").default(false),
    /** 人工编辑标记 */
    editedByHuman: boolean("edited_by_human").default(false),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /** 版本复用时指向上一版 context 行（快照溯源） */
    sourceContextId: text("source_context_id"),
    /** 生成时接口的技术指纹（SHA-256），用于复用比对 */
    fingerprint: varchar("fingerprint", { length: 64 }),
    generatedBy: varchar("generated_by", { length: 100 }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("business_contexts_endpoint_version_idx").on(table.endpointId, table.versionId),
  ],
);

// ═══════════════════════════════════════════════════════════════════
// Endpoint Relationships — 接口间依赖/关联
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
      .references(() => repoVersions.id),
  },
  (table) => [
    uniqueIndex("endpoint_relations_unique_idx").on(
      table.sourceEndpointId,
      table.targetEndpointId,
      table.relationType,
    ),
  ],
);
