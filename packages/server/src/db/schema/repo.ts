import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users, organizations } from "./auth";

// ═══════════════════════════════════════════════════════════════════
// Repositories
// ═══════════════════════════════════════════════════════════════════

export const repositories = pgTable("repositories", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  capabilityContext: jsonb("capability_context").default({}),
  /** Points to the active version. Soft reference — FK added in migration. */
  currentVersionId: uuid("current_version_id"),
  mcpEnabled: boolean("mcp_enabled").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ═══════════════════════════════════════════════════════════════════
// Repo Permissions — 仓库级权限覆盖
// ═══════════════════════════════════════════════════════════════════

export const repoPermissions = pgTable(
  "repo_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repositories.id),
    role: varchar("role", { length: 50 }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repoId] })],
);

// ═══════════════════════════════════════════════════════════════════
// Repo Versions — OpenAPI 版本快照
// ═══════════════════════════════════════════════════════════════════

export const repoVersions = pgTable(
  "repo_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repositories.id),
    version: varchar("version", { length: 50 }).notNull(),
    specStoragePath: varchar("spec_storage_path", { length: 500 }).notNull(),
    source: varchar("source", { length: 20 }).default("import"),
    importedAt: timestamp("imported_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("repo_versions_repo_version_idx").on(table.repoId, table.version)],
);

// ═══════════════════════════════════════════════════════════════════
// Modules — OpenAPI tags → 模块
// ═══════════════════════════════════════════════════════════════════

export const modules = pgTable(
  "modules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    repoId: uuid("repo_id")
      .notNull()
      .references(() => repositories.id),
    versionId: uuid("version_id")
      .notNull()
      .references(() => repoVersions.id),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").default(0),
  },
  (table) => [uniqueIndex("modules_version_name_idx").on(table.versionId, table.name)],
);
