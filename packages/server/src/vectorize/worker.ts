// ═══════════════════════════════════════════════════════════════════
// Vectorize Worker — 摄取任务 Worker 引导
// ═══════════════════════════════════════════════════════════════════
//
// 懒加载单例：首次提交摄取任务时注册队列处理器并启动进程内消费循环
// （与 `contexts/worker.ts` 同一形态；P6-1 可以在进程启动时显式调一次）。
// ═══════════════════════════════════════════════════════════════════

import { loadConfig } from "@apigent/core/config";
import { getContainer } from "@apigent/core/di";
import type { QueueProvider } from "@apigent/core/types";
import { PgQueueProvider, registerQueueProviders } from "../queue";
import { logError, logInfo, withTaskContext } from "../logger";
import { VECTORIZE_QUEUE } from "./common";
import { executeVectorizeTask } from "./executor";

let queueProvider: QueueProvider | null = null;

/** 确保摄取 Worker 已启动（幂等），返回当前队列实例。 */
export function startVectorizeWorker(): QueueProvider {
  if (queueProvider) return queueProvider;

  loadConfig();
  const container = getContainer();
  registerQueueProviders(container);
  const queue = container.getQueue();

  if (queue instanceof PgQueueProvider) {
    void queue.recoverStale().catch((err) => {
      logError("queue.recover_stale_failed", err);
    });
  }

  void queue
    .process(VECTORIZE_QUEUE, async (job) => {
      const taskId = (job.data as { taskId?: string } | null)?.taskId;
      if (!taskId) throw new Error(`rag.vectorize job missing taskId: ${job.id}`);
      logInfo("rag.vectorize.started", { jobId: job.id, taskId });
      await withTaskContext(taskId, () => executeVectorizeTask(taskId));
    })
    .catch((err) => {
      logError("queue.process_registration_failed", err, { queue: VECTORIZE_QUEUE });
    });

  queueProvider = queue;
  return queueProvider;
}

/** 进程退出前调用（生产 Worker 优雅关闭）。 */
export async function stopVectorizeWorker(): Promise<void> {
  if (queueProvider) {
    await queueProvider.shutdown();
    queueProvider = null;
  }
}
