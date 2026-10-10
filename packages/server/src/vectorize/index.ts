// ═══════════════════════════════════════════════════════════════════
// RAG Vectorize — Public API（`@apigent/server/vectorize`）
// ═══════════════════════════════════════════════════════════════════

export {
  createVectorizeTask,
  getLatestVectorizeTask,
  getVectorizeTask,
  retryVectorizeTask,
  triggerVectorize,
} from "./service";
export type { VectorizeTaskScope } from "./service";
export { executeVectorizeTask } from "./executor";
export { startVectorizeWorker, stopVectorizeWorker } from "./worker";
export {
  clearVectorizeRunner,
  getVectorizeRunner,
  hasVectorizeRunner,
  setVectorizeRunner,
} from "./runner";
export type { VectorizeRunner } from "./runner";
export { VECTORIZE_QUEUE, VectorizeTaskError } from "./common";
export type { VectorizeTaskErrorCode } from "./common";
export {
  findReusableVectorizeTask,
  isVectorizeTaskActive,
  toVectorizeSummary,
  VECTORIZE_ACTIVE_STATUSES,
} from "./plan";
export type {
  VectorizeTaskCandidate,
  VectorizeTaskPayload,
  VectorizeTaskResult,
  VectorizeTaskStatus,
  VectorizeTaskSummary,
  VectorizeTaskTrigger,
} from "./plan";
