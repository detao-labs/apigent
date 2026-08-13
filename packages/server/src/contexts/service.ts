// ═══════════════════════════════════════════════════════════════════
// Context Task Service — 上下文生成任务（基于统一 repo_tasks）
// ═══════════════════════════════════════════════════════════════════
//
// task_type = "context"；payload = { trigger, endpointIds?, force? }；
// 统计（total/processed/reused/generated/failed）由 executor 写入 result。
// ═══════════════════════════════════════════════════════════════════

import { and, desc, eq, inArray } from "drizzle-orm";
import { generateId } from "../id";
import { getDB, repositories, repoTasks } from "../db";
import { logInfo } from "../logger";
import { startContextWorker } from "./worker";
import {
  CONTEXT_QUEUE,
  DuplicateContextTaskError,
  RepoNotFoundError,
} from "./common";

export type ContextTaskTrigger = "auto" | "manual";
export type ContextTaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface ContextTaskScope {
  /** 指定接口（空/缺省 = 全仓库） */
  endpointIds?: string[];
  /** 覆盖人工编辑过的接口 */
  force?: boolean;
}

/** context 任务的 payload 形态 */
export interface ContextTaskPayload extends ContextTaskScope {
  trigger: ContextTaskTrigger;
}

/** context 任务的 result 统计形态 */
export interface ContextTaskResult {
  totalCount?: number;
  processedCount?: number;
  reusedCount?: number;
  generatedCount?: number;
  failedCount?: number;
}

export interface ContextTaskSummary {
  taskId: string;
  status: ContextTaskStatus;
  progress: number;
  trigger: ContextTaskTrigger;
  totalCount: number;
  processedCount: number;
  reusedCount: number;
  generatedCount: number;
  failedCount: number;
  result: unknown;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

interface ContextTaskRow {
  id: string;
  status: string;
  progress: number;
  payload: unknown;
  result: unknown;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

function toSummary(row: ContextTaskRow): ContextTaskSummary {
  const payload = row.payload as ContextTaskPayload;
  const result = (row.result ?? {}) as ContextTaskResult;
  return {
    taskId: row.id,
    status: row.status as ContextTaskStatus,
    progress: row.progress,
    trigger: payload.trigger ?? "manual",
    totalCount: result.totalCount ?? 0,
    processedCount: result.processedCount ?? 0,
    reusedCount: result.reusedCount ?? 0,
    generatedCount: result.generatedCount ?? 0,
    failedCount: result.failedCount ?? 0,
    result: row.result,
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

const CONTEXT_FIELDS = {
  id: repoTasks.id,
  status: repoTasks.status,
  progress: repoTasks.progress,
  payload: repoTasks.payload,
  result: repoTasks.result,
  error: repoTasks.error,
  createdAt: repoTasks.createdAt,
  finishedAt: repoTasks.finishedAt,
} as const;

/**
 * 提交生成任务：写 queued 任务 → 入队，立即返回 taskId。
 * 同仓库存在进行中的 context 任务时抛 DuplicateContextTaskError。
 */
export async function createContextTask(
  repoId: string,
  userId: string,
  options: {
    trigger?: ContextTaskTrigger;
    scope?: ContextTaskScope;
    /** 前置任务 id（如导入任务），写入 depends_on */
    dependsOn?: string;
  } = {},
): Promise<ContextTaskSummary> {
  const db = getDB();
  const [repoRow] = await db
    .select({
      id: repositories.id,
      currentVersionId: repositories.currentVersionId,
    })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  if (!repoRow) throw new RepoNotFoundError(repoId);

  const [active] = await db
    .select({ id: repoTasks.id })
    .from(repoTasks)
    .where(
      and(
        eq(repoTasks.repoId, repoId),
        eq(repoTasks.taskType, "context"),
        inArray(repoTasks.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (active) throw new DuplicateContextTaskError(active.id);

  const trigger = options.trigger ?? "manual";
  const taskId = generateId("task");
  const payload: ContextTaskPayload = {
    trigger,
    ...options.scope,
  };
  await db.insert(repoTasks).values({
    id: taskId,
    repoId,
    versionId: repoRow.currentVersionId,
    userId,
    taskType: "context",
    dependsOn: options.dependsOn ?? undefined,
    payload,
  });

  const queue = startContextWorker();
  const jobId = await queue.enqueue(CONTEXT_QUEUE, {
    name: CONTEXT_QUEUE,
    data: { taskId },
  });
  await db.update(repoTasks).set({ jobId }).where(eq(repoTasks.id, taskId));

  logInfo("business.context.queued", { taskId, repoId, userId, jobId, trigger });
  return {
    taskId,
    status: "queued",
    progress: 0,
    trigger,
    totalCount: 0,
    processedCount: 0,
    reusedCount: 0,
    generatedCount: 0,
    failedCount: 0,
    result: null,
    error: null,
    createdAt: new Date(),
    finishedAt: null,
  };
}

export async function getContextTask(
  taskId: string,
): Promise<ContextTaskSummary | null> {
  const [row] = await getDB()
    .select(CONTEXT_FIELDS)
    .from(repoTasks)
    .where(and(eq(repoTasks.id, taskId), eq(repoTasks.taskType, "context")))
    .limit(1);
  return row ? toSummary(row) : null;
}

/** 最近一次生成任务（前端轮询 / 仓库状态徽章）。 */
export async function getLatestContextTask(
  repoId: string,
): Promise<ContextTaskSummary | null> {
  const [row] = await getDB()
    .select(CONTEXT_FIELDS)
    .from(repoTasks)
    .where(and(eq(repoTasks.repoId, repoId), eq(repoTasks.taskType, "context")))
    .orderBy(desc(repoTasks.createdAt))
    .limit(1);
  return row ? toSummary(row) : null;
}

/** 重试失败任务：状态复位 + 重新入队（payload 保留，scope 不变）。 */
export async function retryContextTask(
  taskId: string,
): Promise<ContextTaskSummary> {
  const db = getDB();
  const [row] = await db
    .select({
      id: repoTasks.id,
      status: repoTasks.status,
      userId: repoTasks.userId,
      attempts: repoTasks.attempts,
    })
    .from(repoTasks)
    .where(and(eq(repoTasks.id, taskId), eq(repoTasks.taskType, "context")))
    .limit(1);
  if (!row) throw new Error(`Context task not found: ${taskId}`);
  if (row.status !== "failed") {
    throw new Error(`Context task is not retryable (status=${row.status})`);
  }

  await db
    .update(repoTasks)
    .set({
      status: "queued",
      progress: 0,
      result: null,
      error: null,
      attempts: (row.attempts ?? 0) + 1,
      startedAt: null,
      finishedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(repoTasks.id, taskId));

  const queue = startContextWorker();
  const jobId = await queue.enqueue(CONTEXT_QUEUE, {
    name: CONTEXT_QUEUE,
    data: { taskId },
  });
  await db.update(repoTasks).set({ jobId }).where(eq(repoTasks.id, taskId));

  const summary = await getContextTask(taskId);
  if (!summary) throw new Error(`Context task not found: ${taskId}`);
  return summary;
}
