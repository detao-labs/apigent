// ═══════════════════════════════════════════════════════════════════
// Vectorize Plan — 任务的纯决策逻辑（无 DB、可直接单测）
// ═══════════════════════════════════════════════════════════════════
//
// 这里只放「给定现状 → 做什么决定」的部分，DB 读写在 service.ts。
// 分离的理由很实际：摄取任务的三个触发点（导入成功 / 业务上下文保存 / 版本激活）
// **天然会重叠**，去重规则是这套机制里唯一容易写错、又最难在集成环境复现的地方
// （时序依赖），所以它必须是纯函数、有穷举用例。
// ═══════════════════════════════════════════════════════════════════

export type VectorizeTaskTrigger = "import" | "context_saved" | "version_activate" | "manual";
export type VectorizeTaskStatus = "queued" | "running" | "succeeded" | "failed";

/** 进行中 = 还会动索引状态的两个状态。 */
export const VECTORIZE_ACTIVE_STATUSES = ["queued", "running"] as const;

/**
 * 摄取任务的 payload。
 *
 * `commitId` 缺省 = **执行时**解析该仓库主版本的 head commit。
 * 为什么不在提交时就定死：触发与执行之间可能又有新导入（head 前移），
 * 执行时再解析才能保证「索引的永远是当前活跃版本」；而定死会索引一个已经开始
 * 过期的 commit，还得靠下一轮补。代价是要接受「同一 (repo, commit) 可能被索引
 * 两次」，这正是 P4-6 的 content_hash 复用要解决的问题（第二轮不花 embedding）。
 */
export interface VectorizeTaskPayload {
  trigger: VectorizeTaskTrigger;
  commitId?: string;
  /** 只重索引部分接口（identity_key）；不传 = 全量对账 */
  endpoints?: string[];
  /** 忽略 content_hash 复用，强制重算 */
  force?: boolean;
}

/** 摄取任务的 result（= `IndexReport` + 实际索引的 commit）。 */
export interface VectorizeTaskResult {
  commitId?: string;
  chunksWritten?: number;
  chunksSkipped?: number;
  chunksDeleted?: number;
  tokens?: number;
  costUsd?: number;
  durationMs?: number;
}

export interface VectorizeTaskSummary {
  taskId: string;
  status: VectorizeTaskStatus;
  progress: number;
  trigger: VectorizeTaskTrigger;
  /** 本任务索引的 commit（执行后回填；提交时是提交那一刻的 head） */
  commitId: string | null;
  chunksWritten: number;
  chunksSkipped: number;
  chunksDeleted: number;
  tokens: number;
  costUsd: number | null;
  durationMs: number | null;
  result: unknown;
  error: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}

/** 用于去重判断的最小行形状（避免把 DB 列名泄漏进纯决策层）。 */
export interface VectorizeTaskCandidate {
  taskId: string;
  status: string;
  /** 该任务的目标 commit（`repository_tasks.version_id` 列存的其实是 commit） */
  commitId: string | null;
}

export function isVectorizeTaskActive(status: string): boolean {
  return (VECTORIZE_ACTIVE_STATUSES as readonly string[]).includes(status);
}

/**
 * 同一 `(repo, commit)` 是否已有进行中的任务 → 有就**复用**（返回它）。
 *
 * 为什么复用而不是像 context 任务那样抛 `Duplicate`：摄取是**自动触发**的，且三个
 * 触发点会重叠（导入成功之后紧接着上下文保存完成）。抛错会让第二个触发点把业务
 * 流程打断，而这三个触发点表达的是同一件事——「这个 commit 的内容该进索引了」。
 * 幂等在这里不是优化，是正确性要求。
 */
export function findReusableVectorizeTask<T extends VectorizeTaskCandidate>(
  candidates: readonly T[],
  commitId: string,
): T | undefined {
  return candidates.find(
    (candidate) => candidate.commitId === commitId && isVectorizeTaskActive(candidate.status),
  );
}

/** DB 行 → 对外摘要（缺省值集中在一处，避免各调用点各写一遍 `?? 0`）。 */
export function toVectorizeSummary(row: {
  id: string;
  status: string;
  progress: number;
  payload: unknown;
  result: unknown;
  error: string | null;
  versionId: string | null;
  createdAt: Date;
  finishedAt: Date | null;
}): VectorizeTaskSummary {
  const payload = (row.payload ?? {}) as Partial<VectorizeTaskPayload>;
  const result = (row.result ?? {}) as VectorizeTaskResult;

  return {
    taskId: row.id,
    status: row.status as VectorizeTaskStatus,
    progress: row.progress,
    trigger: payload.trigger ?? "manual",
    commitId: result.commitId ?? payload.commitId ?? row.versionId ?? null,
    chunksWritten: result.chunksWritten ?? 0,
    chunksSkipped: result.chunksSkipped ?? 0,
    chunksDeleted: result.chunksDeleted ?? 0,
    tokens: result.tokens ?? 0,
    costUsd: result.costUsd ?? null,
    durationMs: result.durationMs ?? null,
    result: row.result,
    error: row.error,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}
