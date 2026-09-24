// ═══════════════════════════════════════════════════════════════════
// Stages — Public API（`@apigent/rag/stages`）
// ═══════════════════════════════════════════════════════════════════
//
// 各阶段的**内置默认实现**。与 `@apigent/rag/testing` 的区别：这里是生产实现，
// 只是还没接上管线（Phase 2 只验证契约）。
//
// 本 barrel 保持「import 即轻量」：jieba 的词典与原生模块是**惰性加载**的
// （见 jieba-tokenizer.ts 文件头），所以只想要 `normalizeIdentifiers` 的调用方
// 不会被迫付词典加载成本。
// ═══════════════════════════════════════════════════════════════════

export { normalizeIdentifiers } from "./identifiers";
export { jiebaTokenizer, JIEBA_LIB_VERSION_FALLBACK } from "./jieba-tokenizer";
export type { JiebaDictionary, JiebaTokenizerOptions } from "./jieba-tokenizer";
export {
  chunkerForStrategy,
  fixedChunker,
  hierarchicalChunker,
  DEFAULT_MAX_CHARS,
} from "./chunker";
export type { ChunkStrategyName } from "./chunker";
