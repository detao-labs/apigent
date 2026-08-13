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
import { repositories, repoVersions } from "./repo";
import { implQueueJobs } from "./queue";

// ═══════════════════════════════════════════════════════════════════
// Repo Tasks — 仓库级异步任务（统一任务表）
// ═══════════════════════════════════════════════════════════════════
//
// 一个任务 = 一个 task_type（import / context / vectorize / …）+ 通用状态列
//   - payload：类型专属入参（import→{specPath}；context→{trigger,endpointIds,force}）
//   - result：类型专属统计（import→{stats,issues,nextVersion}；context→{reused/generated/failed,…}）
//   - version_id：import→产出版本；context→目标版本
//   - depends_on：同一 repo 的前置任务 id（顺序依赖；空 = 无依赖）
// 调度投递由 impl_queue_jobs 负责（job_id 关联）；任务业务状态在本表持久化。
// ═══════════════════════════════════════════════════════════════════

export const repoTasks = pgTable(
  "repo_tasks",
  {
    id: text("id").primaryKey(),
    /** 关联 impl_queue_jobs（调度投递），入队后回填 */
    jobId: text("job_id").references(() => implQueueJobs.id),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    /** import→产出版本；context→目标版本 */
    versionId: text("version_id").references(() => repoVersions.id),
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
    dependsOn: text("depends_on").references((): AnyPgColumn => repoTasks.id),
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
    index("repo_tasks_repo_status_idx").on(table.repoId, table.status),
    // 用户任务列表
    index("repo_tasks_user_idx").on(table.userId, table.createdAt.desc()),
    // 按类型过滤（任务中心 / 状态徽章）
    index("repo_tasks_type_status_idx").on(table.taskType, table.status),
  ],
);
