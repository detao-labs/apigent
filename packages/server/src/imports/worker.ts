// ═══════════════════════════════════════════════════════════════════
// Import Worker — 导入任务 Worker 引导
// ═══════════════════════════════════════════════════════════════════
//
// 懒加载单例：首次提交导入时注册队列处理器并启动进程内消费循环。
// - 通过 Core Container 按配置解析 QueueProvider（postgres / memory / bullmq…）；
// - 启动时回收遗留 running 任务（recoverStale）；
// - 生产环境可把本引导移入独立 Worker 进程。
// ═══════════════════════════════════════════════════════════════════

import { loadConfig } from "@apigent/core/config";
import { getContainer } from "@apigent/core/di";
import type { QueueProvider } from "@apigent/core/types";
import { PgQueueProvider, registerQueueProviders } from "../queue";
import { logError, logInfo } from "../logger";
import { executeImportTask } from "./executor";
import { IMPORT_QUEUE } from "./common";

let queueProvider: QueueProvider | null = null;

/**
 * 确保导入 Worker 已启动（幂等），返回当前队列实例。
 */
export function startImportWorker(): QueueProvider {
  if (queueProvider) return queueProvider;

  loadConfig();
  const container = getContainer();
  registerQueueProviders(container);
  const queue = container.getQueue();

  if (queue instanceof PgQueueProvider) {
    // 重启恢复：把超时仍 running 的 job 标记为 failed(interrupted)
    void queue.recoverStale().catch((err) => {
      logError("queue.recover_stale_failed", err);
    });
  }

  void queue
    .process(IMPORT_QUEUE, async (job) => {
      const taskId = (job.data as { taskId?: string } | null)?.taskId;
      if (!taskId) throw new Error(`openapi.import job missing taskId: ${job.id}`);
      logInfo("openapi.import.started", { jobId: job.id, taskId });
      await executeImportTask(taskId);
    })
    .catch((err) => {
      logError("queue.process_registration_failed", err, { queue: IMPORT_QUEUE });
    });

  queueProvider = queue;
  return queueProvider;
}

/** 进程退出前调用（生产 Worker 优雅关闭）。 */
export async function stopImportWorker(): Promise<void> {
  if (queueProvider) {
    await queueProvider.shutdown();
    queueProvider = null;
  }
}
