import { pgTable, varchar, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { users } from "./auth";

// ═══════════════════════════════════════════════════════════════════
// Organizations — 租户（顶层容器）
// ═══════════════════════════════════════════════════════════════════

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  /** 组织描述——未来 RAG 检索的语料（L0 project / org 级 chunk） */
  description: text("description"),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
});

// ═══════════════════════════════════════════════════════════════════
// Organization Members — 组织成员（org_owner / org_admin / org_member）
// ═══════════════════════════════════════════════════════════════════
//
// org_owner 同时由 organizations.owner_id 冗余表达：本表是判定时的首选来源，
// 缺行时回退到 owner_id（见 packages/server/src/authz）。

export const organizationMembers = pgTable(
  "organization_members",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    role: varchar("role", { length: 50 }).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.organizationId] })],
);
