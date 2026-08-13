import { describe, it, expect } from "vitest";
import type { ApigentConfig } from "../config";
import { Container } from "./container";
import { MemoryVectorStore } from "./providers/memory-vector-store";
import { LocalStorageProvider } from "./providers/local-storage";
import { MemoryQueueProvider } from "./providers/memory-queue";

function makeConfig(overrides: Partial<ApigentConfig> = {}): ApigentConfig {
  const base: ApigentConfig = {
    database: { provider: "postgresql", url: "postgresql://localhost:5432/apigent" },
    vectorStore: { provider: "memory" },
    llm: {
      provider: "qwen",
      apiKey: "sk-test",
      models: {
        default: "qwen3.7-plus",
        business_context: "qwen3.7-plus",
        query_rewrite: "qwen3.7-flash",
        rag_answer: "qwen3.7-plus",
        editing: "qwen3.7-plus",
      },
    },
    embedding: { provider: "qwen", apiKey: "sk-test", model: "text-embedding-v4" },
    rag: {
      retrievalMode: "hybrid",
      fusionMethod: "rrf",
      coarseRankTopK: 20,
      reranker: { provider: "qwen", apiKey: "sk-test", model: "qwen3-rerank" },
      fineRankTopK: 10,
      chunkStrategy: "hierarchical",
      queryRewrite: true,
      queryRewriteCacheTtl: 3600,
      knowledgeGraph: { enabled: false },
    },
    storage: { provider: "local", basePath: "./data/uploads" },
    queue: { provider: "memory" },
    auth: { secret: "s", providers: ["credentials"], sessionMaxAge: 604800 },
    mcp: { path: "/mcp", transport: "streamable-http" },
    server: { host: "0.0.0.0", port: 3002, nodeEnv: "development", logLevel: "info" },
    webapp: {
      platformUrl: "http://localhost:3000",
      adminUrl: "http://localhost:3001",
      apiUrl: "http://localhost:3002",
    },
    businessContext: {
      autoGenerate: false,
      batchSize: 5,
      concurrency: 2,
      minConfidence: 0.6,
      language: "auto",
      skipHumanEdited: true,
    },
  };
  return { ...base, ...overrides };
}

describe("Container", () => {
  it("resolves the memory vector store and caches the instance", () => {
    const container = new Container(makeConfig());
    const vs = container.getVectorStore();
    expect(vs).toBeInstanceOf(MemoryVectorStore);
    expect(container.getVectorStore()).toBe(vs);
  });

  it("fails fast for vector store providers without an implementation", () => {
    const container = new Container(makeConfig({ vectorStore: { provider: "pgvector", indexType: "hnsw" } }));
    expect(() => container.getVectorStore()).toThrow(/not implemented/);
  });

  it("fails fast for LLM providers without an implementation", () => {
    const container = new Container(makeConfig());
    expect(() => container.getLLM()).toThrow(/not implemented/);
  });

  it("fails fast for embedding providers without an implementation", () => {
    const container = new Container(makeConfig());
    expect(() => container.getEmbedding()).toThrow(/not implemented/);
  });

  it("resolves the local storage provider", () => {
    const container = new Container(makeConfig());
    expect(container.getStorage()).toBeInstanceOf(LocalStorageProvider);
  });

  it("fails fast for cloud storage providers without an implementation", () => {
    const container = new Container(
      makeConfig({
        storage: {
          provider: "s3",
          bucket: "b",
          region: "us-east-1",
          accessKeyId: "k",
          secretAccessKey: "s",
        },
      }),
    );
    expect(() => container.getStorage()).toThrow(/not implemented/);
  });

  it("resolves the memory queue and fails fast for BullMQ", () => {
    const memory = new Container(makeConfig());
    expect(memory.getQueue()).toBeInstanceOf(MemoryQueueProvider);

    const bullmq = new Container(makeConfig({ queue: { provider: "bullmq", redisUrl: "redis://localhost:6379" } }));
    expect(() => bullmq.getQueue()).toThrow(/not implemented/);
  });
});
