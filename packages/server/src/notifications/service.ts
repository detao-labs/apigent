// ═══════════════════════════════════════════════════════════════════
// Notification Service — 通用站内消息通知
// ═══════════════════════════════════════════════════════════════════
//
// 任何模块都能写通知（导入 / 业务上下文 / 密钥 / MCP / 系统）：
//   category（业务分类）+ priority（优先级）+ type（事件类型）
//   支撑前端分组、排序与过滤；title 用 i18n key + 参数。
// 完整设计见 docs/modules/async-queue.md §4。
// ═══════════════════════════════════════════════════════════════════

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { generateId } from "../id";
import { getDB, notifications } from "../db";
import { logError } from "../logger";

export type NotificationCategory = "import" | "context" | "key" | "mcp" | "system";
export type NotificationPriority = "high" | "medium" | "low";

export interface NotificationInput {
  userId: string;
  category: NotificationCategory;
  type: string;
  priority?: NotificationPriority;
  titleKey: string;
  titleParams?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  expiresAt?: Date;
}

export interface NotificationSummary {
  id: string;
  category: NotificationCategory;
  type: string;
  priority: NotificationPriority;
  titleKey: string;
  titleParams: Record<string, unknown>;
  payload: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
}

export async function createNotification(input: NotificationInput): Promise<string> {
  const id = generateId("notification");
  await getDB().insert(notifications).values({
    id,
    userId: input.userId,
    category: input.category,
    type: input.type,
    priority: input.priority ?? "medium",
    titleKey: input.titleKey,
    titleParams: input.titleParams ?? {},
    payload: input.payload ?? {},
    metadata: input.metadata ?? {},
    expiresAt: input.expiresAt ?? null,
  });
  return id;
}

export interface ListNotificationsOptions {
  category?: NotificationCategory;
  unreadOnly?: boolean;
  limit?: number;
}

/** 列表：按创建时间倒序（最新在前）。 */
export async function listNotifications(
  userId: string,
  options: ListNotificationsOptions = {},
): Promise<NotificationSummary[]> {
  const { category, unreadOnly, limit = 50 } = options;
  const conditions = [
    eq(notifications.userId, userId),
    ...(category ? [eq(notifications.category, category)] : []),
    ...(unreadOnly ? [isNull(notifications.readAt)] : []),
  ];

  const rows = await getDB()
    .select({
      id: notifications.id,
      category: notifications.category,
      type: notifications.type,
      priority: notifications.priority,
      titleKey: notifications.titleKey,
      titleParams: notifications.titleParams,
      payload: notifications.payload,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    category: row.category as NotificationCategory,
    priority: row.priority as NotificationPriority,
  }));
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const [row] = await getDB()
    .select({ value: sql<number>`count(*)` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return Number(row?.value ?? 0);
}

/** 标记单条已读；仅限本人通知，返回是否命中。 */
export async function markNotificationRead(
  notificationId: string,
  userId: string,
): Promise<boolean> {
  const result = await getDB()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/** 全部已读，返回受影响条数。 */
export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await getDB()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return result.rowCount ?? 0;
}

/** 通知发送失败不应影响主流程，调用方可用它兜底。 */
export async function notifySafely(input: NotificationInput): Promise<void> {
  try {
    await createNotification(input);
  } catch (err) {
    logError("notification.create_failed", err, { userId: input.userId, type: input.type });
  }
}
