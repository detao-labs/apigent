// ═══════════════════════════════════════════════════════════════════
// Testing — Public API（`@apigent/rag/testing`）
// ═══════════════════════════════════════════════════════════════════
//
// 确定性替身：无网络、无 API key、无数据库即可跑完整检索链路。
//
// **只应出现在测试与离线评测里** —— 因此它不进 `@apigent/rag` 顶层 barrel：
// 顶层是生产消费入口，把测试替身挂在上面会诱导产品代码 import 它。
// ═══════════════════════════════════════════════════════════════════

export { hashEmbedder, hashEmbedderTokens } from "./hash-embedder";
export type { HashEmbedderOptions } from "./hash-embedder";
export { memoryIndex } from "./memory-index";
export { RecordingTelemetry } from "./recording-telemetry";
export type {
  RecordedSpan,
  RecordedMetric,
  RecordedDegradation,
  RecordingTelemetryOptions,
} from "./recording-telemetry";
export {
  fixtureDocumentSource,
  FIXTURE_DOCUMENTS,
  FIXTURE_ORG_MAIN,
  FIXTURE_ORG_OTHER,
  FIXTURE_REPO_CHECKOUT,
  FIXTURE_REPO_BILLING,
  FIXTURE_REPO_LEGACY,
} from "./fixture-document-source";
export type { FixtureDocumentSourceOptions } from "./fixture-document-source";
