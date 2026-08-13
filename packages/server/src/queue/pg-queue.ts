// ═══════════════════════════════════════════════════════════════════
// PgQueueProvider — Postgres 队列（V0 默认 QueueProvider 实现）
// ═══════════════════════════════════════════════════════════════════
//
// - 只负责调度与投递：业务任务状态由业务表（如 import_tasks）持久化；
// - 消费：事务内 SELECT ... FOR UPDATE SKIP LOCKED 抢占 queued 行，
//   多实例不会重复消费同一任务；
// - Worker：进程内轮询（默认 1s），按已注册 handler 的队列过滤；
// - 重启恢复：recoverStale() 把超过阈值仍处于 running 的任务标记为
//   failed(interrupted)，避免僵尸任务。
//
// 完整设计见 docs/modules/async-queue.md。
// ═══════════════════════════════════════════════════════════════════

import { and, eq, inArray, lte, lt, sql } from "drizzle-orm";
import type { QueueJob, QueueProvider } from "@apigent/core/types";
import { generateId } from "../id";
import { getDB } from "../db";
import { implQueueJobs } from "../db";

type JobStatus = "queued" | "running" | "completed" | "failed";
type QueueHandler = (job: QueueJob) => Promise<void>;

interface PgQueueOptions {
  /** 进程内轮询间隔（毫秒），默认 1000 */
  pollIntervalMs?: number;
  /** recoverStale() 判定 running 过期的阈值（毫秒），默认 5 分钟 */
  staleAfterMs?: number;
}

export class PgQueueProvider implements QueueProvider {
  private readonly handlers = new Map<string, QueueHandler>();
  private readonly pollIntervalMs: number;
  private readonly staleAfterMs: number;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(options: PgQueueOptions = {}) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.staleAfterMs = options.staleAfterMs ?? 5 * 60_000;
  }

  async enqueue(queue: string, job: QueueJob): Promise<string> {
    const id = job.id ?? generateId("job");
    await getDB().insert(implQueueJobs).values({
      id,
      queueName: queue,
      name: job.name,
      data: job.data,
      status: "queued",
      attempts: 0,
    });
    this.ensureLoop();
    return id;
  }

  async process(queue: string, handler: QueueHandler): Promise<void> {
    this.handlers.set(queue, handler);
    this.ensureLoop();
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.handlers.clear();
  }

  /**
   * 把超过阈值仍处于 running 的任务标记为 failed(interrupted)。
   * 启动时调用一次；多实例下只回收真正卡死的任务，不影响在途任务。
   * 返回受影响的任务数。
   */
  async recoverStale(): Promise<number> {
    const staleBefore = new Date(Date.now() - this.staleAfterMs);
    const result = await getDB()
      .update(implQueueJobs)
      .set({
        status: "failed",
        error: "interrupted: stale running job after worker restart",
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(implQueueJobs.status, "running"), lt(implQueueJobs.updatedAt, staleBefore)));
    return result.rowCount ?? 0;
  }

  private ensureLoop(): void {
    if (this.timer || this.handlers.size === 0) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
    // 不让定时器阻止进程退出（脚本/测试场景）
    this.timer.unref?.();
    void this.tick();
  }

  /** 抢占一个 queued 任务并执行；队列为空时返回 false */
  private async tick(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const row = await this.claimNext();
      if (!row) return false;
      const handler = this.handlers.get(row.queueName);
      if (!handler) return false;

      try {
        await handler({ id: row.id, name: row.name, data: row.data });
        await this.setFinished(row.id, "completed", null);
      } catch (err) {
        await this.setFinished(
          row.id,
          "failed",
          err instanceof Error ? err.message : String(err),
        );
      }
      return true;
    } finally {
      this.busy = false;
    }
  }

  /** 事务内 FOR UPDATE SKIP LOCKED 抢占队首 queued 任务 */
  private async claimNext(): Promise<{
    id: string;
    queueName: string;
    name: string;
    data: unknown;
  } | null> {
    const queueNames = [...this.handlers.keys()];
    if (queueNames.length === 0) return null;

    return getDB().transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: implQueueJobs.id,
          queueName: implQueueJobs.queueName,
          name: implQueueJobs.name,
          data: implQueueJobs.data,
        })
        .from(implQueueJobs)
        .where(
          and(
            eq(implQueueJobs.status, "queued"),
            lte(implQueueJobs.availableAt, new Date()),
            inArray(implQueueJobs.queueName, queueNames),
          ),
        )
        .orderBy(implQueueJobs.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });

      if (!row) return null;

      await tx
        .update(implQueueJobs)
        .set({
          status: "running",
          attempts: sql`${implQueueJobs.attempts} + 1`,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(implQueueJobs.id, row.id));

      return row;
    });
  }

  private async setFinished(
    id: string,
    status: Extract<JobStatus, "completed" | "failed">,
    error: string | null,
  ): Promise<void> {
    await getDB()
      .update(implQueueJobs)
      .set({
        status,
        error,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(implQueueJobs.id, id));
  }
}
