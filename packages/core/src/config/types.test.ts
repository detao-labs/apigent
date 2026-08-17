import { describe, it, expect } from "vitest";
import type { AppsConfig, DatabaseConfig, LLMConfig, EmbeddingConfig, RAGConfig } from "./types";

describe("Config Types", () => {
  it("DatabaseConfig — should accept postgresql provider", () => {
    const db: DatabaseConfig = {
      provider: "postgresql",
      url: "postgresql://localhost:5432/apigent_dev",
    };
    expect(db.provider).toBe("postgresql");
    expect(db.url).toBe("postgresql://localhost:5432/apigent_dev");
  });

  it("LLMConfig — discriminated union should allow Claude provider", () => {
    const llm: LLMConfig = {
      provider: "claude",
      apiKey: "sk-ant-test-key",
      models: {
        default: "claude-sonnet-5",
        business_context: "claude-sonnet-5",
        query_rewrite: "claude-haiku-4-5-20251001",
        rag_answer: "claude-sonnet-5",
        editing: "claude-sonnet-5",
      },
    };
    expect(llm.provider).toBe("claude");
    expect(llm.models.default).toBe("claude-sonnet-5");
  });

  it("EmbeddingConfig — discriminated union should allow Qwen provider", () => {
    const emb: EmbeddingConfig = {
      provider: "qwen",
      apiKey: "sk-test-key",
      model: "text-embedding-v4",
    };
    expect(emb.provider).toBe("qwen");
    expect(emb.model).toBe("text-embedding-v4");
  });

  it("RAGConfig — should accept hybrid retrieval with reranker", () => {
    const rag: RAGConfig = {
      chunkStrategy: "hierarchical",
      embedding: { provider: "qwen", apiKey: "sk-test-key", model: "text-embedding-v4" },
      vectorStore: { provider: "pgvector", indexType: "ivfflat" },
      searchStore: { provider: "pg-fts" },
      queryRewrite: true,
      queryRewriteCacheTtl: 3600,
      retrieval: {
        retrievalMode: "hybrid",
        fusionMethod: "rrf",
        coarseRankTopK: 20,
        fineRankTopK: 10,
        reranker: { provider: "qwen", apiKey: "sk-test-key", model: "qwen3-rerank" },
      },
      knowledgeGraph: { enabled: false },
    };
    expect(rag.retrieval.retrievalMode).toBe("hybrid");
    expect(rag.retrieval.reranker.provider).toBe("qwen");
  });

  it("AppsConfig — should expose the three app endpoints", () => {
    const apps: AppsConfig = {
      platform: { url: "http://localhost:3000", logLevel: "info" },
      admin: { url: "http://localhost:3001", logLevel: "info" },
      open: { url: "http://localhost:3002", logLevel: "info" },
    };
    expect(apps.open.url).toBe("http://localhost:3002");
    expect(apps.platform.logLevel).toBe("info");
  });
});
