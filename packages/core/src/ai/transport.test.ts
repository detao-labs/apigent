import { describe, it, expect } from "vitest";
import type { LLMConfig, LLMFlowModelMap } from "../config";
import {
  createOpenAICompatibleProvider,
  resolveLLMTransport,
  DASHSCOPE_COMPATIBLE_BASE_URL,
  OPENAI_BASE_URL,
} from "./transport";

const MODELS: LLMFlowModelMap = {
  default: "m-default",
  business_context: "m-context",
  query_rewrite: "m-rewrite",
  rag_answer: "m-answer",
  editing: "m-editing",
};

describe("resolveLLMTransport", () => {
  it("maps qwen to the DashScope compatible endpoint by default", () => {
    const llm: LLMConfig = { provider: "qwen", apiKey: "sk-q", models: MODELS };
    expect(resolveLLMTransport(llm)).toEqual({
      name: "qwen",
      baseURL: DASHSCOPE_COMPATIBLE_BASE_URL,
      apiKey: "sk-q",
    });
  });

  it("honours an explicit qwen baseUrl", () => {
    const llm: LLMConfig = {
      provider: "qwen",
      apiKey: "sk-q",
      baseUrl: "https://proxy.internal/v1",
      models: MODELS,
    };
    expect(resolveLLMTransport(llm).baseURL).toBe("https://proxy.internal/v1");
  });

  it("maps openai to the official endpoint", () => {
    const llm: LLMConfig = { provider: "openai", apiKey: "sk-o", models: MODELS };
    expect(resolveLLMTransport(llm)).toEqual({
      name: "openai",
      baseURL: OPENAI_BASE_URL,
      apiKey: "sk-o",
    });
  });

  it("maps ollama without an api key", () => {
    const llm: LLMConfig = {
      provider: "ollama",
      baseUrl: "http://localhost:11434/v1",
      models: MODELS,
    };
    const transport = resolveLLMTransport(llm);
    expect(transport.name).toBe("ollama");
    expect(transport.baseURL).toBe("http://localhost:11434/v1");
    expect(transport.apiKey).toBeUndefined();
  });

  it.each(["claude", "gemini"] as const)("fails fast for %s", (provider) => {
    const llm = { provider, apiKey: "sk-x", models: MODELS } as LLMConfig;
    expect(() => resolveLLMTransport(llm)).toThrow(
      `LLM provider '${provider}' is not supported by the agent runtime yet.`,
    );
  });
});

describe("createOpenAICompatibleProvider", () => {
  it("builds a chat model carrying the requested model id", () => {
    const provider = createOpenAICompatibleProvider({
      name: "qwen",
      baseURL: DASHSCOPE_COMPATIBLE_BASE_URL,
      apiKey: "sk-q",
    });
    const model = provider.chatModel("qwen3.7-plus") as { modelId: string };
    expect(model.modelId).toBe("qwen3.7-plus");
  });
});
