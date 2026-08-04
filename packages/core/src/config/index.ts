// ═══════════════════════════════════════════════════════════════════
// Apigent Config — Public API
// ═══════════════════════════════════════════════════════════════════
//
// Single entry point: loadConfig() reads apigent.config.yaml + .env
// ═══════════════════════════════════════════════════════════════════

export type {
  // Database
  DbProvider,
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
  RAGConfig,
  // Storage
  StorageProviderType,
  LocalStorageConfig,
  S3StorageConfig,
  GCSStorageConfig,
  StorageConfig,
  // Queue
  QueueProviderType,
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
  // Server
  ServerConfig,
  // Webapp
  WebappConfig,
  // Top-level
  ApigentConfig,
} from "./types";

export {
  DEFAULT_CLAUDE_MODELS,
  DEFAULT_QWEN_MODELS,
  DEFAULT_OPENAI_MODELS,
  DEFAULT_GEMINI_MODELS,
  DEFAULT_OLLAMA_MODELS,
  DEFAULT_RAG_CONFIG,
  DEFAULT_SERVER_CONFIG,
  DEV_DEFAULTS,
} from "./defaults";

// ── Public API — the only way to load config ──────────────────────

export {
  loadConfig,
  findConfigFile,
  getConfig,
  resetConfig,
} from "./file-loader";
