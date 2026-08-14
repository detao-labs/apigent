import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════════════════════════
// Users
// ═══════════════════════════════════════════════════════════════════

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    avatarUrl: text("avatar_url"),
    ssoProviders: jsonb("sso_providers").$type<string[]>().default([]),
    isPlatformAdmin: boolean("is_platform_admin").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

// ═══════════════════════════════════════════════════════════════════
// Organizations
// ═══════════════════════════════════════════════════════════════════

export const organizations = pgTable(
  "organizations",
  {
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
  },
);

// ═══════════════════════════════════════════════════════════════════
// Organization Members
// ═══════════════════════════════════════════════════════════════════

export const organizationMembers = pgTable(
  "organization_members",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    role: varchar("role", { length: 50 }).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.orgId] })],
);
