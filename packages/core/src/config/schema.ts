// ═══════════════════════════════════════════════════════════════════
// Apigent Config — Runtime Validation Schema
// ═══════════════════════════════════════════════════════════════════
//
// Zod schemas mirroring the discriminated unions in types.ts.
// `loadConfig()` runs the fully-merged config through
// `ApigentConfigSchema` before caching it, so wrong-typed YAML values
// and invalid provider names fail fast with a readable error instead of
// silently producing a broken config.
//
// The schema is intentionally `.strict()` — unknown keys are almost
// always typos and should be rejected rather than silently dropped.
//
// A compile-time assertion in schema.test.ts keeps this file in sync
// with the hand-written TypeScript types.
// ═══════════════════════════════════════════════════════════════════

import { z } from "zod";
import { NPM_PACKAGE_NAME_HINT, NPM_PACKAGE_NAME_PATTERN } from "./provider-package";

// ───────────────────────────────────────────────────────────────────
// 0. 第三方 provider（npm 包）
// ───────────────────────────────────────────────────────────────────
//
// 形态是显式判别 `{ provider: package, package: "@acme/x", options: {...} }`：
// 判别字段保持字面量，所以各 union 的**收窄与 `.strict()` 都不受影响**；只有
// `options` 是「包自己的配置」，宿主无法校验它需要哪些键（见 types.ts 的说明）。
//
// `package` 只接受 npm 包名、**不接受文件路径** —— 配置常被复制转发，路径会让它
// 变成任意代码执行入口（P0-6）。
export const ExternalProviderConfigSchema = z
  .object({
    provider: z.literal("package"),
    package: z.string().regex(NPM_PACKAGE_NAME_PATTERN, NPM_PACKAGE_NAME_HINT),
    options: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// ───────────────────────────────────────────────────────────────────
// 1. Database
// ───────────────────────────────────────────────────────────────────

export const DatabaseConfigSchema = z
  .object({
    provider: z.literal("postgresql"),
    url: z.string(),
  })
  .strict();

// ───────────────────────────────────────────────────────────────────
// 2. Vector Store
// ───────────────────────────────────────────────────────────────────

export const VectorStoreConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("memory"),
    })
    .strict(),
  z
    .object({
      provider: z.literal("pgvector"),
    })
    .strict(),
  z
    .object({
      provider: z.literal("milvus"),
      host: z.string(),
      port: z.number().int(),
      collection: z.string(),
      user: z.string().optional(),
      password: z.string().optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("qdrant"),
      url: z.string(),
      collection: z.string(),
      apiKey: z.string().optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("weaviate"),
      url: z.string(),
      apiKey: z.string().optional(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("pinecone"),
      apiKey: z.string(),
      environment: z.string(),
      index: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("chroma"),
      url: z.string(),
      collection: z.string(),
    })
    .strict(),
  ExternalProviderConfigSchema,
]);

// ───────────────────────────────────────────────────────────────────
// 3. LLM Provider
// ───────────────────────────────────────────────────────────────────

export const LLMFlowModelMapSchema = z
  .object({
    default: z.string(),
    business_context: z.string(),
    query_rewrite: z.string(),
    rag_answer: z.string(),
    editing: z.string(),
  })
  .strict();

export const LLMConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("claude"),
      apiKey: z.string(),
      models: LLMFlowModelMapSchema,
    })
    .strict(),
  z
    .object({
      provider: z.literal("openai"),
      apiKey: z.string(),
      models: LLMFlowModelMapSchema,
    })
    .strict(),
  z
    .object({
      provider: z.literal("gemini"),
      apiKey: z.string(),
      models: LLMFlowModelMapSchema,
    })
    .strict(),
  z
    .object({
      provider: z.literal("ollama"),
      baseUrl: z.string(),
      models: LLMFlowModelMapSchema,
    })
    .strict(),
  z
    .object({
      provider: z.literal("qwen"),
      apiKey: z.string(),
      baseUrl: z.string().optional(),
      models: LLMFlowModelMapSchema,
    })
    .strict(),
]);

// ───────────────────────────────────────────────────────────────────
// 4. Embedding Provider
// ───────────────────────────────────────────────────────────────────

export const EmbeddingConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("qwen"),
      apiKey: z.string(),
      model: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("openai"),
      apiKey: z.string(),
      model: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("cohere"),
      apiKey: z.string(),
      model: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("local-bge"),
      model: z.string(),
      device: z.enum(["cpu", "cuda"]),
    })
    .strict(),
  z
    .object({
      provider: z.literal("local-fastembed"),
      model: z.string(),
      device: z.enum(["cpu", "cuda"]),
    })
    .strict(),
  ExternalProviderConfigSchema,
]);

