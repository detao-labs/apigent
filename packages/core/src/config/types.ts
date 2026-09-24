// ═══════════════════════════════════════════════════════════════════
// Apigent Config — Type Definitions
// ═══════════════════════════════════════════════════════════════════
//
// All scheme choices ("which provider to use") are represented as
// discriminated unions. They can be set via:
//   - apigent.config.yaml (recommended — structured, supports comments)
//   - environment variables (APIGENT_*_PROVIDER)
//   - apigent.config.ts (programmatic, for advanced use)
//
// Secrets (API keys, passwords, connection strings) MUST come from
// process.env / .env — never hardcode them.
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// 1. Database
// ───────────────────────────────────────────────────────────────────

/**
 * V0 supports PostgreSQL only — the Drizzle schema (packages/server/src/db)
 * is built on `drizzle-orm/pg-core`. Other dialects are not implemented.
 */
export type DBProvider = "postgresql";

export interface DatabaseConfig {
  provider: DBProvider;
  /** Connection URL (from env — contains credentials) */
  url: string;
}

// ───────────────────────────────────────────────────────────────────
// 2. Vector Store
// ───────────────────────────────────────────────────────────────────

export type VectorStoreProvider =
  "pgvector" | "milvus" | "qdrant" | "weaviate" | "pinecone" | "chroma" | "memory";

export type VectorStoreIndexType = "ivfflat" | "hnsw";

/**
 * 第三方 provider —— 实现由 npm 包提供（P0-6 定案）。
 *
 * **为什么是显式判别**（`provider: "package"` + `package` 字段），而不是让
 * `provider` 直接写包名：判别的字面量一旦变成 `string`，下面这些 union 的
 * **类型收窄会失效**（`provider === "qwen"` 不再能排除第三方分支，凭据字段退化成
 * `unknown`），而且配置节点的 `.strict()` 只能放弃 —— 那等于把「配置写错」从
 * 启动期推到运行期，正是 P1-2 记过的行为退化。显式判别的代价只是用户多写一个键。
 *
 * `options` 是**该包自己的配置**：宿主只校验 `package` 是合法包名，锁不住它需要
 * 哪些键（这是第三方 provider 的固有代价，由包自己校验）。
 */
export interface ExternalProviderConfig {
  provider: "package";
  /** npm 包名；必须是已安装的依赖，**不接受文件路径** */
  package: string;
  options?: Record<string, unknown>;
}

/** In-memory vector store — local development / tests only */
export interface MemoryVectorStoreConfig {
  provider: "memory";
}

export interface PgvectorConfig {
  provider: "pgvector";
  /** Uses the same database connection as DatabaseConfig */
  indexType: VectorStoreIndexType;
}

export interface MilvusConfig {
  provider: "milvus";
  host: string;
  port: number;
  collection: string;
  user?: string;
  password?: string;
}

export interface QdrantConfig {
  provider: "qdrant";
  url: string;
  collection: string;
  apiKey?: string;
}

export interface WeaviateConfig {
  provider: "weaviate";
  url: string;
  apiKey?: string;
}

export interface PineconeConfig {
  provider: "pinecone";
  apiKey: string;
  environment: string;
  index: string;
}

export interface ChromaConfig {
  provider: "chroma";
  url: string;
  collection: string;
}

export type VectorStoreConfig =
  | MemoryVectorStoreConfig
  | PgvectorConfig
  | MilvusConfig
  | QdrantConfig
  | WeaviateConfig
  | PineconeConfig
  | ChromaConfig
  | ExternalProviderConfig;

// ───────────────────────────────────────────────────────────────────
// 3. LLM Provider
// ───────────────────────────────────────────────────────────────────

export type LLMProviderType = "qwen" | "claude" | "openai" | "gemini" | "ollama";

/**
 * Named LLM flows in the Apigent platform.
 * Each flow can use a different model — e.g., a cheap/fast model for
 * query rewriting and a more capable model for RAG answer generation.
 */
export type LLMFlow = "default" | "business_context" | "query_rewrite" | "rag_answer" | "editing";

/** Map from flow name to model ID */
export type LLMFlowModelMap = Record<LLMFlow, string>;

export interface ClaudeLLMConfig {
  provider: "claude";
  apiKey: string;
  models: LLMFlowModelMap;
}

export interface OpenAILLMConfig {
  provider: "openai";
  apiKey: string;
  models: LLMFlowModelMap;
}

export interface GeminiLLMConfig {
  provider: "gemini";
  apiKey: string;
  models: LLMFlowModelMap;
}

export interface OllamaLLMConfig {
  provider: "ollama";
  baseUrl: string;
  models: LLMFlowModelMap;
}

