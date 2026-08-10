import { describe, it, expect } from "vitest";
import type { z } from "zod";
import type { ApigentConfig } from "./types";
import {
  ApigentConfigSchema,
  DatabaseConfigSchema,
  ServerConfigSchema,
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
      vectorStore: { provider: "pgvector", indexType: "hnsw" },
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
    };

    expect(ApigentConfigSchema.safeParse(config).success).toBe(true);
  });

  it("rejects wrong-typed values (server.port as string)", () => {
    const result = ServerConfigSchema.safeParse({
      host: "0.0.0.0",
      port: "3002",
      nodeEnv: "development",
      logLevel: "info",
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

  it("rejects unknown keys (typos)", () => {
    const result = ServerConfigSchema.safeParse({
      host: "0.0.0.0",
      port: 3002,
      nodeEnv: "development",
      logLevel: "info",
      hst: "typo",
    });
    expect(result.success).toBe(false);
  });
});
