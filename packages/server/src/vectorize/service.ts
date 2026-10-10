// ═══════════════════════════════════════════════════════════════════
// Vectorize Service — RAG 摄取任务（基于统一 repository_tasks）
// ═══════════════════════════════════════════════════════════════════
//
// task_type = "vectorize"；payload = { trigger, commitId?, endpoints?, force? }；
// 统计（chunksWritten / chunksSkipped / chunksDeleted / tokens）由 executor 从
// `IndexReport` 写入 result —— P4-6 的 token/成本落库就在这里落地。
//
// 一句话区分两类入口：
//   - `createVectorizeTask()`：显式提交（API / 任务中心），失败会抛错，调用方要处理；
//   - `triggerVectorize()`：**自动触发**（导入成功 / 上下文保存 / 版本激活），
//     未启用或出错只记日志，绝不打断业务事务。
// ═══════════════════════════════════════════════════════════════════

import { and, desc, eq, inArray } from "drizzle-orm";
import { getDB, repositories, repositoryTasks, versions } from "../db";
import { generateId } from "../id";
import { logError, logInfo } from "../logger";
import { VECTORIZE_QUEUE, VectorizeTaskError } from "./common";
import {
  findReusableVectorizeTask,
  isVectorizeTaskActive,
  toVectorizeSummary,
  type VectorizeTaskPayload,
  type VectorizeTaskSummary,
  type VectorizeTaskTrigger,
} from "./plan";
import { hasVectorizeRunner } from "./runner";
import { startVectorizeWorker } from "./worker";

export interface VectorizeTaskScope {
  /** 指定要索引的 commit；缺省 = 仓库主版本的 head commit */
  commitId?: string;
  /** 只重索引部分接口（identity_key） */
  endpoints?: string[];
  /** 忽略 content_hash 复用，强制重算 */
  force?: boolean;
}

const VECTORIZE_FIELDS = {
  id: repositoryTasks.id,
  status: repositoryTasks.status,
  progress: repositoryTasks.progress,
  payload: repositoryTasks.payload,
  result: repositoryTasks.result,
  error: repositoryTasks.error,
  versionId: repositoryTasks.versionId,
  createdAt: repositoryTasks.createdAt,
  finishedAt: repositoryTasks.finishedAt,
} as const;

/**
 * 提交摄取任务：写 queued 任务 → 入队，立即返回 taskId。
 *
 * **同一 `(repository, commit)` 已有进行中的任务时复用它**（返回那个任务的摘要，
 * 不新建、不抛错）—— 三个自动触发点天然重叠，幂等是正确性要求而不是优化，
 * 详见 `plan.ts` 的 `findReusableVectorizeTask`。
 */
export async function createVectorizeTask(
  repositoryId: string,
  userId: string,
  options: VectorizeTaskScope & { trigger?: VectorizeTaskTrigger } = {},
): Promise<VectorizeTaskSummary> {
  const db = getDB();
  const [repoRow] = await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .limit(1);
  if (!repoRow) {
    throw new VectorizeTaskError(
      "nothing-to-index",
      `Cannot create a vectorize task: repository ${repositoryId} does not exist`,
    );
  }

  const commitId = options.commitId ?? (await resolveHeadCommitId(repositoryId));
  if (!commitId) {
    throw new VectorizeTaskError(
      "nothing-to-index",
      `Cannot create a vectorize task: repository ${repositoryId} has no default version ` +
        "with a head commit (import a spec first)",
    );
  }

  const trigger = options.trigger ?? "manual";
  const payload: VectorizeTaskPayload = {
    trigger,
    commitId,
    ...(options.endpoints ? { endpoints: options.endpoints } : {}),
    ...(options.force ? { force: true } : {}),
  };

  // 去重：同一 (repo, commit) 的进行中任务。只查「同仓 + 同类型」的行，条数有界。
  const activeRows = await db
    .select(VECTORIZE_FIELDS)
    .from(repositoryTasks)
    .where(
      and(
        eq(repositoryTasks.repositoryId, repositoryId),
        eq(repositoryTasks.taskType, "vectorize"),
        inArray(repositoryTasks.status, ["queued", "running"]),
      ),
    )
    .limit(20);
  const reusable = findReusableVectorizeTask(
    activeRows.map((row) => ({
      taskId: row.id,
      status: row.status,
      commitId: row.versionId,
      row,
    })),
    commitId,
  );
  if (reusable) {
    logInfo("rag.vectorize.reused", {
      taskId: reusable.row.id,
      repositoryId,
      commitId,
      trigger,
      status: reusable.row.status,
    });
    return toVectorizeSummary(reusable.row);
  }

  const taskId = generateId("task");
  await db.insert(repositoryTasks).values({
    id: taskId,
    repositoryId,
    versionId: commitId,
    userId,
    taskType: "vectorize",
    payload,
  });

  const queue = startVectorizeWorker();
  const jobId = await queue.enqueue(VECTORIZE_QUEUE, {
    name: VECTORIZE_QUEUE,
    data: { taskId },
  });
  await db.update(repositoryTasks).set({ jobId }).where(eq(repositoryTasks.id, taskId));

  logInfo("rag.vectorize.queued", { taskId, repositoryId, userId, commitId, jobId, trigger });
  const created = await getVectorizeTask(repositoryId, taskId);
  if (!created) throw new VectorizeTaskError("task-not-found", `Vectorize task ${taskId} vanished`);
  return created;
}

