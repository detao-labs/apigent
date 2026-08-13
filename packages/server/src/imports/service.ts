// ═══════════════════════════════════════════════════════════════════
// Import Task Service — 异步导入任务的创建 / 查询 / 重试
// ═══════════════════════════════════════════════════════════════════

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { generateId } from "../id";
import { getDB, repoTasks, repositories } from "../db";
import { logError, logInfo } from "../logger";
import { startImportWorker } from "./worker";
import {
  DuplicateImportError,
  ImportError,
  IMPORT_QUEUE,
  MAX_SPEC_BYTES,
  RepoNotFoundError,
} from "./common";

export type ImportTaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface ImportTaskSummary {
  taskId: string;
  status: ImportTaskStatus;
  progress: number;
  versionId: string | null;
  nextVersion: string | null;
  result: unknown;
  error: string | null;
  createdAt: Date;
}

function toSummary(row: {
  id: string;
  status: string;
  progress: number;
  versionId: string | null;
  result: unknown;
  error: string | null;
  createdAt: Date;
}): ImportTaskSummary {
  const result = row.result as { nextVersion?: string } | null;
  return {
    taskId: row.id,
    status: row.status as ImportTaskStatus,
    progress: row.progress,
    versionId: row.versionId,
    nextVersion: result?.nextVersion ?? null,
    result: row.result,
    error: row.error,
    createdAt: row.createdAt,
  };
}

/**
 * 提交导入：Spec 原文落盘 → 写 queued 任务 → 入队，立即返回 taskId。
 * 同一仓库存在进行中的任务时抛 DuplicateImportError。
 */
export async function createImportTask(
  repoId: string,
  userId: string,
  content: string,
): Promise<ImportTaskSummary> {
  if (Buffer.byteLength(content, "utf8") > MAX_SPEC_BYTES) {
    throw new ImportError([
      {
        severity: "error",
        message: `OpenAPI document exceeds the ${MAX_SPEC_BYTES / 1024 / 1024}MB limit`,
      },
    ]);
  }

  const db = getDB();
  const [repoRow] = await db
    .select({ id: repositories.id })
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
        eq(repoTasks.taskType, "import"),
        inArray(repoTasks.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (active) throw new DuplicateImportError(active.id);

  const taskId = generateId("task");
  const ext = content.trimStart().startsWith("{") ? ".json" : ".yaml";
  const specPath = path.join(process.cwd(), ".data", "specs", repoId, `${taskId}${ext}`);
  await mkdir(path.dirname(specPath), { recursive: true });
  await writeFile(specPath, content, "utf8");

  await db.insert(repoTasks).values({
    id: taskId,
    repoId,
    userId,
    taskType: "import",
    status: "queued",
    payload: { specPath },
  });

  const queue = startImportWorker();
  const jobId = await queue.enqueue(IMPORT_QUEUE, {
    name: IMPORT_QUEUE,
    data: { taskId },
  });
  await db.update(repoTasks).set({ jobId }).where(eq(repoTasks.id, taskId));

  logInfo("openapi.import.queued", { taskId, repoId, userId, jobId });
  return toSummary({
    id: taskId,
    status: "queued",
    progress: 0,
    versionId: null,
    result: null,
    error: null,
    createdAt: new Date(),
  });
}

export async function getImportTask(
  taskId: string,
  userId: string,
): Promise<ImportTaskSummary | null> {
  const [row] = await getDB()
    .select({
      id: repoTasks.id,
      status: repoTasks.status,
      progress: repoTasks.progress,
      versionId: repoTasks.versionId,
      result: repoTasks.result,
      error: repoTasks.error,
      createdAt: repoTasks.createdAt,
    })
    .from(repoTasks)
    .where(
      and(
        eq(repoTasks.id, taskId),
        eq(repoTasks.taskType, "import"),
        eq(repoTasks.userId, userId),
      ),
    )
    .limit(1);
  return row ? toSummary(row) : null;
}

/** 仓库最近一次导入任务（供状态徽章 / 通知跳转）。 */
export async function getLatestImportTask(
  repoId: string,
): Promise<ImportTaskSummary | null> {
  const [row] = await getDB()
    .select({
      id: repoTasks.id,
      status: repoTasks.status,
      progress: repoTasks.progress,
      versionId: repoTasks.versionId,
      result: repoTasks.result,
      error: repoTasks.error,
      createdAt: repoTasks.createdAt,
    })
    .from(repoTasks)
    .where(and(eq(repoTasks.repoId, repoId), eq(repoTasks.taskType, "import")))
    .orderBy(desc(repoTasks.createdAt))
    .limit(1);
  return row ? toSummary(row) : null;
}

/** 失败重试：复用已落盘的 spec 原文重新入队。 */
export async function retryImportTask(
  taskId: string,
  userId: string,
): Promise<ImportTaskSummary | null> {
  const db = getDB();
  const [row] = await db
    .select()
    .from(repoTasks)
    .where(
      and(
        eq(repoTasks.id, taskId),
        eq(repoTasks.taskType, "import"),
        eq(repoTasks.userId, userId),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.status !== "failed") {
    throw new Error(`Import task ${taskId} is not retryable (status=${row.status})`);
  }

  await db
    .update(repoTasks)
    .set({
      status: "queued",
      progress: 0,
      error: null,
      result: null,
      attempts: row.attempts + 1,
      enqueuedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(repoTasks.id, taskId));

  const queue = startImportWorker();
  const jobId = await queue.enqueue(IMPORT_QUEUE, {
    name: IMPORT_QUEUE,
    data: { taskId },
  });
  await db.update(repoTasks).set({ jobId }).where(eq(repoTasks.id, taskId));

  logInfo("openapi.import.retried", { taskId, repoId: row.repoId, userId, jobId });
  return toSummary(row);
}

/** 供 API 层兜底记录错误（如重复提交、仓库不存在）。 */
export function logImportSubmitError(
  event: string,
  err: unknown,
  context: Record<string, unknown>,
): void {
  logError(event, err, context);
}
