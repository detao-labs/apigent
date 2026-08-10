import { describe, it, expect } from "vitest";
import type { DatabaseConfig, LLMConfig, EmbeddingConfig, RAGConfig, ServerConfig } from "./types";

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
      retrievalMode: "hybrid",
      fusionMethod: "rrf",
      coarseRankTopK: 20,
      reranker: {
        provider: "qwen",
        apiKey: "sk-test-key",
        model: "qwen3-rerank",
      },
      fineRankTopK: 10,
      chunkStrategy: "hierarchical",
      queryRewrite: true,
      queryRewriteCacheTtl: 3600,
      knowledgeGraph: { enabled: false },
    };
    expect(rag.retrievalMode).toBe("hybrid");
    expect(rag.reranker.provider).toBe("qwen");
  });

  it("ServerConfig — should accept development environment", () => {
    const server: ServerConfig = {
      host: "0.0.0.0",
      port: 3002,
      nodeEnv: "development",
      logLevel: "info",
    };
    expect(server.port).toBe(3002);
    expect(server.nodeEnv).toBe("development");
  });
});