export interface QwenLLMConfig {
  provider: "qwen";
  apiKey: string;
  /** DashScope base URL — defaults to the official endpoint when omitted */
  baseUrl?: string;
  models: LLMFlowModelMap;
}

export type LLMConfig =
  QwenLLMConfig | ClaudeLLMConfig | OpenAILLMConfig | GeminiLLMConfig | OllamaLLMConfig;

// ───────────────────────────────────────────────────────────────────
// 4. Embedding Provider
// ───────────────────────────────────────────────────────────────────

export type EmbeddingProviderType =
  "qwen" | "claude" | "openai" | "cohere" | "local-bge" | "local-fastembed";

export interface QwenEmbeddingConfig {
  provider: "qwen";
  apiKey: string;
  model: string;
}

export interface ClaudeEmbeddingConfig {
  provider: "claude";
  apiKey: string;
  model: string;
}

export interface OpenAIEmbeddingConfig {
  provider: "openai";
  apiKey: string;
  model: string;
}

export interface CohereEmbeddingConfig {
  provider: "cohere";
  apiKey: string;
  model: string;
}

export interface LocalBGEConfig {
  provider: "local-bge";
  model: string;
  device: "cpu" | "cuda";
}

export interface LocalFastEmbedConfig {
  provider: "local-fastembed";
  model: string;
  device: "cpu" | "cuda";
}

export type EmbeddingConfig =
  | QwenEmbeddingConfig
  | ClaudeEmbeddingConfig
  | OpenAIEmbeddingConfig
  | CohereEmbeddingConfig
  | LocalBGEConfig
  | LocalFastEmbedConfig
  | ExternalProviderConfig;

// ───────────────────────────────────────────────────────────────────
// 5. RAG Pipeline
// ───────────────────────────────────────────────────────────────────

export type RetrievalMode =
  | "hybrid" // Dense + Sparse (+ KG traversal when knowledgeGraph.enabled)
  | "dense-only" // Embedding only
  | "sparse-only" // BM25 only
  | "kg-only"; // Knowledge Graph only (requires knowledgeGraph.enabled)

export type FusionMethod = "rrf" | "linear";

export type RerankerProvider = "bge-reranker" | "cohere" | "qwen" | "none";

export type ChunkStrategy = "hierarchical" | "fixed";

export interface BgeRerankerConfig {
  provider: "bge-reranker";
  model: string;
  device: "cpu" | "cuda";
}

export interface CohereRerankerConfig {
  provider: "cohere";
  apiKey: string;
  model: string;
}

export interface QwenRerankerConfig {
  provider: "qwen";
  apiKey: string;
  model: string;
}

export interface NoRerankerConfig {
  provider: "none";
}

export type RerankerConfig =
  | BgeRerankerConfig
  | CohereRerankerConfig
  | QwenRerankerConfig
  | NoRerankerConfig
  | ExternalProviderConfig;

/**
 * Knowledge Graph enhancement (V1+).
 * Disabled by default — when enabled, hybrid retrieval adds graph-traversal
 * recall and workflow discovery becomes available.
 */
export interface KnowledgeGraphConfig {
  /** Enable KG traversal in retrieval (default: false) */
  enabled: boolean;
}

// ───────────────────────────────────────────────────────────────────
// 稀疏检索后端（`rag.searchStore`，P0-3 定案 A3）
// ───────────────────────────────────────────────────────────────────
//
// 三个内置取值**共用同一条** pg-fts 读写路径（应用侧写 `search_text` → 生成列
// `search_vector` → GIN 索引），差别只在**应用侧的分词口径**。所以它们是一个后端
// 的三套切词方案，不是三个独立后端 —— 换值等于换 `tokenizer_version`，**必须全量
// REINDEX**：切分口径变了，旧索引里的词元与新查询的词元对不上，表现为静默查不到
// （P3-1 / P3-2）。
//
// 为什么拆成三个接口，而不是一个 `provider: "pg-fts-jieba" | …`：与 embedding /
// reranker 保持同一种判别联合形态（`schema.ts` 用 `discriminatedUnion`，
// `schema.test.ts` 有「schema 推断类型 === 手写类型」的编译期断言），也为将来的
// 变体专属配置留位置（例如 jieba 的领域词典标识）。

/**
 * 默认的内置稀疏后端：PostgreSQL FTS（`tsvector` + GIN 索引）+ 应用侧 jieba。
 *
 * jieba 必须用 `cutForSearch`（搜索模式）而非默认 `cut`：默认模式把「发货单」
 * 切成单个词元，用户查「发货」命中为 0，而且不报错、不告警（P0-3 spike §4.3）。
 */
export interface PgFtsJiebaSearchStoreConfig {
  provider: "pg-fts-jieba";
}

