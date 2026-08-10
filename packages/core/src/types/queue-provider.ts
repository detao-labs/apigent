// ═══════════════════════════════════════════════════════════════════
// Queue Provider Interface
// ═══════════════════════════════════════════════════════════════════

export interface QueueJob {
  id?: string;
  name: string;
  data: unknown;
}

export interface QueueProvider {
  /** Add a job to a queue */
  enqueue(queue: string, job: QueueJob): Promise<string>;

  /** Register a handler for a queue */
  process(queue: string, handler: (job: QueueJob) => Promise<void>): Promise<void>;

  /** Graceful shutdown */
  shutdown(): Promise<void>;
}
