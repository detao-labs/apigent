import { describe, it, expect } from "vitest";
import type { z } from "zod";
import type { ApigentConfig, RetrievalMode, SearchStoreConfig } from "./types";
import {
  ApigentConfigSchema,
  AppsConfigSchema,
  DatabaseConfigSchema,
  EmbeddingConfigSchema,
  LLMConfigSchema,
  RAGConfigSchema,
  RAGRetrievalConfigSchema,
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
        provider: "builtin",
        chunkStrategy: "hierarchical",
        embedding: { provider: "qwen", apiKey: "sk-test", model: "text-embedding-v4" },
        vectorStore: { provider: "pgvector" },
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
    expect(SearchStoreConfigSchema.safeParse({ provider: "pg-fts-jieba" }).success).toBe(true);
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

// ───────────────────────────────────────────────────────────────────
// P3-3 — `rag.searchStore` 的四个内置取值，以及「稀疏路关掉」的语义
// ───────────────────────────────────────────────────────────────────
//
// 验收①：非法值 fail-fast（**包括已退役的旧值 `pg-fts`** —— 它不做别名，见
// schema.ts 的注释）。
//
// 验收②：选 `none` 时管线走 dense-only 且**不报错** —— 这里是它在配置层能被钉住的
// 部分：`none` 本身合法，`hybrid` + `none` 合法（退化为 dense-only），只有
// `sparse-only` + `none` 这种「保证空结果」的组合在启动期被拒。

describe("SearchStoreConfig — P0-3 variants (P3-3)", () => {
  const builtInProviders = ["pg-fts-jieba", "pg-fts-bigram", "pg-fts-simple", "none"] as const;

  for (const provider of builtInProviders) {
    it(`accepts the built-in provider "${provider}"`, () => {
      expect(SearchStoreConfigSchema.safeParse({ provider }).success).toBe(true);
    });
  }

  it("rejects the retired `pg-fts` value instead of aliasing it", () => {
    // 别名会让「这条索引是哪套分词产出的」不可判定，而 tokenizer_version 正是
    // 靠它决定要不要 REINDEX。
    expect(SearchStoreConfigSchema.safeParse({ provider: "pg-fts" }).success).toBe(false);
  });

  it("rejects an unknown variant", () => {
    expect(SearchStoreConfigSchema.safeParse({ provider: "pg-fts-icu" }).success).toBe(false);
  });
});

describe("RAGConfigSchema — sparse availability vs retrievalMode (P3-3)", () => {
  /** 除「稀疏后端 + 检索模式」外的字段用一份最小的合法配置填满。 */
  function ragConfig(provider: SearchStoreConfig["provider"], retrievalMode: RetrievalMode) {
    return {
      provider: "builtin",
      chunkStrategy: "hierarchical",
      embedding: { provider: "qwen", apiKey: "sk-test", model: "text-embedding-v4" },
      vectorStore: { provider: "pgvector" },
      searchStore: { provider },
      queryRewrite: true,
      queryRewriteCacheTtl: 3600,
      retrieval: {
        retrievalMode,
        fusionMethod: "rrf",
        coarseRankTopK: 20,
        fineRankTopK: 10,
        reranker: { provider: "qwen", apiKey: "sk-test", model: "qwen3-rerank" },
      },
      knowledgeGraph: { enabled: false },
    };
  }

  it("accepts dense-only retrieval with the sparse store disabled", () => {
    expect(RAGConfigSchema.safeParse(ragConfig("none", "dense-only")).success).toBe(true);
  });

  it("accepts hybrid retrieval with the sparse store disabled (degrades to dense-only)", () => {
    // 这是验收②的配置层形态：显式关掉稀疏路**不是**启动错误，只是没有稀疏召回。
    expect(RAGConfigSchema.safeParse(ragConfig("none", "hybrid")).success).toBe(true);
  });

  it("rejects sparse-only retrieval with the sparse store disabled", () => {
    const result = RAGConfigSchema.safeParse(ragConfig("none", "sparse-only"));

    expect(result.success).toBe(false);
    const message = result.success ? "" : JSON.stringify(result.error.issues);
    expect(message).toContain("sparse-only");
    expect(message).toContain("pg-fts-jieba");
  });

  it("keeps sparse-only retrieval valid as long as a sparse store is configured", () => {
    // 这条把上一条钉成「窄规则」：被拒的是组合，不是 sparse-only 本身。
    expect(RAGConfigSchema.safeParse(ragConfig("pg-fts-jieba", "sparse-only")).success).toBe(true);
    expect(RAGConfigSchema.safeParse(ragConfig("pg-fts-bigram", "sparse-only")).success).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────
// P3-5 — `rag.embedding.provider: claude` 已删除
// ───────────────────────────────────────────────────────────────────
//
// Anthropic 不提供 embedding API。删掉而不是「保留 + 标注」的理由：留着占位会让
// 用户以为自己选了一个可行的方案，而失败点在**运行期**（第一次索引才炸），
// 删掉则失败点在**配置校验期**，且错误信息直接列出可用取值。

describe("EmbeddingConfigSchema — claude removed (P3-5)", () => {
  it("rejects the claude embedding provider", () => {
    const result = EmbeddingConfigSchema.safeParse({
      provider: "claude",
      apiKey: "sk-test",
      model: "claude-embed",
    });

    expect(result.success).toBe(false);
  });

  it("lists the remaining embedding providers in the error, so the fix is obvious", () => {
    const result = EmbeddingConfigSchema.safeParse({ provider: "claude", apiKey: "x", model: "y" });
    const message = result.success ? "" : JSON.stringify(result.error.issues);

    for (const provider of ["qwen", "openai", "cohere", "local-bge", "local-fastembed"]) {
      expect(message).toContain(provider);
    }
    expect(message).not.toContain("'claude'");
  });

  it("keeps claude available for the LLM (the removal is embedding-only)", () => {
    // 这条防止误伤：Anthropic 有 chat 模型，`llm.provider: claude` 仍然合法
    // （未接入是另一回事，由 createLanguageModel 抛可读错误）。
    const result = LLMConfigSchema.safeParse({
      provider: "claude",
      apiKey: "sk-test",
      models: {
        default: "claude-sonnet-5",
        business_context: "claude-sonnet-5",
        query_rewrite: "claude-haiku-4-5-20251001",
        rag_answer: "claude-sonnet-5",
        editing: "claude-sonnet-5",
      },
    });

    expect(result.success).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────
// P3-6 — `rag.vectorStore.indexType` 已删除
// ───────────────────────────────────────────────────────────────────
//
// ANN 索引是 DDL 期决策（迁移建 HNSW），不是运行时开关：换算法要重建索引、重灌
// 数据，改 YAML + 重启不可能生效。旧字段没有任何代码读取，默认值还与迁移不一致
// —— 「写了不生效」比「没有这个槽位」更糟，所以删除并让它成为**未知键**（校验期
// 直接报错），而不是留着一个被忽略的键。

describe("VectorStoreConfigSchema — indexType removed (P3-6)", () => {
  it("accepts pgvector without any index option", () => {
    expect(VectorStoreConfigSchema.safeParse({ provider: "pgvector" }).success).toBe(true);
  });

  it("rejects the removed indexType key instead of silently ignoring it", () => {
    const result = VectorStoreConfigSchema.safeParse({
      provider: "pgvector",
      indexType: "ivfflat",
    });

    expect(result.success).toBe(false);
    const message = result.success ? "" : JSON.stringify(result.error.issues);
    expect(message).toContain("indexType");
  });
});

// ───────────────────────────────────────────────────────────────────
// P3-7 — L0 整体替换：`rag.provider`
// ───────────────────────────────────────────────────────────────────
//
// 形态（P0-6 定案 B）：`provider` 是 `rag` 节点自己的键，`package` / `options` 与它
// **同级**，且只存在于 `provider: package` 分支里。这一段把「显式判别换来了什么」
// 钉死：内置分支里写 `package` 会报错，直接写包名（形态 A）也不接受。

describe("RAGConfigSchema — L0 provider (P3-7)", () => {
  /** 除 L0 判别键之外的合法 rag 配置。 */
  const baseRag = {
    chunkStrategy: "hierarchical",
    embedding: { provider: "qwen", apiKey: "sk-test", model: "text-embedding-v4" },
    vectorStore: { provider: "pgvector" },
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
  };

  it("defaults to the built-in pipeline when provider is builtin", () => {
    expect(RAGConfigSchema.safeParse({ provider: "builtin", ...baseRag }).success).toBe(true);
  });

  it("accepts a package with options", () => {
    const result = RAGConfigSchema.safeParse({
      provider: "package",
      package: "@acme/apigent-rag-qdrant",
      options: { endpoint: "https://rag.example.test", collection: "apigent" },
      ...baseRag,
    });

    expect(result.success).toBe(true);
  });

  it("accepts a package without options", () => {
    const result = RAGConfigSchema.safeParse({
      provider: "package",
      package: "rag-impl",
      ...baseRag,
    });

    expect(result.success).toBe(true);
  });

  it("rejects provider: package without a package name", () => {
    expect(RAGConfigSchema.safeParse({ provider: "package", ...baseRag }).success).toBe(false);
  });

  it("rejects a file path as the L0 package", () => {
    const result = RAGConfigSchema.safeParse({
      provider: "package",
      package: "./my-rag-service.ts",
      ...baseRag,
    });

    expect(result.success).toBe(false);
    const message = result.success ? "" : JSON.stringify(result.error.issues);
    expect(message).toContain("npm package name");
  });

  it("rejects package/options keys on the builtin branch (that is what strict buys)", () => {
    expect(
      RAGConfigSchema.safeParse({ provider: "builtin", package: "@acme/rag", ...baseRag }).success,
    ).toBe(false);
  });

  it("rejects writing the package name directly as the provider value", () => {
    // 形态 A（`provider: "@acme/x"`）在 P0-6 被否掉：它会让 provider 退化成 string。
    // 这里把取舍钉住 —— 想要绝对路径式的「只改一行」，请接受多写 package 键。
    expect(RAGConfigSchema.safeParse({ provider: "@acme/rag", ...baseRag }).success).toBe(false);
  });

  it("rejects an unknown provider value", () => {
    expect(RAGConfigSchema.safeParse({ provider: "custom", ...baseRag }).success).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────
// P4-4 — `rag.retrieval.minScore`（稠密路的最低相似度）
// ───────────────────────────────────────────────────────────────────
//
// 语义：不写 = 不设阈值（关闭）；写了就是查询内的 SQL 条件（不是后置过滤）。
// 这里只钉配置层：可选、范围合法、越界要报错（写 2 会让查询永远空，那是配置错误）。

describe("RAGRetrievalConfigSchema — minScore (P4-4)", () => {
  const base = {
    retrievalMode: "hybrid",
    fusionMethod: "rrf",
    coarseRankTopK: 20,
    fineRankTopK: 10,
    reranker: { provider: "none" },
  };

  it("accepts a config without minScore (default = threshold off)", () => {
    expect(RAGRetrievalConfigSchema.safeParse(base).success).toBe(true);
  });

  it("accepts a cosine similarity in -1..1", () => {
    expect(RAGRetrievalConfigSchema.safeParse({ ...base, minScore: 0.45 }).success).toBe(true);
    expect(RAGRetrievalConfigSchema.safeParse({ ...base, minScore: -0.2 }).success).toBe(true);
    expect(RAGRetrievalConfigSchema.safeParse({ ...base, minScore: 1 }).success).toBe(true);
  });

  it("rejects out-of-range values instead of silently returning an empty result set", () => {
    expect(RAGRetrievalConfigSchema.safeParse({ ...base, minScore: 2 }).success).toBe(false);
    expect(RAGRetrievalConfigSchema.safeParse({ ...base, minScore: -1.5 }).success).toBe(false);
  });

  it("rejects a non-number", () => {
    expect(RAGRetrievalConfigSchema.safeParse({ ...base, minScore: "0.5" }).success).toBe(false);
  });
});