/**
 * 备选：CJK 2-gram 切分。
 *
 * 保留它是因为**零依赖、无词典版本漂移**（不引入原生模块），是 jieba 出问题时的
 * 逃生通道；代价是索引更大、有少量噪音匹配（P0-3 spike 实测索引体积约为 jieba 的
 * 1.4 倍）。
 */
export interface PgFtsBigramSearchStoreConfig {
  provider: "pg-fts-bigram";
}

/**
 * 只用 PostgreSQL 的 `simple` parser：FTS 只服务英文词与归一化后的标识符，
 * 中文语义召回全部交给 dense。零新增依赖，中文关键词精确匹配最弱。
 */
export interface PgFtsSimpleSearchStoreConfig {
  provider: "pg-fts-simple";
}

/**
 * 关闭稀疏路 —— 管线退化为 dense-only。
 *
 * 写成显式的 `none` 而不是「省略这个键」：`searchStore` 是必填槽位，`none` 表示
 * 「我知道没有稀疏召回，且接受」，与「忘了配」在配置里可区分。
 */
export interface DisabledSearchStoreConfig {
  provider: "none";
}

/**
 * Sparse store: built-in Postgres FTS variants (P0-3), disabled, or a third-party
 * package (P0-6).
 */
export type SearchStoreConfig =
  | PgFtsJiebaSearchStoreConfig
  | PgFtsBigramSearchStoreConfig
  | PgFtsSimpleSearchStoreConfig
  | DisabledSearchStoreConfig
  | ExternalProviderConfig;

export interface RAGRetrievalConfig {
  /** Retrieval mode: hybrid combines dense+sparse (+KG when enabled) */
  retrievalMode: RetrievalMode;
  /** Fusion method for combining dense + sparse results */
  fusionMethod: FusionMethod;
  /** How many results to keep after coarse ranking, before fine reranking */
  coarseRankTopK: number;
  /** How many results to return after fine reranking */
  fineRankTopK: number;
  /** Reranker configuration */
  reranker: RerankerConfig;
}

export interface RAGConfig {
  /** Chunk strategy for document splitting */
  chunkStrategy: ChunkStrategy;
  /** Embedding model — text → vector (shared by ingestion & retrieval) */
  embedding: EmbeddingConfig;
  /** Dense vector store backend */
  vectorStore: VectorStoreConfig;
  /** Sparse / full-text search backend */
  searchStore: SearchStoreConfig;
  /** Whether to enable LLM query rewriting before retrieval */
  queryRewrite: boolean;
  /** Cache TTL for rewritten queries (seconds) */
  queryRewriteCacheTtl: number;
  /** Retrieval & reranking pipeline parameters */
  retrieval: RAGRetrievalConfig;
  /** Knowledge Graph enhancement (V1+, default disabled) */
  knowledgeGraph: KnowledgeGraphConfig;
}

// ───────────────────────────────────────────────────────────────────
// 6. Storage Provider
// ───────────────────────────────────────────────────────────────────

export type StorageProviderType = "local" | "s3" | "minio" | "gcs";

export interface LocalStorageConfig {
  provider: "local";
  basePath: string;
}

export interface S3StorageConfig {
  provider: "s3" | "minio";
  bucket: string;
  region: string;
  endpoint?: string; // for MinIO
  accessKeyId: string;
  secretAccessKey: string;
}

export interface GCSStorageConfig {
  provider: "gcs";
  bucket: string;
  projectId: string;
}

export type StorageConfig = LocalStorageConfig | S3StorageConfig | GCSStorageConfig;

// ───────────────────────────────────────────────────────────────────
// 7. Queue Provider
// ───────────────────────────────────────────────────────────────────

export type QueueProviderType = "postgres" | "bullmq" | "rabbitmq" | "sqs" | "memory";

export interface PgQueueConfig {
  /** Postgres-backed queue — V0 default; reuses the DatabaseConfig connection */
  provider: "postgres";
}

export interface BullmqQueueConfig {
  provider: "bullmq";
  redisUrl: string;
}

export interface RabbitmqQueueConfig {
  provider: "rabbitmq";
  url: string;
}

export interface SqsQueueConfig {
  provider: "sqs";
  region: string;
  queuePrefix: string;
}

export interface MemoryQueueConfig {
  provider: "memory";
}

export type QueueConfig =
  PgQueueConfig | BullmqQueueConfig | RabbitmqQueueConfig | SqsQueueConfig | MemoryQueueConfig;

// ───────────────────────────────────────────────────────────────────
// 7.5 Business Context
// ───────────────────────────────────────────────────────────────────

/**
 * 业务上下文生成配置（docs/modules/business-context.md §4）。
 * 自动触发默认关闭；手动触发始终可用。
 */
