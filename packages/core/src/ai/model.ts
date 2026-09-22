// ═══════════════════════════════════════════════════════════════════
// AI Model — 配置 → AI SDK LanguageModel（服务端共享）
// ═══════════════════════════════════════════════════════════════════
//
// 把 apigent.config.yaml 的 llm 配置（provider + per-flow models）适配为
// AI SDK 的 LanguageModel 实例。Worker（批量生成）与 API route（agent
// 运行时）共用。
//
// 这是「调用模型服务的能力」；embedding 模型工厂与 rerank 客户端属于
// RAG 专属能力，放在 @apigent/rag（见 P0-1 定案）。
//
// 完整设计见 docs/modules/agent-runtime.md 与 docs/modules/rag-package.md。
// ═══════════════════════════════════════════════════════════════════

import type { LanguageModel } from "ai";
import { loadConfig } from "../config";
import type { LLMFlow } from "../config";
import { createOpenAICompatibleProvider, resolveLLMTransport } from "./transport";

/**
 * 按 flow 创建语言模型实例。
 *
 * 模型 ID 取自 `llm.models[flow]`，缺失时回退 `llm.models.default`。
 * provider 未接入（claude / gemini）时由 {@link resolveLLMTransport} 抛错。
 */
export function createLanguageModel(flow: LLMFlow = "default"): LanguageModel {
  const llm = loadConfig().llm;
  const modelId = llm.models[flow] ?? llm.models.default;
  return createOpenAICompatibleProvider(resolveLLMTransport(llm)).chatModel(modelId);
}
