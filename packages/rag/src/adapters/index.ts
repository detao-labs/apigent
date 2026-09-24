// ═══════════════════════════════════════════════════════════════════
// Adapters — Public API（`@apigent/rag/adapters`）
// ═══════════════════════════════════════════════════════════════════
//
// 各阶段的**生产实现**（依赖注入的端口，不直接连数据库）。与 `/stages` 的分工：
// `/stages` 是纯计算阶段（分词、归一化），不碰外部资源；`/adapters` 需要宿主演入
// 资源（`SqlExecutor`、HTTP 客户端…），因此在 `package.json` 里单独开一个 subpath ——
// 客户端代码永远不该 import 它。
// ═══════════════════════════════════════════════════════════════════

export { pgDocumentSource, pgDocumentSourceProvider } from "./pg-document-source";
export type { PgDocumentSourceOptions } from "./pg-document-source";

export {
  openAICompatibleEmbedder,
  qwenEmbedder,
  EMBEDDING_DIMENSIONS,
} from "./openai-compatible-embedder";
export type {
  OpenAICompatibleEmbedderOptions,
  QwenEmbedderOptions,
} from "./openai-compatible-embedder";

export { pgvectorIndex, pgvectorIndexProvider, PGVECTOR_DIMENSIONS } from "./pgvector-index";
export type { PgvectorIndexOptions } from "./pgvector-index";

// 渲染规则对外可见是有意的：它们是「API 知识 → 检索文本」的权威定义，评测（Phase 7）
// 与未来替换 document source 的包需要能直接复用/对照这一段。
export {
  detectLang,
  renderEndpointText,
  renderProjectText,
  renderRequestSchemaText,
  renderResponseSchemaText,
  renderRulesText,
  renderTagText,
  collectSchemaRefs,
} from "./document-text";
export type { PgContextRow, PgDefinitionRow, PgEndpointRow, PgResponseRow } from "./document-text";
