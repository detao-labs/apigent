// ═══════════════════════════════════════════════════════════════════
// Memory Queue Provider — Dev Only
// ═══════════════════════════════════════════════════════════════════

import type { QueueProvider, QueueJob } from "../../types";

export class MemoryQueueProvider implements QueueProvider {
  private queues: Map<string, QueueJob[]> = new Map();
  private handlers: Map<string, (job: QueueJob) => Promise<void>> = new Map();
  private processing = false;

  async enqueue(queue: string, job: QueueJob): Promise<string> {
    const id = job.id ?? `${queue}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const jobs = this.queues.get(queue) ?? [];
    jobs.push({ ...job, id });
    this.queues.set(queue, jobs);

    // Process asynchronously if a handler is registered
    if (this.handlers.has(queue)) {
      this.drain(queue);
    }

    return id;
  }

  async process(queue: string, handler: (job: QueueJob) => Promise<void>): Promise<void> {
    this.handlers.set(queue, handler);
    this.drain(queue);
  }

  private async drain(queue: string): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    const handler = this.handlers.get(queue);
    const jobs = this.queues.get(queue) ?? [];

    while (handler && jobs.length > 0) {
      const job = jobs.shift()!;
      try {
        await handler(job);
      } catch {
        // Silently drop failed jobs in dev mode
      }
    }

    this.processing = false;
  }

  async shutdown(): Promise<void> {
    this.queues.clear();
    this.handlers.clear();
  }
}
