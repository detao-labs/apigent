import {
  pgTable,
  text,
  varchar,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { repositories, repoVersions } from "./repo";

// ═══════════════════════════════════════════════════════════════════
// Components — 可复用 OpenAPI 组件（components.*，OpenAPI 3.x 术语）
// ═══════════════════════════════════════════════════════════════════
//
// 与 data_models 同构（versionId + repoId + name + json payload），统一管理
// responses / securitySchemes / parameters / requestBodies / headers / examples。
// kind 标明组件类别；def_type 为展示型类型提示（securityScheme → http/apiKey/oauth2）。
// 对应 docs/modules/openapi-parser.md 的组件提取；后续可扩展更多 kind。
// ═══════════════════════════════════════════════════════════════════

export const components = pgTable(
  "components",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => repoVersions.id),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    /** response | securityScheme | parameter | requestBody | header | example */
    kind: varchar("kind", { length: 30 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    /** securityScheme → http / apiKey / oauth2 / openIdConnect */
    defType: varchar("def_type", { length: 50 }),
    description: text("description"),
    payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("components_version_kind_name_idx").on(
      table.versionId,
      table.kind,
      table.name,
    ),
  ],
);
