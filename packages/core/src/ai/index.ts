// ═══════════════════════════════════════════════════════════════════
// AI — Public API（`@apigent/core/ai`）
// ═══════════════════════════════════════════════════════════════════
//
// 本 subpath 是「调用模型服务的能力」的入口，**有意不进 core 根 barrel**：
// 根 barrel（config / types / di）会被客户端组件引用，而 `ai` 依赖
// AI SDK，不能被打进浏览器包。
//
// 只放通用能力（语言模型 + 传输层）；embedding / rerank 属于 RAG 专属，
// 见 P0-1 定案与 docs/modules/rag-package.md §9 A1。
// ═══════════════════════════════════════════════════════════════════

export { createLanguageModel } from "./model";
export {
  createOpenAICompatibleProvider,
  resolveLLMTransport,
  DASHSCOPE_COMPATIBLE_BASE_URL,
  OPENAI_BASE_URL,
} from "./transport";
export type { OpenAICompatibleTransport } from "./transport";
