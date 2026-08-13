import {
  pgTable,
  text,
  varchar,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

// ═══════════════════════════════════════════════════════════════════
// Notifications — 通用站内消息通知
// ═══════════════════════════════════════════════════════════════════
//
// 通用能力：任何模块（导入 / 业务上下文 / 密钥 / MCP / 系统）都能写通知。
// category（业务分类）+ priority（优先级）+ type（事件类型）支撑前端
// 分组、排序与过滤；title 用 i18n key + 参数，不存渲染后文案。
// 完整设计见 docs/modules/async-queue.md §4。
// ═══════════════════════════════════════════════════════════════════

export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** 业务分类：import / context / key / mcp / system */
    category: varchar("category", { length: 30 }).notNull(),
    /** 事件类型（机器可读）：import.succeeded、context.ready… */
    type: varchar("type", { length: 100 }).notNull(),
    /** 优先级：high / medium / low */
    priority: varchar("priority", { length: 10 }).notNull().default("medium"),
    /** i18n key，如 notifications.import.succeeded */
    titleKey: varchar("title_key", { length: 200 }).notNull(),
    /** i18n 插值参数 */
    titleParams: jsonb("title_params").$type<Record<string, unknown>>().notNull().default({}),
    /** 跳转与上下文：{ href, repoId, versionId, taskId } */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** 扩展元数据：orgId、sourceTaskId 等 */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // 未读角标
    index("notifications_user_read_idx").on(table.userId, table.readAt),
    // 分组列表
    index("notifications_user_category_idx").on(
      table.userId,
      table.category,
      table.createdAt.desc(),
    ),
  ],
);
