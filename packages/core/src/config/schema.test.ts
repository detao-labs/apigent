import { describe, it, expect } from "vitest";
import type { z } from "zod";
import type { ApigentConfig } from "./types";
import {
  ApigentConfigSchema,
  AppsConfigSchema,
  DatabaseConfigSchema,
  EmbeddingConfigSchema,
  RerankerConfigSchema,
  SearchStoreConfigSchema,
  VectorStoreConfigSchema,
  QueueConfigSchema,
} from "./schema";

/**
 * Compile-time assertion: the zod schema must infer the exact same shape
 * as the hand-written ApigentConfig. If types.ts and schema.ts drift,
 * this file stops compiling.
 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

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
      observability: { provider: "none", logLevel: "info" },
      apps: {
        platform: { logLevel: "info" },
        admin: { logLevel: "info" },
        open: { logLevel: "info" },
      },
    };

    expect(ApigentConfigSchema.safeParse(config).success).toBe(true);
  });

  it("rejects wrong-typed values (apps.logLevel as string)", () => {
    const result = AppsConfigSchema.safeParse({
      platform: { logLevel: "info" },
      admin: { logLevel: "verbose" },
      open: { logLevel: "info" },
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
      platform: { logLevel: "info", hst: "typo" },
      admin: { logLevel: "info" },
      open: { logLevel: "info" },
    });
    expect(result.success).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────
// 第三方 provider（npm 包）—— P0-6 定案 B
// ───────────────────────────────────────────────────────────────────
//
// 形态：`{ provider: package, package: "@acme/x", options: {...} }`。
// 这里逐条钉住「显式判别换来了什么」：判别字段仍是字面量，所以 `.strict()`
// 与各内置分支的类型收窄都保留；而 `package` 只接受包名、**不接受路径**。

describe("ExternalProviderConfig (third-party providers)", () => {
  const packageProviders = [
    { name: "vectorStore", schema: VectorStoreConfigSchema },
    { name: "embedding", schema: EmbeddingConfigSchema },
    { name: "searchStore", schema: SearchStoreConfigSchema },
    { name: "reranker", schema: RerankerConfigSchema },
  ] as const;

  for (const { name, schema } of packageProviders) {
    it(`accepts a scoped package with options (${name})`, () => {
      const result = schema.safeParse({
        provider: "package",
        package: "@acme/apigent-rag-impl",
        options: { endpoint: "https://example.test", retries: 3 },
      });

      expect(result.success).toBe(true);
    });

    it(`accepts a package without options (${name})`, () => {
      expect(schema.safeParse({ provider: "package", package: "rag-impl" }).success).toBe(true);
    });

    it(`rejects a file path as package (${name})`, () => {
      for (const path of ["./local.ts", "../shared/impl", "/abs/impl.js", "file:/tmp/x"]) {
        const result = schema.safeParse({ provider: "package", package: path });
        expect(result.success, `should reject path ${path}`).toBe(false);
      }
    });

    it(`requires the package field (${name})`, () => {
      expect(schema.safeParse({ provider: "package" }).success).toBe(false);
    });

    it(`still rejects typos at the node level (${name})`, () => {
      // 这正是选显式判别而不是「provider 直接写包名」的理由：节点仍是 .strict()，
      // 拼错 options 会被配置校验期抓住，而不是等到运行期。
      const result = schema.safeParse({
        provider: "package",
        package: "@acme/impl",
        optiosn: { endpoint: "x" },
      });

      expect(result.success).toBe(false);
    });
  }

  it("keeps the built-in branches intact", () => {
    expect(VectorStoreConfigSchema.safeParse({ provider: "memory" }).success).toBe(true);
    expect(SearchStoreConfigSchema.safeParse({ provider: "pg-fts" }).success).toBe(true);
    expect(RerankerConfigSchema.safeParse({ provider: "none" }).success).toBe(true);
  });

  it("surfaces the package-name hint when a path is used", () => {
    const result = EmbeddingConfigSchema.safeParse({
      provider: "package",
      package: "./my-embedder.ts",
    });

    expect(result.success).toBe(false);
    const message = result.success ? "" : JSON.stringify(result.error.issues);
    expect(message).toContain("npm package name");
    expect(message).toContain("file paths are not accepted");
  });
});
