import { describe, it, expect } from "vitest";
import type { EmbeddingModel } from "ai";
import { RagDependencyError } from "../contracts";
import {
  EMBEDDING_DIMENSIONS,
  openAICompatibleEmbedder,
  qwenEmbedder,
} from "./openai-compatible-embedder";

// ───────────────────────────────────────────────────────────────────
// 假 embedding 模型（AI SDK 的 EmbeddingModelV4 形状）
// ───────────────────────────────────────────────────────────────────

interface FakeModelOptions {
  dim?: number;
  /** 每次调用报告的 token 数 */
  tokensPerCall?: number;
  /** 每次调用前的延迟（测并发） */
  delayMs?: number;
  /** 返回指定批次索引时报错 */
  failOnCall?: number;
  /** 故意少返回一条向量（测错位防御） */
  dropOne?: boolean;
  onCall?: (values: string[], providerOptions: unknown) => void;
}

function fakeEmbeddingModel(options: FakeModelOptions = {}) {
  const dim = options.dim ?? EMBEDDING_DIMENSIONS;
  const calls: string[][] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  const model: EmbeddingModel = {
    specificationVersion: "v4",
    provider: "fake",
    modelId: "fake-embed",
    maxEmbeddingsPerCall: undefined,
    supportsParallelCalls: true,
    async doEmbed({ values, providerOptions }) {
      const callIndex = calls.length;
      calls.push(values);
      options.onCall?.(values, providerOptions);

      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
        if (options.failOnCall === callIndex) throw new Error("provider exploded");

        // 每条文本一个可辨认的向量：第 0 位 = 文本索引，便于断言顺序。
        const embeddings = values.map((text) => {
          const vector = new Array<number>(dim).fill(0);
          vector[0] = Number(text.replace("t", ""));
          return vector;
        });
        if (options.dropOne) embeddings.pop();

        return {
          embeddings,
          usage: { tokens: options.tokensPerCall ?? 1 },
          warnings: [],
        };
      } finally {
        inFlight -= 1;
      }
    },
  };

  return {
    model,
    calls,
    get maxInFlight() {
      return maxInFlight;
    },
  };
}

const texts = (count: number): string[] => Array.from({ length: count }, (_, i) => `t${i}`);

// ───────────────────────────────────────────────────────────────────
// 批次 / 并发（验收项）
// ───────────────────────────────────────────────────────────────────

