import { pgTable, text, varchar, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { repositories } from "./repository";

// ═══════════════════════════════════════════════════════════════════
// Reusable Definitions — OpenAPI 可复用定义（版本无关的内容块）
// ═══════════════════════════════════════════════════════════════════
//
// 两个来源，同一层：
//   - data_models ← OpenAPI components/schemas
//   - components  ← OpenAPI components/* 的其余部分
//     （responses / securitySchemes / parameters / requestBodies / headers / examples）
//
// 都是 (repository_id, content_hash) 的版本无关 blob，由 version_entity_links
// 决定"哪个 commit 用了哪一个"。对应 docs/modules/openapi-parser.md 的提取逻辑。
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// data_models — OpenAPI components/schemas
// ───────────────────────────────────────────────────────────────────

export const dataModels = pgTable(
  "data_models",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id),
    contentHash: text("content_hash").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    schemaType: varchar("schema_type", { length: 50 }),
    schemaRaw: jsonb("schema_raw").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("data_models_repository_content_hash_idx").on(
      table.repositoryId,
      table.contentHash,
    ),
  ],
);

// ───────────────────────────────────────────────────────────────────
// components — OpenAPI components/* 的其余部分
// ───────────────────────────────────────────────────────────────────

export const components = pgTable(
  "components",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id),
    /** sha256(规范化定义)，用于复用/对比 */
    contentHash: text("content_hash").notNull(),
    /** response | securityScheme | parameter | requestBody | header | example */
    kind: varchar("kind", { length: 30 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    /** securityScheme → http / apiKey / oauth2 / openIdConnect */
    defType: varchar("def_type", { length: 50 }),
    description: text("description"),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("components_repository_content_hash_idx").on(table.repositoryId, table.contentHash),
  ],
);
