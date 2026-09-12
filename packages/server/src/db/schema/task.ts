import {
  pgTable,
  text,
  varchar,
  jsonb,
  integer,
  timestamp,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { repositories } from "./repository";
import { versionCommits } from "./version";

// ═══════════════════════════════════════════════════════════════════
// Async Tasks — 异步任务（业务状态）与调度投递
// ═══════════════════════════════════════════════════════════════════
//
// 分层：
//   - repository_tasks：业务任务状态（进度 / 结果 / 错误），是事实源
//   - impl_queue_jobs：调度投递实现（PgQueueProvider），换 BullMQ/Redis 后废弃
//
// 一个任务 = 一个 task_type（import / context / vectorize / …）+ 通用状态列
//   - payload：类型专属入参（import→{specPath}；context→{trigger,endpointIds,force}）
//   - result：类型专属统计（import→{stats,issues,nextVersion}；context→{reused/generated/failed,…}）
//   - version_id：import→产出版本；context→目标版本
//   - depends_on：同一 repo 的前置任务 id（顺序依赖；空 = 无依赖）
// 命名约定：impl_ 前缀标记"某个具体实现方案（Implementation）专属的表"。
// 完整设计见 docs/modules/async-queue.md。
// ═══════════════════════════════════════════════════════════════════

export const repositoryTasks = pgTable(
  "repository_tasks",
  {
    id: text("id").primaryKey(),
    /** 关联 impl_queue_jobs（调度投递），入队后回填 */
    jobId: text("job_id").references(() => implQueueJobs.id),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id),
    /** import→产出版本；context→目标版本 */
    versionId: text("version_id").references(() => versionCommits.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** import | context | vectorize | change_analysis | … */
    taskType: varchar("task_type", { length: 30 }).notNull(),
    /** queued | running | succeeded | failed */
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    /** 0-100，前端进度条；类型专属统计放 result */
    progress: integer("progress").notNull().default(0),
    /** 类型专属入参（specPath / trigger / endpointIds / force …） */
    payload: jsonb("payload").notNull(),
    /** 类型专属结果与统计 */
    result: jsonb("result").$type<unknown>(),
    /** 同一 repo 的前置任务 id（顺序依赖） */
    dependsOn: text("depends_on").references((): AnyPgColumn => repositoryTasks.id),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // 重复任务检查：repo 下进行中的任务
    index("repository_tasks_repository_status_idx").on(table.repositoryId, table.status),
    // 用户任务列表
    index("repository_tasks_user_idx").on(table.userId, table.createdAt.desc()),
    // 按类型过滤（任务中心 / 状态徽章）
    index("repository_tasks_type_status_idx").on(table.taskType, table.status),
  ],
);

// ───────────────────────────────────────────────────────────────────
// impl_queue_jobs — 调度投递（PgQueueProvider）
// ───────────────────────────────────────────────────────────────────
//
// 只负责调度与投递：任务业务状态（进度 / 结果 / 错误）由 repository_tasks
// 持久化，本表不承载业务字段。
// 消费语义：Worker 事务内 FOR UPDATE SKIP LOCKED 抢占 queued 行，多实例不会
// 重复消费；进程重启后遗留 running 由 recoverStale() 标记为 failed(interrupted)。
// impl_ 前缀表示"实现专属"：换成 BullMQ/Redis 后本表整体废弃。

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
    index("impl_queue_jobs_status_available_idx").on(table.status, table.availableAt),
    // 按队列名过滤（同一队列多消费者场景）
    index("impl_queue_jobs_queue_status_idx").on(table.queueName, table.status),
  ],
);
