import { pgTable, varchar, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./auth";

// ═══════════════════════════════════════════════════════════════════
// Secret Keys — MCP / REST API 认证
// ═══════════════════════════════════════════════════════════════════

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
