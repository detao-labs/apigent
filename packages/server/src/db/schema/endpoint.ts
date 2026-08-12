import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
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
    id: uuid("id").defaultRandom().primaryKey(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => repoVersions.id),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repositories.id),
    /** OpenAPI operationId — 跨版本身份标识 */
    operationId: varchar("operation_id", { length: 255 }),
    method: varchar("method", { length: 10 }).notNull(),
    path: varchar("path", { length: 500 }).notNull(),
    summary: text("summary"),
    description: text("description"),
    requestSchema: jsonb("request_schema"),
    responseSchema: jsonb("response_schema"),
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
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoints.id),
    moduleId: uuid("module_id")
      .notNull()
      .references(() => modules.id),
  },
  (table) => [primaryKey({ columns: [table.endpointId, table.moduleId] })],
);

// ═══════════════════════════════════════════════════════════════════
// Data Models — OpenAPI components/schemas
// ═══════════════════════════════════════════════════════════════════

export const dataModels = pgTable(
  "data_models",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => repoVersions.id),
    repoId: uuid("repo_id")
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
    id: uuid("id").defaultRandom().primaryKey(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => endpoints.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => repoVersions.id),
    capabilityName: varchar("capability_name", { length: 255 }),
    intent: text("intent"),
    constraints: jsonb("constraints").default([]),
    sideEffects: text("side_effects"),
    usageScenarios: jsonb("usage_scenarios").default([]),
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
    id: uuid("id").defaultRandom().primaryKey(),
    sourceEndpointId: uuid("source_endpoint_id")
      .notNull()
      .references(() => endpoints.id),
    targetEndpointId: uuid("target_endpoint_id")
      .notNull()
      .references(() => endpoints.id),
    relationType: varchar("relation_type", { length: 50 }).notNull(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repositories.id),
    versionId: uuid("version_id")
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
