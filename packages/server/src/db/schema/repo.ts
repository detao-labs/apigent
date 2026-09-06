import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users, organizations } from "./auth";

// ═══════════════════════════════════════════════════════════════════
// Repositories
// ═══════════════════════════════════════════════════════════════════

export const repositories = pgTable("repositories", {
  id: text("id").primaryKey(),
  orgId: text("org_id")
    .notNull()
    .references(() => organizations.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  capabilityContext: jsonb("capability_context").default({}),
  // "当前版本" 由 versions.is_default 的 head_commit_id 决定，不再单列指针。
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
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    role: varchar("role", { length: 50 }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.repoId] })],
);
