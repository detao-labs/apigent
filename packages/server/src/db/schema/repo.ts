import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";
import { users, organizations } from "./auth";

// ═══════════════════════════════════════════════════════════════════
// Repositories
// ═══════════════════════════════════════════════════════════════════

export const repositories = pgTable("repositories", {
  id: text("id").primaryKey(),
  orgId: text("organization_id")
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
// Repo Members — 仓库成员（仓库有自己的成员与角色）
// ═══════════════════════════════════════════════════════════════════
//
// 平台内所有仓库的**目录**对所有登录用户可见，但**内容**由这张表决定：
// 没有行、也不是组织管理员/拥有者，访问仓库内容一律 403。
//
// 组织角色只提供隐式成员：org_owner → repo_owner、org_admin → repo_admin。
// org_member 不隐含任何仓库角色——要访问仓库内容必须显式加进来。

export const repositoryMembers = pgTable(
  "repository_members",
  {
    repoId: text("repository_id")
      .notNull()
      .references(() => repositories.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: varchar("role", { length: 50 }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    /** 授予人（审计）；系统/迁移写入时为 NULL */
    grantedBy: text("granted_by").references(() => users.id),
  },
  (table) => [
    primaryKey({ columns: [table.repoId, table.userId] }),
    index("repository_members_user_idx").on(table.userId),
  ],
);
