// ═══════════════════════════════════════════════════════════════════
// AI Transport — provider 选型 → OpenAI 兼容传输参数
// ═══════════════════════════════════════════════════════════════════
//
// 「调用模型服务的能力」的唯一实现点。把 apigent.config.yaml 里的 provider
// 选型翻译成 AI SDK 的 OpenAI 兼容 provider 实例。
//
// 分层约定（P0-1 定案，docs/modules/rag-package.md §9 A1）：
//   - 本模块只做「传输层」，不含任何 RAG / embedding / rerank 语义；
//   - embedding 模型工厂与 rerank 客户端是 RAG 专属，放 @apigent/rag；
//   - 纯函数，不读全局配置 —— 配置对象由调用方传入，便于测试与注入。
// ═══════════════════════════════════════════════════════════════════

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LLMConfig } from "../config";

/** DashScope 的 OpenAI 兼容端点 */
export const DASHSCOPE_COMPATIBLE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

/** OpenAI 官方端点 */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** OpenAI 兼容传输参数 —— 与 AI SDK provider 的构造参数一一对应 */
export interface OpenAICompatibleTransport {
  /** provider 名称；AI SDK 用它标记调用来源，也是遥测里的 provider 字段 */
  name: string;
  baseURL: string;
  /** ollama 等本地 provider 无需密钥 */
  apiKey?: string;
}

/**
 * 把 LLM 配置翻译成 OpenAI 兼容传输参数。
 *
 * 只覆盖已接入的 provider（qwen / openai / ollama）；claude / gemini 尚未接入，
 * 按 fail-fast 约定直接抛错，不静默回退到别的 provider。
 */
export function resolveLLMTransport(llm: LLMConfig): OpenAICompatibleTransport {
  switch (llm.provider) {
    case "openai":
      return { name: "openai", baseURL: OPENAI_BASE_URL, apiKey: llm.apiKey };
    case "qwen":
      return {
        name: "qwen",
        baseURL: llm.baseUrl ?? DASHSCOPE_COMPATIBLE_BASE_URL,
        apiKey: llm.apiKey,
      };
    case "ollama":
      return { name: "ollama", baseURL: llm.baseUrl };
    case "claude":
    case "gemini":
      throw new Error(`LLM provider '${llm.provider}' is not supported by the agent runtime yet.`);
  }
}

/**
 * 由传输参数创建 AI SDK 的 OpenAI 兼容 provider。
 *
 * 这是给 RAG 侧复用的入口：rag 构造 embedding / rerank 客户端时调用本函数，
 * 但**选项由 server 注入**，rag 自己不读全局配置。
 */
export function createOpenAICompatibleProvider(transport: OpenAICompatibleTransport) {
  return createOpenAICompatible(transport);
}
