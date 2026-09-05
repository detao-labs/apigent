// ═══════════════════════════════════════════════════════════════════
// Context Worker — 上下文生成任务 Worker 引导
// ═══════════════════════════════════════════════════════════════════
//
// 懒加载单例：首次提交生成任务时注册队列处理器并启动进程内消费循环。
// 完整设计见 docs/modules/business-context.md §3。
// ═══════════════════════════════════════════════════════════════════

import { loadConfig } from "@apigent/core/config";
import { getContainer } from "@apigent/core/di";
import type { QueueProvider } from "@apigent/core/types";
import { PgQueueProvider, registerQueueProviders } from "../queue";
import { logError, logInfo, withTaskContext } from "../logger";
import { executeContextTask } from "./executor";
import { CONTEXT_QUEUE } from "./common";

let queueProvider: QueueProvider | null = null;

/** 确保上下文 Worker 已启动（幂等），返回当前队列实例。 */
export function startContextWorker(): QueueProvider {
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
    .process(CONTEXT_QUEUE, async (job) => {
      const taskId = (job.data as { taskId?: string } | null)?.taskId;
      if (!taskId) throw new Error(`business.context job missing taskId: ${job.id}`);
      logInfo("business.context.started", { jobId: job.id, taskId });
      await withTaskContext(taskId, () => executeContextTask(taskId));
    })
    .catch((err) => {
      logError("queue.process_registration_failed", err, { queue: CONTEXT_QUEUE });
    });

  queueProvider = queue;
  return queueProvider;
}

/** 进程退出前调用（生产 Worker 优雅关闭）。 */
export async function stopContextWorker(): Promise<void> {
  if (queueProvider) {
    await queueProvider.shutdown();
    queueProvider = null;
  }
}
