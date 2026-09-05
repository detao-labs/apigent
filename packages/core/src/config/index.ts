// ═══════════════════════════════════════════════════════════════════
// Apigent Config — Public API
// ═══════════════════════════════════════════════════════════════════
//
// Single entry point: loadConfig() reads apigent.config.yaml + .env
// ═══════════════════════════════════════════════════════════════════

export type {
  // Database
  DBProvider,
  DatabaseConfig,
  // Vector Store
  VectorStoreProvider,
  VectorStoreIndexType,
  PgvectorConfig,
  MilvusConfig,
  QdrantConfig,
  WeaviateConfig,
  PineconeConfig,
  ChromaConfig,
  VectorStoreConfig,
  // LLM
  LLMProviderType,
  LLMFlow,
  LLMFlowModelMap,
  QwenLLMConfig,
  ClaudeLLMConfig,
  OpenAILLMConfig,
  GeminiLLMConfig,
  OllamaLLMConfig,
  LLMConfig,
  // Embedding
  EmbeddingProviderType,
  QwenEmbeddingConfig,
  ClaudeEmbeddingConfig,
  OpenAIEmbeddingConfig,
  CohereEmbeddingConfig,
  LocalBGEConfig,
  LocalFastEmbedConfig,
  EmbeddingConfig,
  // RAG
  RetrievalMode,
  FusionMethod,
  RerankerProvider,
  ChunkStrategy,
  BgeRerankerConfig,
  CohereRerankerConfig,
  QwenRerankerConfig,
  NoRerankerConfig,
  RerankerConfig,
  KnowledgeGraphConfig,
  SearchStoreConfig,
  RAGRetrievalConfig,
  RAGConfig,
  // Storage
  StorageProviderType,
  LocalStorageConfig,
  S3StorageConfig,
  GCSStorageConfig,
  StorageConfig,
  // Queue
  QueueProviderType,
  PgQueueConfig,
  BullmqQueueConfig,
  RabbitmqQueueConfig,
  SqsQueueConfig,
  MemoryQueueConfig,
  QueueConfig,
  // Auth
  AuthProviderType,
  AuthConfig,
  // MCP
  MCPTransport,
  MCPConfig,
  // Observability
  LogLevel,
  ObservabilityProviderType,
  ObservabilityConfig,
  // Apps
  AppEndpointConfig,
  AppsConfig,
  AppName,
  // Business Context
  BusinessContextConfig,
  // Top-level
  ApigentConfig,
} from "./types";

export {
  ApigentConfigSchema,
  BusinessContextConfigSchema,
  ObservabilityConfigSchema,
} from "./schema";

export {
  DEFAULT_CLAUDE_MODELS,
  DEFAULT_QWEN_MODELS,
  DEFAULT_OPENAI_MODELS,
  DEFAULT_GEMINI_MODELS,
  DEFAULT_OLLAMA_MODELS,
  DEFAULT_RAG_CONFIG,
  DEFAULT_APPS_CONFIG,
  DEFAULT_OBSERVABILITY_CONFIG,
} from "./defaults";

// ── Public API — the only way to load config ──────────────────────

export { loadConfig, findConfigFile, getConfig, resetConfig } from "./file-loader";
export { getAppConfig } from "./apps";
export type { ResolvedAppConfig } from "./apps";
