import { describe, it, expect } from "vitest";
import type { z } from "zod";
import type { ApigentConfig } from "./types";
import {
  ApigentConfigSchema,
  AppsConfigSchema,
  DatabaseConfigSchema,
  QueueConfigSchema,
} from "./schema";

/**
 * Compile-time assertion: the zod schema must infer the exact same shape
 * as the hand-written ApigentConfig. If types.ts and schema.ts drift,
 * this file stops compiling.
 */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;

const _schemaMatchesTypes: Equal<ApigentConfig, z.infer<typeof ApigentConfigSchema>> = true;
void _schemaMatchesTypes;

describe("ApigentConfigSchema", () => {
  it("accepts a valid fully-resolved config", () => {
    const config: ApigentConfig = {
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
        chunkStrategy: "hierarchical",
        embedding: { provider: "qwen", apiKey: "sk-test", model: "text-embedding-v4" },
        vectorStore: { provider: "pgvector", indexType: "hnsw" },
        searchStore: { provider: "pg-fts" },
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
      apps: {
        platform: { url: "http://localhost:3000", logLevel: "info" },
        admin: { url: "http://localhost:3001", logLevel: "info" },
        open: { url: "http://localhost:3002", logLevel: "info" },
      },
    };

    expect(ApigentConfigSchema.safeParse(config).success).toBe(true);
  });

  it("rejects wrong-typed values (apps.logLevel as string)", () => {
    const result = AppsConfigSchema.safeParse({
      platform: { url: "http://localhost:3000", logLevel: "info" },
      admin: { url: "http://localhost:3001", logLevel: "verbose" },
      open: { url: "http://localhost:3002", logLevel: "info" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown provider names", () => {
    const result = DatabaseConfigSchema.safeParse({
      provider: "oracle",
      url: "oracle://localhost:1521",
    });
    expect(result.success).toBe(false);
  });

  it("accepts the postgres queue provider (V0 default)", () => {
    expect(QueueConfigSchema.safeParse({ provider: "postgres" }).success).toBe(true);
  });

  it("rejects unknown keys (typos)", () => {
    const result = AppsConfigSchema.safeParse({
      platform: { url: "http://localhost:3000", logLevel: "info", hst: "typo" },
      admin: { url: "http://localhost:3001", logLevel: "info" },
      open: { url: "http://localhost:3002", logLevel: "info" },
    });
    expect(result.success).toBe(false);
  });
});
