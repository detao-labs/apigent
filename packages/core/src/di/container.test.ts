import { describe, it, expect } from "vitest";
import type { ApigentConfig } from "../config";
import type { QueueProvider, StorageProvider, VectorStore } from "../types";
import { Container } from "./container";
import { MemoryVectorStore } from "./providers/memory-vector-store";
import { LocalStorageProvider } from "./providers/local-storage";
import { MemoryQueueProvider } from "./providers/memory-queue";

// ── 注册 API 用的最小假实现 ─────────────────────────────────────────

class FakeVectorStore implements VectorStore {
  async search() {
    return [];
  }
  async insert() {}
  async delete() {}
  async count() {
    return 0;
  }
}

class FakeStorage implements StorageProvider {
  async save() {}
  async read() {
    return Buffer.alloc(0);
  }
  async delete() {}
  async exists() {
    return false;
  }
  async list() {
    return [];
  }
}

class FakeQueue implements QueueProvider {
  async enqueue() {
    return "job";
  }
  async process() {}
  async shutdown() {}
}

function makeConfig(overrides: Partial<ApigentConfig> = {}): ApigentConfig {
  const base: ApigentConfig = {
    database: { provider: "postgresql", url: "postgresql://localhost:5432/apigent" },
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
    rag: {
      provider: "builtin",
      chunkStrategy: "hierarchical",
      embedding: { provider: "qwen", apiKey: "sk-test", model: "text-embedding-v4" },
      vectorStore: { provider: "memory" },
      searchStore: { provider: "pg-fts-jieba" },
      queryRewrite: true,
      queryRewriteCacheTtl: 3600,
      retrieval: {
        retrievalMode: "hybrid",
        fusionMethod: "rrf",
        coarseRankTopK: 20,
        fineRankTopK: 10,
        reranker: { provider: "qwen", apiKey: "sk-test", model: "qwen3-rerank" },
      },
      knowledgeGraph: { enabled: false },
    },
    storage: { provider: "local", basePath: "./data/uploads" },
    queue: { provider: "memory" },
    businessContext: {
      autoGenerate: false,
      batchSize: 5,
      concurrency: 2,
      minConfidence: 0.6,
      language: "auto",
      skipHumanEdited: true,
    },
    auth: { secret: "s", providers: ["credentials"], sessionMaxAge: 604800 },
    mcp: { path: "/mcp", transport: "streamable-http" },
    observability: { provider: "none", logLevel: "info" },
    apps: {
      platform: { logLevel: "info" },
      admin: { logLevel: "info" },
      open: { logLevel: "info" },
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
    const config = makeConfig();
    config.rag.vectorStore = { provider: "pgvector" };
    const container = new Container(config);
    expect(() => container.getVectorStore()).toThrow(/not implemented/);
  });

  describe("provider registration", () => {
    it("resolves a vector store registered under a new name", () => {
      const config = makeConfig();
      config.rag.vectorStore = { provider: "pgvector" };
      const container = new Container(config);
      const fake = new FakeVectorStore();
      container.registerVectorStoreFactory("pgvector", () => fake);
      expect(container.getVectorStore()).toBe(fake);
    });

    it("lets a package add an implementation for a config enum value without touching core", () => {
      // 这是 P1-2 的核心目标：qdrant 在配置类型里有取值、但 core 没有内置实现，
      // 拥有实现的包只需注册一行即可启用。
      //
      // 注：P0-6 定案还要求 provider 字段能直接写 npm 包名。那需要同时放宽
      // 配置类型并加启动期自检（否则写错 provider 名会从「配置校验期报错」退成
      // 「运行期报错」），属于后续任务，不在 Phase 1 的行为中性范围内。
      const config = makeConfig();
      config.rag.vectorStore = { provider: "qdrant", url: "http://q", collection: "c" };
      const container = new Container(config);
      const fake = new FakeVectorStore();
      container.registerVectorStoreFactory("qdrant", () => fake);
      expect(container.getVectorStore()).toBe(fake);
    });

    it("lets a later registration override a built-in name", () => {
      const container = new Container(makeConfig());
      expect(container.getVectorStore()).toBeInstanceOf(MemoryVectorStore);

      const fresh = new Container(makeConfig());
      const fake = new FakeVectorStore();
      fresh.registerVectorStoreFactory("memory", () => fake);
      expect(fresh.getVectorStore()).toBe(fake);
    });

    it("resolves a storage factory registered under a new name", () => {
      const config = makeConfig();
      config.storage = {
        provider: "s3",
        bucket: "b",
        region: "r",
        accessKeyId: "k",
        secretAccessKey: "s",
      };
      const container = new Container(config);
      const fake = new FakeStorage();
      container.registerStorageFactory("s3", () => fake);
      expect(container.getStorage()).toBe(fake);
    });

    it("resolves a queue factory registered under a new name", () => {
      const config = makeConfig({
        queue: { provider: "bullmq", redisUrl: "redis://localhost:6379" },
      });
      const container = new Container(config);
      const fake = new FakeQueue();
      container.registerQueueFactory("bullmq", () => fake);
      expect(container.getQueue()).toBe(fake);
    });

    it("still fails fast when a name is never registered", () => {
      const container = new Container(makeConfig());
      expect(() => container.getVectorStore()).not.toThrow(); // memory 内置

      const config = makeConfig();
      config.rag.vectorStore = { provider: "qdrant", url: "http://q", collection: "c" };
      expect(() => new Container(config).getVectorStore()).toThrow(/not implemented/);
    });
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

    const bullmq = new Container(
      makeConfig({ queue: { provider: "bullmq", redisUrl: "redis://localhost:6379" } }),
    );
    expect(() => bullmq.getQueue()).toThrow(/not implemented/);
  });
});