// ───────────────────────────────────────────────────────────────────
// 5. RAG Pipeline
// ───────────────────────────────────────────────────────────────────

export const RerankerConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("bge-reranker"),
      model: z.string(),
      device: z.enum(["cpu", "cuda"]),
    })
    .strict(),
  z
    .object({
      provider: z.literal("cohere"),
      apiKey: z.string(),
      model: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("qwen"),
      apiKey: z.string(),
      model: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("none"),
    })
    .strict(),
  ExternalProviderConfigSchema,
]);

// P0-3 定案 A3：三个内置取值共用同一条 pg-fts 路径，只差应用侧分词口径；
// `none` 关闭稀疏路（管线 dense-only）。旧值 `pg-fts` 已退役，**不做别名** ——
// 别名会让「这条索引是哪套分词产出的」变得不可判定，而 `tokenizer_version`
// 正是靠它判定要不要 REINDEX。
export const SearchStoreConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("pg-fts-jieba"),
    })
    .strict(),
  z
    .object({
      provider: z.literal("pg-fts-bigram"),
    })
    .strict(),
  z
    .object({
      provider: z.literal("pg-fts-simple"),
    })
    .strict(),
  z
    .object({
      provider: z.literal("none"),
    })
    .strict(),
  ExternalProviderConfigSchema,
]);

export const RAGRetrievalConfigSchema = z
  .object({
    retrievalMode: z.enum(["hybrid", "dense-only", "sparse-only", "kg-only"]),
    fusionMethod: z.enum(["rrf", "linear"]),
    coarseRankTopK: z.number().int(),
    fineRankTopK: z.number().int(),
    reranker: RerankerConfigSchema,
  })
  .strict();

/**
 * `rag.*` 的公共字段 —— L0 的两个分支都带这一整套（与 types.ts 的 `RAGConfigBase` 对应）。
 *
 * 抽成对象再 spread，是为了让「L0 判别」与「rag 的字段」分开：判别键是 `provider`，
 * 而 `package` / `options` 只出现在 package 分支里（`.strict()` 因此仍然有效）。
 */
const ragConfigBaseFields = {
  chunkStrategy: z.enum(["hierarchical", "fixed"]),
  embedding: EmbeddingConfigSchema,
  vectorStore: VectorStoreConfigSchema,
  searchStore: SearchStoreConfigSchema,
  queryRewrite: z.boolean(),
  queryRewriteCacheTtl: z.number().int(),
  retrieval: RAGRetrievalConfigSchema,
  knowledgeGraph: z
    .object({
      enabled: z.boolean(),
    })
    .strict(),
};

// L0 —— `rag.provider`：内置管线（缺省）或整条替换成一个 npm 包。
// `package` 分支复用 `ExternalProviderConfigSchema` 的**形状**（而不是重写一遍包名
// 规则）：包名正则与提示文案只有一处实现，zod 与加载器不会各判各的。
export const RAGConfigSchema = z
  .discriminatedUnion("provider", [
    z
      .object({
        provider: z.literal("builtin"),
        ...ragConfigBaseFields,
      })
      .strict(),
    z
      .object({
        ...ExternalProviderConfigSchema.shape,
        ...ragConfigBaseFields,
      })
      .strict(),
  ])
  // 跨字段校验（P3-3）：稀疏路关掉之后，仍然**要求**稀疏结果才能出结果的模式是
  // 无法满足的配置 —— 那样检索会返回空集且不报错，属于最难查的一类故障。
  // 反过来 `hybrid` + `none` 是**允许**的：它退化为 dense-only，这是用户显式选择
  // 的降级，不是错误（P3-3 验收②）。
  .superRefine((config, ctx) => {
    if (config.retrieval.retrievalMode !== "sparse-only") return;
    if (config.searchStore.provider !== "none") return;
    ctx.addIssue({
      code: "custom",
      path: ["retrieval", "retrievalMode"],
      message:
        'retrievalMode "sparse-only" needs a sparse store, but searchStore.provider is "none", ' +
        'so every query would return an empty result set. Use "pg-fts-jieba" ' +
        '(or "pg-fts-bigram" / "pg-fts-simple"), or set retrievalMode to "dense-only".',
    });
  });

