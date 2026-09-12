import { pgTable, varchar, text, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

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
    /** 非空 = 账号被平台管理员禁用；登录与已有会话都会在下一个请求失效 */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("users_email_idx").on(table.email)],
);

// ═══════════════════════════════════════════════════════════════════
// Secret Keys — MCP / REST API 认证
// ═══════════════════════════════════════════════════════════════════
//
// 用户级 API Key：外部 Agent（Cursor / CLI）没有浏览器 Session，
// 用 Bearer key 走独立的认证平面，scopes 限定 api:* / mcp:*。
// 签发 / 校验链路尚未实现（见 docs/tech-design.md §5.4.8）。

export const secretKeys = pgTable("secret_keys", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  keyHash: varchar("key_hash", { length: 255 }).notNull(),
  keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
  scopes: jsonb("scopes").$type<string[]>().default([]),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
