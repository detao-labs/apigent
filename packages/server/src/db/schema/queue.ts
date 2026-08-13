import {
  pgTable,
  text,
  varchar,
  jsonb,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════════════════════════
// Impl Queue Jobs — 通用调度队列（PgQueueProvider）
//
// 命名约定：impl_ 前缀标记"某个具体实现方案（Implementation）专属的表"。
// queue_jobs 是 Postgres 作为队列的临时方案表——将来切换到 BullMQ/Redis
// 后本表可整体废弃；业务任务表（import_tasks / notifications）不加此前缀。
// ═══════════════════════════════════════════════════════════════════
//
// 只负责调度与投递：任务业务状态（进度、结果、错误）由业务任务表
// （如 import_tasks）持久化，本表不承载业务字段。
// 消费语义：Worker 事务内 FOR UPDATE SKIP LOCKED 抢占 queued 行，
// 多实例不会重复消费；进程重启后遗留 running 由 recoverStale() 标记为
// failed(interrupted)。
// 完整设计见 docs/modules/async-queue.md。
// ═══════════════════════════════════════════════════════════════════

export const implQueueJobs = pgTable(
  "impl_queue_jobs",
  {
    id: text("id").primaryKey(),
    /** 队列名，如 openapi.import / business.context */
    queueName: varchar("queue_name", { length: 100 }).notNull(),
    /** 任务名 */
    name: varchar("name", { length: 255 }).notNull(),
    /** 任务 payload（业务数据先落库/落盘，这里只存引用与轻量参数） */
    data: jsonb("data").$type<unknown>().notNull(),
    /** queued | running | completed | failed */
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    /** 执行次数（含本次） */
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** 最早可执行时间（预留延迟投递） */
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // 消费扫描：按状态 + 可用时间取队首
    index("queue_jobs_status_available_idx").on(table.status, table.availableAt),
    // 按队列名过滤（同一队列多消费者场景）
    index("queue_jobs_queue_status_idx").on(table.queueName, table.status),
  ],
);
