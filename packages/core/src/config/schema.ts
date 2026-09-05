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
      indexType: z.enum(["ivfflat", "hnsw"]),
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
      provider: z.literal("claude"),
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
]);

export const SearchStoreConfigSchema = z
  .object({
    provider: z.literal("pg-fts"),
  })
  .strict();

export const RAGRetrievalConfigSchema = z
  .object({
    retrievalMode: z.enum(["hybrid", "dense-only", "sparse-only", "kg-only"]),
    fusionMethod: z.enum(["rrf", "linear"]),
    coarseRankTopK: z.number().int(),
    fineRankTopK: z.number().int(),
    reranker: RerankerConfigSchema,
  })
  .strict();

export const RAGConfigSchema = z
  .object({
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
  })
  .strict();

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
// 10. Apps — application endpoints
// ───────────────────────────────────────────────────────────────────

export const AppEndpointConfigSchema = z
  .object({
    url: z.string(),
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
    apps: AppsConfigSchema,
  })
  .strict();

export type ApigentConfigInput = z.input<typeof ApigentConfigSchema>;
