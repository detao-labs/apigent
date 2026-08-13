import {
  pgTable,
  text,
  varchar,
  jsonb,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { repositories } from "./repo";
import { implQueueJobs } from "./queue";

// ═══════════════════════════════════════════════════════════════════
// Import Tasks — OpenAPI 导入任务（业务事实源）
// ═══════════════════════════════════════════════════════════════════
//
// 调度投递由 impl_queue_jobs 负责（job_id 关联），本表承载导入任务的
// 业务状态：进度、结果、错误。任务结果通过通用通知触达用户。
// 完整设计见 docs/modules/async-queue.md §5。
// ═══════════════════════════════════════════════════════════════════

export const importTasks = pgTable(
  "import_tasks",
  {
    id: text("id").primaryKey(),
    /** 关联 impl_queue_jobs（调度投递），入队后回填 */
    jobId: text("job_id").references(() => implQueueJobs.id),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    /** queued | running | succeeded | failed */
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    /** 0-100，供进度条展示 */
    progress: integer("progress").notNull().default(0),
    /** 提交时 Spec 原文落盘路径，Worker 不依赖请求体 */
    specPath: text("spec_path").notNull(),
    /** 成功后的版本快照 ID */
    versionId: text("version_id"),
    /** 导入序号 v1/v2/… */
    nextVersion: varchar("next_version", { length: 50 }),
    /** 成功：stats；失败：issues 列表 */
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    /** 重试次数 */
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
    // 重复导入检查：repo 下进行中的任务
    index("import_tasks_repo_status_idx").on(table.repoId, table.status),
    // 用户任务列表
    index("import_tasks_user_idx").on(table.userId, table.createdAt.desc()),
  ],
);