describe("openAICompatibleEmbedder — 批次控制", () => {
  it("按 maxBatchSize 切批，且每批条数不超过上限", async () => {
    const fake = fakeEmbeddingModel();
    const embedder = openAICompatibleEmbedder({
      model: fake.model,
      modelIdentity: "fake:embed",
      maxBatchSize: 10,
      concurrency: 1,
    });

    await embedder.embed(texts(25));

    expect(fake.calls.map((batch) => batch.length)).toEqual([10, 10, 5]);
  });

  it("并发批次数不超过 concurrency", async () => {
    const fake = fakeEmbeddingModel({ delayMs: 5 });
    const embedder = openAICompatibleEmbedder({
      model: fake.model,
      modelIdentity: "fake:embed",
      maxBatchSize: 1,
      concurrency: 2,
    });

    await embedder.embed(texts(6));

    expect(fake.calls).toHaveLength(6);
    expect(fake.maxInFlight).toBe(2);
  });

  it("并发只影响执行顺序，不影响返回顺序（向量与文本一一对应）", async () => {
    const fake = fakeEmbeddingModel({ delayMs: 3 });
    const embedder = openAICompatibleEmbedder({
      model: fake.model,
      modelIdentity: "fake:embed",
      maxBatchSize: 3,
      concurrency: 3,
    });

    const result = await embedder.embed(texts(9));

    expect(result.vectors.map((vector) => vector[0])).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("空输入不发请求", async () => {
    const fake = fakeEmbeddingModel();
    const embedder = openAICompatibleEmbedder({ model: fake.model, modelIdentity: "fake:embed" });

    expect(await embedder.embed([])).toEqual({ vectors: [], tokens: 0 });
    expect(fake.calls).toHaveLength(0);
  });

  it("聚合各批的 token 用量", async () => {
    const fake = fakeEmbeddingModel({ tokensPerCall: 7 });
    const embedder = openAICompatibleEmbedder({
      model: fake.model,
      modelIdentity: "fake:embed",
      maxBatchSize: 10,
    });

    const result = await embedder.embed(texts(25));

    expect(result.tokens).toBe(21); // 3 批 × 7
  });

  it("身份串与维度来自配置（落进 knowledge_chunks.embedding_model / embedding_dim）", () => {
    const embedder = openAICompatibleEmbedder({
      model: fakeEmbeddingModel().model,
      modelIdentity: "qwen:text-embedding-v4",
      dimensions: 1024,
    });

    expect(embedder.identity).toEqual({ model: "qwen:text-embedding-v4", dim: 1024 });
  });

  it("传递 provider 选项命名空间（dimensions 靠它生效）", async () => {
    let seen: unknown;
    const fake = fakeEmbeddingModel({
      onCall: (_values, providerOptions) => (seen = providerOptions),
    });
    const embedder = openAICompatibleEmbedder({
      model: fake.model,
      modelIdentity: "fake:embed",
      providerOptionsName: "qwen",
      dimensions: 1024,
    });

    await embedder.embed(["t0"]);

    expect(seen).toEqual({ qwen: { dimensions: 1024 } });
  });
});

// ───────────────────────────────────────────────────────────────────
// 失败语义（验收项：明确报错，绝不静默）
// ───────────────────────────────────────────────────────────────────

describe("openAICompatibleEmbedder — 失败要带上下文", () => {
  it("provider 报错 → RagDependencyError，含模型 / 批次 / 本批条数", async () => {
    const fake = fakeEmbeddingModel({ failOnCall: 1 });
    const embedder = openAICompatibleEmbedder({
      model: fake.model,
      modelIdentity: "qwen:text-embedding-v4",
      maxBatchSize: 5,
      concurrency: 1,
      maxRetries: 0,
    });

    const error = await embedder.embed(texts(12)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RagDependencyError);
    const message = (error as Error).message;
    expect(message).toContain("qwen:text-embedding-v4");
    expect(message).toContain("batch 2/3");
    expect(message).toContain("5 texts");
    expect(message).toContain("provider exploded");
  });

  it("向量数与文本数不一致 → 明确拒绝（错位会静默污染索引）", async () => {
    const fake = fakeEmbeddingModel({ dropOne: true });
    const embedder = openAICompatibleEmbedder({
      model: fake.model,
      modelIdentity: "fake:embed",
      maxBatchSize: 3,
      concurrency: 1,
    });

    await expect(embedder.embed(texts(3))).rejects.toThrow(/refusing to continue/);
  });

  it("维度不符 → 明确拒绝（P0-2 固定 1024，不能静默混维度）", async () => {
    const fake = fakeEmbeddingModel({ dim: 768 });
    const embedder = openAICompatibleEmbedder({
      model: fake.model,
      modelIdentity: "fake:embed",
      dimensions: 1024,
    });

    await expect(embedder.embed(["t0"])).rejects.toThrow(/768-dimensional.*expected 1024/s);
  });

  it("批次大小 / 并发数非法 → 构造期就报错", () => {
    const model = fakeEmbeddingModel().model;

    expect(() => openAICompatibleEmbedder({ model, modelIdentity: "x", maxBatchSize: 0 })).toThrow(
      RagDependencyError,
    );
    expect(() => openAICompatibleEmbedder({ model, modelIdentity: "x", concurrency: 0 })).toThrow(
      RagDependencyError,
    );
  });
});

// ───────────────────────────────────────────────────────────────────
// qwen 工厂
// ───────────────────────────────────────────────────────────────────

describe("qwenEmbedder", () => {
  it("默认身份是 qwen:text-embedding-v4 + 1024 维（与 P0-2 对齐）", () => {
    const embedder = qwenEmbedder({ apiKey: "sk-test" });

    expect(embedder.identity).toEqual({
      model: "qwen:text-embedding-v4",
      dim: EMBEDDING_DIMENSIONS,
    });
  });

  it("可以换模型名（身份随之变化，落库后据此判断是否需要重索引）", () => {
    const embedder = qwenEmbedder({ apiKey: "sk-test", model: "text-embedding-v3" });

    expect(embedder.identity.model).toBe("qwen:text-embedding-v3");
  });
});