export interface BusinessContextConfig {
  /** 导入成功后自动创建上下文生成任务（默认关闭） */
  autoGenerate: boolean;
  /** 每批送 LLM 的接口数 */
  batchSize: number;
  /** 并行批数 */
  concurrency: number;
  /** 低于此置信度标记 needs_review */
  minConfidence: number;
  /** 生成语言：auto（跟随 spec 描述）| zh | en */
  language: "auto" | "zh" | "en";
  /** 重新生成时跳过人工编辑过的接口 */
  skipHumanEdited: boolean;
}

// ───────────────────────────────────────────────────────────────────
// 8. Auth
// ───────────────────────────────────────────────────────────────────

export type AuthProviderType = "credentials" | "github" | "google";

export interface AuthConfig {
  /** Secret for signing JWT / session cookies */
  secret: string;
  /**
   * Separate secret for the Admin Webapp session cookie. Deliberately has no
   * fallback to {@link secret}: the admin plane must be isolated, and a missing
   * value should fail loudly instead of silently sharing the tenant secret.
   */
  adminSecret?: string;
  /** Enabled auth providers */
  providers: AuthProviderType[];
  /** Session max age in seconds */
  sessionMaxAge: number;
  /** GitHub OAuth (optional) */
  github?: {
    clientId: string;
    clientSecret: string;
  };
  /** Google OAuth (optional) */
  google?: {
    clientId: string;
    clientSecret: string;
  };
}

// ───────────────────────────────────────────────────────────────────
// 9. MCP Gateway
// ───────────────────────────────────────────────────────────────────

export type MCPTransport = "streamable-http";

export interface MCPConfig {
  /** HTTP path for the MCP endpoint */
  path: string;
  /** Transport protocol */
  transport: MCPTransport;
  /** Optional external/public base URL for MCP (scheme://host[:port])。为空则前端用当前 origin 兜底。 */
  publicUrl?: string;
}

// ───────────────────────────────────────────────────────────────────
// 9.5 Observability — logs / metrics / traces
// ───────────────────────────────────────────────────────────────────

/** 通用日志级别（本地控制台 / pino） */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 可观测性采集/导出目标。
 *   none     → 仅本地结构化日志到 stdout（A+B 阶段，可 grep）
 *   otlp     → OpenTelemetry OTLP 导出（C 阶段，SigNoz / Grafana Cloud 等）
 *   langfuse → LLM / RAG 专项 trace（产品增值，后置）
 *   phoenix  → LLM / RAG 专项 trace（产品增值，后置）
 */
export type ObservabilityProviderType = "none" | "otlp" | "langfuse" | "phoenix";

export interface ObservabilityConfig {
  /** 采集/导出目标。默认 none（仅 stdout 结构化日志） */
  provider: ObservabilityProviderType;
  /** 本地日志级别（阶段 A 起生效） */
  logLevel: LogLevel;
  /** OTLP 导出目标（provider=otlp 时使用；C 阶段） */
  otlp?: {
    /** OTLP HTTP/gRPC endpoint，如 http://localhost:4318 */
    endpoint: string;
    /** 可选 headers（如 API key）；secret 亦可来自环境变量 */
    headers?: Record<string, string>;
  };
  /** Langfuse（LLM/RAG 专项，后置）。公钥等 secret 走环境变量 */
  langfuse?: {
    baseUrl?: string;
  };
  /** Phoenix / Arize（LLM/RAG 专项，后置） */
  phoenix?: {
    endpoint?: string;
  };
}

// ───────────────────────────────────────────────────────────────────
// 10. Apps — per-app runtime settings
// ───────────────────────────────────────────────────────────────────
//
// 监听端口不在这里：每个 app 在启动命令上指定（`next -p` / `--port`），
// 见 CLAUDE.md → Port Conventions。

export interface AppEndpointConfig {
  /** Runtime log level */
  logLevel: LogLevel;
}

export interface AppsConfig {
  platform: AppEndpointConfig;
  admin: AppEndpointConfig;
  open: AppEndpointConfig;
}

export type AppName = keyof AppsConfig;

// ───────────────────────────────────────────────────────────────────
// 12. Top-level Apigent Config
// ───────────────────────────────────────────────────────────────────

export interface ApigentConfig {
  /** Database configuration */
  database: DatabaseConfig;
  /** LLM provider + per-flow model selection */
  llm: LLMConfig;
  /** RAG pipeline configuration */
  rag: RAGConfig;
  /** File / asset storage */
  storage: StorageConfig;
  /** Async task queue */
  queue: QueueConfig;
  /** Business context generation */
  businessContext: BusinessContextConfig;
  /** Authentication */
  auth: AuthConfig;
  /** MCP Gateway */
  mcp: MCPConfig;
  /** Observability configuration */
  observability: ObservabilityConfig;
  /** Application endpoints (platform / admin / open) */
  apps: AppsConfig;
}
