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
  | ChromaConfig;

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
  | LocalFastEmbedConfig;

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
  BgeRerankerConfig | CohereRerankerConfig | QwenRerankerConfig | NoRerankerConfig;

/**
 * Knowledge Graph enhancement (V1+).
 * Disabled by default — when enabled, hybrid retrieval adds graph-traversal
 * recall and workflow discovery becomes available.
 */
export interface KnowledgeGraphConfig {
  /** Enable KG traversal in retrieval (default: false) */
  enabled: boolean;
}

export interface SearchStoreConfig {
  /** Sparse / keyword retrieval backend (V0: PostgreSQL tsvector + GIN) */
  provider: "pg-fts";
}

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
  | PgQueueConfig
  | BullmqQueueConfig
  | RabbitmqQueueConfig
  | SqsQueueConfig
  | MemoryQueueConfig;

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
// 10. Apps — application endpoints
// ───────────────────────────────────────────────────────────────────

export interface AppEndpointConfig {
  /** Public URL of the app */
  url: string;
  /** Runtime log level */
  logLevel: "debug" | "info" | "warn" | "error";
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
  /** Application endpoints (platform / admin / open) */
  apps: AppsConfig;
}