// ───────────────────────────────────────────────────────────────────
// 6. Storage Provider
// ───────────────────────────────────────────────────────────────────

export const StorageConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("local"),
      basePath: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.enum(["s3", "minio"]),
      bucket: z.string(),
      region: z.string(),
      endpoint: z.string().optional(),
      accessKeyId: z.string(),
      secretAccessKey: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("gcs"),
      bucket: z.string(),
      projectId: z.string(),
    })
    .strict(),
]);

// ───────────────────────────────────────────────────────────────────
// 7. Queue Provider
// ───────────────────────────────────────────────────────────────────

export const QueueConfigSchema = z.discriminatedUnion("provider", [
  z
    .object({
      provider: z.literal("postgres"),
    })
    .strict(),
  z
    .object({
      provider: z.literal("bullmq"),
      redisUrl: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("rabbitmq"),
      url: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("sqs"),
      region: z.string(),
      queuePrefix: z.string(),
    })
    .strict(),
  z
    .object({
      provider: z.literal("memory"),
    })
    .strict(),
]);

// ───────────────────────────────────────────────────────────────────
// 8. Auth
// ───────────────────────────────────────────────────────────────────

export const AuthConfigSchema = z
  .object({
    secret: z.string(),
    adminSecret: z.string().optional(),
    providers: z.array(z.enum(["credentials", "github", "google"])),
    sessionMaxAge: z.number().int(),
    github: z
      .object({
        clientId: z.string(),
        clientSecret: z.string(),
      })
      .strict()
      .optional(),
    google: z
      .object({
        clientId: z.string(),
        clientSecret: z.string(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ───────────────────────────────────────────────────────────────────
// 9. MCP Gateway
// ───────────────────────────────────────────────────────────────────

export const MCPConfigSchema = z
  .object({
    path: z.string(),
    transport: z.literal("streamable-http"),
    publicUrl: z.string().optional(),
  })
  .strict();

// ───────────────────────────────────────────────────────────────────
// 9.5 Observability
// ───────────────────────────────────────────────────────────────────

export const ObservabilityConfigSchema = z
  .object({
    provider: z.enum(["none", "otlp", "langfuse", "phoenix"]),
    logLevel: z.enum(["debug", "info", "warn", "error"]),
    otlp: z
      .object({
        endpoint: z.string(),
        headers: z.record(z.string(), z.string()).optional(),
      })
      .strict()
      .optional(),
    langfuse: z
      .object({
        baseUrl: z.string().optional(),
      })
      .strict()
      .optional(),
    phoenix: z
      .object({
        endpoint: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ───────────────────────────────────────────────────────────────────
// 10. Apps — application endpoints
// ───────────────────────────────────────────────────────────────────

export const AppEndpointConfigSchema = z
  .object({
    logLevel: z.enum(["debug", "info", "warn", "error"]),
  })
  .strict();

export const AppsConfigSchema = z
  .object({
    platform: AppEndpointConfigSchema,
    admin: AppEndpointConfigSchema,
    open: AppEndpointConfigSchema,
  })
  .strict();

// ───────────────────────────────────────────────────────────────────
// 12.5 Business Context
// ───────────────────────────────────────────────────────────────────

export const BusinessContextConfigSchema = z
  .object({
    autoGenerate: z.boolean().default(false),
    batchSize: z.number().int().min(1).max(50).default(5),
    concurrency: z.number().int().min(1).max(10).default(2),
    minConfidence: z.number().min(0).max(1).default(0.6),
    language: z.enum(["auto", "zh", "en"]).default("auto"),
    skipHumanEdited: z.boolean().default(true),
  })
  .strict()
  .default({
    autoGenerate: false,
    batchSize: 5,
    concurrency: 2,
    minConfidence: 0.6,
    language: "auto",
    skipHumanEdited: true,
  });

// ───────────────────────────────────────────────────────────────────
// 12. Top-level Apigent Config
// ───────────────────────────────────────────────────────────────────

export const ApigentConfigSchema = z
  .object({
    database: DatabaseConfigSchema,
    llm: LLMConfigSchema,
    rag: RAGConfigSchema,
    storage: StorageConfigSchema,
    queue: QueueConfigSchema,
    businessContext: BusinessContextConfigSchema,
    auth: AuthConfigSchema,
    mcp: MCPConfigSchema,
    observability: ObservabilityConfigSchema,
    apps: AppsConfigSchema,
  })
  .strict();

export type ApigentConfigInput = z.input<typeof ApigentConfigSchema>;
