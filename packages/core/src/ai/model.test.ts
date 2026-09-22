import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { _buildConfigFromDefaults, resetConfig, setConfig } from "../config/loader";
import type { LLMFlowModelMap } from "../config";
import { createLanguageModel } from "./model";

// 单测里直接给配置单例喂一份构造好的配置，避免依赖仓库根的 .env。
const MODELS: LLMFlowModelMap = {
  default: "m-default",
  business_context: "m-context",
  query_rewrite: "m-rewrite",
  rag_answer: "m-answer",
  editing: "m-editing",
};

function primeConfig(overrides: Partial<ReturnType<typeof _buildConfigFromDefaults>> = {}) {
  const config = _buildConfigFromDefaults();
  config.llm = { provider: "qwen", apiKey: "sk-test", models: MODELS };
  setConfig({ ...config, ...overrides });
}

describe("createLanguageModel", () => {
  beforeEach(() => {
    resetConfig();
  });

  afterEach(() => {
    resetConfig();
  });

  it("picks the model id bound to the requested flow", () => {
    primeConfig();
    const model = createLanguageModel("business_context") as { modelId: string };
    expect(model.modelId).toBe("m-context");
  });

  it("defaults to the `default` flow when none is given", () => {
    primeConfig();
    const model = createLanguageModel() as { modelId: string };
    expect(model.modelId).toBe("m-default");
  });

  it("fails fast for providers the runtime has not wired yet", () => {
    const config = _buildConfigFromDefaults();
    config.llm = { provider: "claude", apiKey: "sk-test", models: MODELS };
    setConfig(config);
    expect(() => createLanguageModel()).toThrow(/claude.*not supported/);
  });
});
