// ═══════════════════════════════════════════════════════════════════
// RAG Contracts — Public API（`@apigent/rag/contracts`）
// ═══════════════════════════════════════════════════════════════════
//
// 零重依赖：这个 subpath 可以被客户端组件引用（工具清单、字段枚举），
// 不会把 db / pg / native 模块带进浏览器包。
// ═══════════════════════════════════════════════════════════════════

export { CHUNK_LEVELS, CHUNK_LANGS } from "./types";
export type {
  ChunkLevel,
  ChunkLang,
  RagScope,
  RetrievalMode,
  RetrievalStrategy,
  RetrievalFilters,
  RetrieveRequest,
  ChunkHighlight,
  ExpandedContext,
  RetrievedChunk,
  DegradationReason,
  Degradation,
  TokenUsage,
  RagTraceSummary,
  RetrieveResult,
  IndexRequest,
  IndexReport,
  RagDocumentFields,
  RagDocument,
  RagDocumentSource,
  RagHealthStatus,
  RagHealth,
  RagService,
} from "./types";
export { RagError, RagConfigError, RagIngestError, RagDependencyError } from "./errors";
export type { RagErrorCode } from "./errors";
export type {
  EmbeddingIdentity,
  EmbedResult,
  Embedder,
  DenseChunkRecord,
  DenseQuery,
  DenseHit,
  DenseUnlinkSelector,
  DenseIndex,
} from "./stages";
export { RAG_SPAN_NAMES, RAG_METRIC_NAMES } from "./telemetry";
export type {
  RagSpanName,
  RagMetricName,
  RagAttributeValue,
  RagSpanAttributes,
  RagSpan,
  RagTelemetry,
  RagLoggerPort,
} from "./telemetry";
