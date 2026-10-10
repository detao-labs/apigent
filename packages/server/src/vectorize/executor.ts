// ═══════════════════════════════════════════════════════════════════
// Vectorize Executor — 摄取任务执行器（Worker 调用）
// ═══════════════════════════════════════════════════════════════════
//
// 流程：解析目标 commit → 调注入的 runner（= `RagService.index`）→ 把
// `IndexReport` 写进 `repository_tasks.result`（token / 成本落库的落点）。
//
// 与上下文生成任务的差异：摄取**没有部分成功**的语义。要么这一轮索引与期望集合
// 一致，要么整轮失败重试 —— 半截的索引比没有索引更难查（检索会返回「上一次的
// 内容」而不是报错）。所以这里不做「接口级失败记入 result 但任务仍成功」。
// ═══════════════════════════════════════════════════════════════════

import { and, eq } from "drizzle-orm";
import { getDB, repositoryTasks, versions } from "../db";
import { logError, logInfo } from "../logger";
import { VectorizeTaskError } from "./common";
import type { VectorizeTaskPayload, VectorizeTaskResult } from "./plan";
import { getVectorizeRunner } from "./runner";

type TaskStatus = "queued" | "running" | "succeeded" | "failed";

async function updateTask(
  taskId: string,
  patch: {
    status?: TaskStatus;
    progress?: number;
    result?: unknown;
    error?: string | null;
    startedAt?: Date;
    finishedAt?: Date;
  },
): Promise<void> {
  await getDB()
    .update(repositoryTasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(repositoryTasks.id, taskId));
}

export async function executeVectorizeTask(taskId: string): Promise<void> {
  const db = getDB();
  const [task] = await db
    .select({
      id: repositoryTasks.id,
      repositoryId: repositoryTasks.repositoryId,
      versionId: repositoryTasks.versionId,
      status: repositoryTasks.status,
      payload: repositoryTasks.payload,
    })
    .from(repositoryTasks)
    .where(and(eq(repositoryTasks.id, taskId), eq(repositoryTasks.taskType, "vectorize")))
    .limit(1);
  if (!task) {
    throw new VectorizeTaskError("task-not-found", `Vectorize task not found: ${taskId}`);
  }
  // 幂等：队列重投（进程重启、重复入队）不该把已经成功的任务再跑一遍 —— 虽然
  // P4-6 的复用让它便宜，但「成功过又变成 running」会让任务中心的状态抖动。
  if (task.status === "succeeded") {
    logInfo("rag.vectorize.already_succeeded", { taskId, repositoryId: task.repositoryId });
    return;
  }

  const payload = (task.payload ?? {}) as Partial<VectorizeTaskPayload>;
  await updateTask(taskId, { status: "running", progress: 5, error: null, startedAt: new Date() });

  try {
    // runner 未注册 → 抛 `disabled`。这是**部署配置错误**（自动触发时已经拦过一次），
    // 让它以失败任务的形式可见，而不是静默成功。
    const runner = getVectorizeRunner();
    const commitId = await resolveCommitId(task.repositoryId, payload.commitId ?? task.versionId);

    const report = await runner({
      repositoryId: task.repositoryId,
      commitId,
      ...(payload.endpoints ? { endpoints: payload.endpoints } : {}),
      ...(payload.force ? { force: true } : {}),
    });

    const result: VectorizeTaskResult = {
      commitId,
      chunksWritten: report.chunksWritten,
      chunksSkipped: report.chunksSkipped,
      chunksDeleted: report.chunksDeleted,
      tokens: report.tokens,
      ...(report.costUsd !== undefined ? { costUsd: report.costUsd } : {}),
      durationMs: report.durationMs,
    };
    await updateTask(taskId, {
      status: "succeeded",
      progress: 100,
      result,
      finishedAt: new Date(),
    });
    logInfo("rag.vectorize.completed", {
      taskId,
      repositoryId: task.repositoryId,
      commitId,
      trigger: payload.trigger ?? "manual",
      ...result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateTask(taskId, { status: "failed", error: message, finishedAt: new Date() });
    logError("rag.vectorize.failed", err, {
      taskId,
      repositoryId: task.repositoryId,
      trigger: payload.trigger ?? "manual",
    });
    // 继续抛：队列据此把 job 标 failed（任务表与队列表两处状态都要对）。
    throw err;
  }
}

/**
 * 解析要索引的 commit。
 *
 * 任务里存的 commit 是提交那一刻的 head；到执行时它可能已经不是 head（触发与执行
 * 之间又有新导入）。这里优先用任务里记的值：它代表「这一轮要处理的内容」，而
 * P4-6 的 content_hash 复用让「已经被别的任务索引过」的部分不花第二次钱。
 * 只有任务里没有（历史任务、手工构造）时才回落到当前 head。
 */
async function resolveCommitId(
  repositoryId: string,
  fromTask: string | null | undefined,
): Promise<string> {
  if (fromTask) return fromTask;

  const [row] = await getDB()
    .select({ headCommitId: versions.headCommitId })
    .from(versions)
    .where(and(eq(versions.repositoryId, repositoryId), eq(versions.isDefault, true)))
    .limit(1);
  const head = row?.headCommitId ?? null;
  if (!head) {
    throw new VectorizeTaskError(
      "nothing-to-index",
      `Repository ${repositoryId} has no default version head commit to index`,
    );
  }
  return head;
}