/**
 * 自动触发（导入成功 / 上下文保存 / 版本激活）。
 *
 * 两处「不打断」的边界：没注册 runner 时直接跳过并留痕（这套部署没有 RAG），
 * 提交失败也只记日志 —— 业务事务（导入 / 上下文保存 / 切版本）已经提交，索引是
 * 派生数据，不能反过来把它拖失败。
 */
export async function triggerVectorize(
  repositoryId: string,
  userId: string,
  options: VectorizeTaskScope & { trigger: VectorizeTaskTrigger },
): Promise<void> {
  if (!hasVectorizeRunner()) {
    logInfo("rag.vectorize.skipped", {
      repositoryId,
      trigger: options.trigger,
      reason: "runner_not_registered",
    });
    return;
  }

  try {
    await createVectorizeTask(repositoryId, userId, options);
  } catch (err) {
    logError("rag.vectorize.trigger_failed", err, {
      repositoryId,
      trigger: options.trigger,
      commitId: options.commitId,
    });
  }
}

/** 读取任务详情。按仓库过滤 —— 任务 id 全局唯一，只校验 id 不够。 */
export async function getVectorizeTask(
  repositoryId: string,
  taskId: string,
): Promise<VectorizeTaskSummary | null> {
  const [row] = await getDB()
    .select(VECTORIZE_FIELDS)
    .from(repositoryTasks)
    .where(
      and(
        eq(repositoryTasks.repositoryId, repositoryId),
        eq(repositoryTasks.id, taskId),
        eq(repositoryTasks.taskType, "vectorize"),
      ),
    )
    .limit(1);
  return row ? toVectorizeSummary(row) : null;
}

/** 最近一次摄取任务（前端轮询 / 仓库状态徽章）。 */
export async function getLatestVectorizeTask(
  repositoryId: string,
): Promise<VectorizeTaskSummary | null> {
  const [row] = await getDB()
    .select(VECTORIZE_FIELDS)
    .from(repositoryTasks)
    .where(
      and(
        eq(repositoryTasks.repositoryId, repositoryId),
        eq(repositoryTasks.taskType, "vectorize"),
      ),
    )
    .orderBy(desc(repositoryTasks.createdAt))
    .limit(1);
  return row ? toVectorizeSummary(row) : null;
}

/**
 * 重试失败任务：状态复位 + 重新入队（payload 保留）。
 *
 * 为什么重试是安全的：P4-6 的对账式同步是**幂等**的 —— 同一份内容命中
 * content_hash 复用（不重算向量），期望集合之外的旧内容才被解绑。所以重试不会
 * 产生重复行，也不会因为「上次写了一半」而留下不一致。
 */
export async function retryVectorizeTask(
  repositoryId: string,
  taskId: string,
): Promise<VectorizeTaskSummary> {
  const db = getDB();
  const [row] = await db
    .select({
      id: repositoryTasks.id,
      status: repositoryTasks.status,
      attempts: repositoryTasks.attempts,
    })
    .from(repositoryTasks)
    .where(
      and(
        eq(repositoryTasks.repositoryId, repositoryId),
        eq(repositoryTasks.id, taskId),
        eq(repositoryTasks.taskType, "vectorize"),
      ),
    )
    .limit(1);
  if (!row) {
    throw new VectorizeTaskError("task-not-found", `Vectorize task not found: ${taskId}`);
  }
  if (row.status !== "failed") {
    throw new VectorizeTaskError(
      "not-retryable",
      `Vectorize task ${taskId} is not retryable (status=${row.status})`,
    );
  }

  await db
    .update(repositoryTasks)
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
    .where(eq(repositoryTasks.id, taskId));

  const queue = startVectorizeWorker();
  const jobId = await queue.enqueue(VECTORIZE_QUEUE, {
    name: VECTORIZE_QUEUE,
    data: { taskId },
  });
  await db.update(repositoryTasks).set({ jobId }).where(eq(repositoryTasks.id, taskId));

  const summary = await getVectorizeTask(repositoryId, taskId);
  if (!summary) throw new VectorizeTaskError("task-not-found", `Vectorize task ${taskId} vanished`);
  return summary;
}

/** 主版本（`is_default`）的 head commit —— P0-4：V0 索引的就是它。 */
async function resolveHeadCommitId(repositoryId: string): Promise<string | null> {
  const [row] = await getDB()
    .select({ headCommitId: versions.headCommitId })
    .from(versions)
    .where(and(eq(versions.repositoryId, repositoryId), eq(versions.isDefault, true)))
    .limit(1);
  return row?.headCommitId ?? null;
}

export { isVectorizeTaskActive };
