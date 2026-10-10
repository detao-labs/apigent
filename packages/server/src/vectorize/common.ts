// ═══════════════════════════════════════════════════════════════════
// Vectorize Common — 共享常量与错误
// ═══════════════════════════════════════════════════════════════════

/** 队列名。与 `repository_tasks.task_type` 的 `vectorize` 一一对应。 */
export const VECTORIZE_QUEUE = "rag.vectorize";

/**
 * 摄取任务错误。`code` 是给调用方（API route / 任务中心）用的稳定判别值，
 * 不靠解析 message —— 与 `AdminMemberError` 同一约定。
 */
export type VectorizeTaskErrorCode =
  /** 没有注册 runner：RAG 摄取在这套部署里不可用（P6-1 会注册真实实现） */
  | "disabled"
  /** 仓库不存在，或没有任何可索引的 head commit */
  | "nothing-to-index"
  | "task-not-found"
  | "not-retryable";

export class VectorizeTaskError extends Error {
  constructor(
    public readonly code: VectorizeTaskErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VectorizeTaskError";
  }
}
