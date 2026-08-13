// ═══════════════════════════════════════════════════════════════════
// AI Model Adapter — config → AI SDK model（服务端共享）
// ═══════════════════════════════════════════════════════════════════
//
// 把 apigent.config.yaml 的 llm 配置（provider + per-flow models）适配为
// AI SDK 的 LanguageModel 实例。Worker（批量生成）与 API route（agent
// 运行时）共用此适配。
// 完整设计见 docs/modules/agent-runtime.md。
// ═══════════════════════════════════════════════════════════════════

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { loadConfig } from "@apigent/core/config";
import type { LLMFlow } from "@apigent/core/config";
import type { LanguageModel } from "ai";

/** DashScope 的 OpenAI 兼容端点 */
const DASHSCOPE_COMPATIBLE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

/**
 * 根据 llm 配置创建模型实例。
 *
 * V0 支持 openai / qwen（DashScope OpenAI 兼容端点）/ ollama（本地）；
 * claude / gemini 未接入，按 fail-fast 约定直接抛错。
 */
export function createAIModel(flow: LLMFlow = "default"): LanguageModel {
  const llm = loadConfig().llm;
  const modelId = llm.models[flow] ?? llm.models.default;

  switch (llm.provider) {
    case "openai":
      return createOpenAICompatible({
        name: "openai",
        baseURL: "https://api.openai.com/v1",
        apiKey: llm.apiKey,
      }).chatModel(modelId);
    case "qwen":
      return createOpenAICompatible({
        name: "qwen",
        baseURL: llm.baseUrl ?? DASHSCOPE_COMPATIBLE_BASE_URL,
        apiKey: llm.apiKey,
      }).chatModel(modelId);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: llm.baseUrl,
      }).chatModel(modelId);
    case "claude":
    case "gemini":
      throw new Error(
        `LLM provider '${llm.provider}' is not supported by the agent runtime yet.`,
      );
  }
}
