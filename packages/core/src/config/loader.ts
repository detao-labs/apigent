// ═══════════════════════════════════════════════════════════════════
// Apigent Config — Env Loader (INTERNAL)
// ═══════════════════════════════════════════════════════════════════
//
// Reads configuration from environment variables (.env). This is an
// internal helper used by file-loader.ts — it builds a base config
// that the YAML file then overrides.
//
// DO NOT use this directly. The public API is loadConfig() from
// file-loader.ts, which reads apigent.config.yaml + .env.
//
// All Apigent env vars use the APIGENT_ prefix.
// ═══════════════════════════════════════════════════════════════════

import type {
  ApigentConfig,
  DatabaseConfig,
  VectorStoreConfig,
  LLMConfig,
  EmbeddingConfig,
  RAGConfig,
  RerankerConfig,
  StorageConfig,
  QueueConfig,
  AuthConfig,
  MCPConfig,
  ServerConfig,
  WebappConfig,
} from "./types";
import {
  DEFAULT_CLAUDE_MODELS,
  DEFAULT_QWEN_MODELS,
  DEFAULT_OPENAI_MODELS,
  DEFAULT_GEMINI_MODELS,
  DEFAULT_OLLAMA_MODELS,
  DEFAULT_RAG_CONFIG,
  DEFAULT_SERVER_CONFIG,
} from "./defaults";

// ───────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────

function env(key: string, fallback?: string): string {
  const value = process.env[key];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable: ${key}`);
}

function envOptional(key: string): string | undefined {
  const value = process.env[key];
  return value && value !== "" ? value : undefined;
}

function envBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
}

function envInt(key: string, fallback: number): number {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) throw new Error(`Invalid integer for ${key}: ${value}`);
  return parsed;
}

function envList(key: string, fallback: string[]): string[] {
  const value = process.env[key];
  if (value === undefined || value === "") return fallback;
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

// ───────────────────────────────────────────────────────────────────
// Database
// ───────────────────────────────────────────────────────────────────

function loadDatabase(): DatabaseConfig {
  return {
    provider: env("APIGENT_DB_PROVIDER", "postgresql") as DatabaseConfig["provider"],
    url: env("APIGENT_DATABASE_URL"),
  };
}

// ───────────────────────────────────────────────────────────────────
// Vector Store
// ───────────────────────────────────────────────────────────────────

function loadVectorStore(): VectorStoreConfig {
  const provider = env("APIGENT_VECTOR_STORE_PROVIDER", "pgvector") as VectorStoreConfig["provider"];

  switch (provider) {
    case "pgvector":
      return {
        provider: "pgvector",
        indexType: env("APIGENT_VECTOR_STORE_INDEX", "ivfflat") as "ivfflat" | "hnsw",
      };

    case "milvus":
      return {
        provider: "milvus",
        host: env("APIGENT_MILVUS_HOST", "localhost"),
        port: envInt("APIGENT_MILVUS_PORT", 19530),
        collection: env("APIGENT_MILVUS_COLLECTION", "apigent_embeddings"),
        user: envOptional("APIGENT_MILVUS_USER"),
        password: envOptional("APIGENT_MILVUS_PASSWORD"),
      };

    case "qdrant":
      return {
        provider: "qdrant",
        url: env("APIGENT_QDRANT_URL", "http://localhost:6333"),
        collection: env("APIGENT_QDRANT_COLLECTION", "apigent_embeddings"),
        apiKey: envOptional("APIGENT_QDRANT_API_KEY"),
      };

    case "weaviate":
      return {
        provider: "weaviate",
        url: env("APIGENT_WEAVIATE_URL", "http://localhost:8080"),
        apiKey: envOptional("APIGENT_WEAVIATE_API_KEY"),
      };

    case "pinecone":
      return {
        provider: "pinecone",
        apiKey: envOptional("APIGENT_PINECONE_API_KEY") ?? "",
        environment: envOptional("APIGENT_PINECONE_ENVIRONMENT") ?? "us-east-1",
        index: env("APIGENT_PINECONE_INDEX", "apigent-embeddings"),
      };

    case "chroma":
      return {
        provider: "chroma",
        url: env("APIGENT_CHROMA_URL", "http://localhost:8000"),
        collection: env("APIGENT_CHROMA_COLLECTION", "apigent_embeddings"),
      };

    default:
      throw new Error(`Unknown vector store provider: ${provider}`);
  }
}

// ───────────────────────────────────────────────────────────────────
// LLM Provider
// ───────────────────────────────────────────────────────────────────

function loadLLM(): LLMConfig {
  const provider = env("APIGENT_LLM_PROVIDER", "qwen") as LLMConfig["provider"];

  switch (provider) {
    case "qwen":
      return {
        provider: "qwen",
        apiKey: envOptional("DASHSCOPE_API_KEY") ?? "",
        baseUrl: envOptional("APIGENT_LLM_QWEN_BASE_URL"),
        models: {
          default: env("APIGENT_LLM_QWEN_DEFAULT_MODEL", DEFAULT_QWEN_MODELS.default),
          business_context: env("APIGENT_LLM_QWEN_BUSINESS_CONTEXT_MODEL", DEFAULT_QWEN_MODELS.business_context),
          query_rewrite: env("APIGENT_LLM_QWEN_QUERY_REWRITE_MODEL", DEFAULT_QWEN_MODELS.query_rewrite),
          rag_answer: env("APIGENT_LLM_QWEN_RAG_ANSWER_MODEL", DEFAULT_QWEN_MODELS.rag_answer),
          editing: env("APIGENT_LLM_QWEN_EDITING_MODEL", DEFAULT_QWEN_MODELS.editing),
        },
      };

    case "claude":
      return {
        provider: "claude",
        apiKey: envOptional("ANTHROPIC_API_KEY") ?? "",
        models: {
          default: env("APIGENT_LLM_CLAUDE_DEFAULT_MODEL", DEFAULT_CLAUDE_MODELS.default),
          business_context: env("APIGENT_LLM_CLAUDE_BUSINESS_CONTEXT_MODEL", DEFAULT_CLAUDE_MODELS.business_context),
          query_rewrite: env("APIGENT_LLM_CLAUDE_QUERY_REWRITE_MODEL", DEFAULT_CLAUDE_MODELS.query_rewrite),
          rag_answer: env("APIGENT_LLM_CLAUDE_RAG_ANSWER_MODEL", DEFAULT_CLAUDE_MODELS.rag_answer),
          editing: env("APIGENT_LLM_CLAUDE_EDITING_MODEL", DEFAULT_CLAUDE_MODELS.editing),
        },
      };

    case "openai":
      return {
        provider: "openai",
        apiKey: envOptional("OPENAI_API_KEY") ?? "",
        models: {
          default: env("APIGENT_LLM_OPENAI_DEFAULT_MODEL", DEFAULT_OPENAI_MODELS.default),
          business_context: env("APIGENT_LLM_OPENAI_BUSINESS_CONTEXT_MODEL", DEFAULT_OPENAI_MODELS.business_context),
          query_rewrite: env("APIGENT_LLM_OPENAI_QUERY_REWRITE_MODEL", DEFAULT_OPENAI_MODELS.query_rewrite),
          rag_answer: env("APIGENT_LLM_OPENAI_RAG_ANSWER_MODEL", DEFAULT_OPENAI_MODELS.rag_answer),
          editing: env("APIGENT_LLM_OPENAI_EDITING_MODEL", DEFAULT_OPENAI_MODELS.editing),
        },
      };

    case "gemini":
      return {
        provider: "gemini",
        apiKey: envOptional("GEMINI_API_KEY") ?? "",
        models: {
          default: env("APIGENT_LLM_GEMINI_DEFAULT_MODEL", DEFAULT_GEMINI_MODELS.default),
          business_context: env("APIGENT_LLM_GEMINI_BUSINESS_CONTEXT_MODEL", DEFAULT_GEMINI_MODELS.business_context),
          query_rewrite: env("APIGENT_LLM_GEMINI_QUERY_REWRITE_MODEL", DEFAULT_GEMINI_MODELS.query_rewrite),
          rag_answer: env("APIGENT_LLM_GEMINI_RAG_ANSWER_MODEL", DEFAULT_GEMINI_MODELS.rag_answer),
          editing: env("APIGENT_LLM_GEMINI_EDITING_MODEL", DEFAULT_GEMINI_MODELS.editing),
        },
      };

    case "ollama":
      return {
        provider: "ollama",
        baseUrl: env("APIGENT_LLM_OLLAMA_BASE_URL", "http://localhost:11434"),
        models: {
          default: env("APIGENT_LLM_OLLAMA_DEFAULT_MODEL", DEFAULT_OLLAMA_MODELS.default),
          business_context: env("APIGENT_LLM_OLLAMA_BUSINESS_CONTEXT_MODEL", DEFAULT_OLLAMA_MODELS.business_context),
          query_rewrite: env("APIGENT_LLM_OLLAMA_QUERY_REWRITE_MODEL", DEFAULT_OLLAMA_MODELS.query_rewrite),
          rag_answer: env("APIGENT_LLM_OLLAMA_RAG_ANSWER_MODEL", DEFAULT_OLLAMA_MODELS.rag_answer),
          editing: env("APIGENT_LLM_OLLAMA_EDITING_MODEL", DEFAULT_OLLAMA_MODELS.editing),
        },
      };

    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

// ───────────────────────────────────────────────────────────────────
// Embedding Provider
// ───────────────────────────────────────────────────────────────────

function loadEmbedding(): EmbeddingConfig {
  const provider = env("APIGENT_EMBEDDING_PROVIDER", "qwen") as EmbeddingConfig["provider"];

  switch (provider) {
    case "qwen":
      return {
        provider: "qwen",
        apiKey: envOptional("DASHSCOPE_API_KEY") ?? "",
        model: env("APIGENT_EMBEDDING_QWEN_MODEL", "text-embedding-v4"),
      };

    case "claude":
      return {
        provider: "claude",
        apiKey: envOptional("ANTHROPIC_API_KEY") ?? "",
        model: env("APIGENT_EMBEDDING_CLAUDE_MODEL", "claude-embedding"),
      };

    case "openai":
      return {
        provider: "openai",
        apiKey: envOptional("OPENAI_API_KEY") ?? "",
        model: env("APIGENT_EMBEDDING_OPENAI_MODEL", "text-embedding-3-small"),
      };

    case "cohere":
      return {
        provider: "cohere",
        apiKey: envOptional("APIGENT_COHERE_API_KEY") ?? "",
        model: env("APIGENT_EMBEDDING_COHERE_MODEL", "embed-multilingual-v3.0"),
      };

    case "local-bge":
      return {
        provider: "local-bge",
        model: env("APIGENT_EMBEDDING_BGE_MODEL", "BAAI/bge-m3"),
        device: env("APIGENT_EMBEDDING_BGE_DEVICE", "cpu") as "cpu" | "cuda",
      };

    case "local-fastembed":
      return {
        provider: "local-fastembed",
        model: env("APIGENT_EMBEDDING_FASTEMBED_MODEL", "BAAI/bge-small-en-v1.5"),
        device: env("APIGENT_EMBEDDING_FASTEMBED_DEVICE", "cpu") as "cpu" | "cuda",
      };

    default:
      throw new Error(`Unknown embedding provider: ${provider}`);
  }
}

// ───────────────────────────────────────────────────────────────────
// RAG Pipeline
// ───────────────────────────────────────────────────────────────────

function loadReranker(): RerankerConfig {
  const provider = env("APIGENT_RAG_RERANKER", "qwen") as RerankerConfig["provider"];

  switch (provider) {
    case "qwen":
      return {
        provider: "qwen",
        apiKey: envOptional("DASHSCOPE_API_KEY") ?? "",
        model: env("APIGENT_RAG_RERANKER_QWEN_MODEL", "qwen3-rerank"),
      };

    case "bge-reranker":
      return {
        provider: "bge-reranker",
        model: env("APIGENT_RAG_RERANKER_BGE_MODEL", "BAAI/bge-reranker-v2-m3"),
        device: env("APIGENT_RAG_RERANKER_BGE_DEVICE", "cpu") as "cpu" | "cuda",
      };

    case "cohere":
      return {
        provider: "cohere",
        apiKey: envOptional("APIGENT_COHERE_API_KEY") ?? "",
        model: env("APIGENT_RAG_RERANKER_COHERE_MODEL", "rerank-multilingual-v3.0"),
      };

    case "none":
      return { provider: "none" };

    default:
      throw new Error(`Unknown reranker provider: ${provider}`);
  }
}

function loadRAG(): RAGConfig {
  return {
    retrievalMode: env("APIGENT_RAG_RETRIEVAL_MODE", DEFAULT_RAG_CONFIG.retrievalMode) as RAGConfig["retrievalMode"],
    fusionMethod: env("APIGENT_RAG_FUSION_METHOD", DEFAULT_RAG_CONFIG.fusionMethod) as RAGConfig["fusionMethod"],
    coarseRankTopK: envInt("APIGENT_RAG_COARSE_RANK_TOP_K", DEFAULT_RAG_CONFIG.coarseRankTopK),
    reranker: loadReranker(),
    fineRankTopK: envInt("APIGENT_RAG_FINE_RANK_TOP_K", DEFAULT_RAG_CONFIG.fineRankTopK),
    chunkStrategy: env("APIGENT_RAG_CHUNK_STRATEGY", DEFAULT_RAG_CONFIG.chunkStrategy) as RAGConfig["chunkStrategy"],
    queryRewrite: envBool("APIGENT_RAG_QUERY_REWRITE", DEFAULT_RAG_CONFIG.queryRewrite),
    queryRewriteCacheTtl: envInt("APIGENT_RAG_QUERY_REWRITE_CACHE_TTL", DEFAULT_RAG_CONFIG.queryRewriteCacheTtl),
  };
}

// ───────────────────────────────────────────────────────────────────
// Storage Provider
// ───────────────────────────────────────────────────────────────────

function loadStorage(): StorageConfig {
  const provider = env("APIGENT_STORAGE_PROVIDER", "local") as StorageConfig["provider"];

  switch (provider) {
    case "local":
      return {
        provider: "local",
        basePath: env("APIGENT_STORAGE_LOCAL_PATH", "./data/uploads"),
      };

    case "s3":
    case "minio":
      return {
        provider,
        bucket: envOptional("APIGENT_STORAGE_S3_BUCKET") ?? "",
        region: envOptional("APIGENT_STORAGE_S3_REGION") ?? "us-east-1",
        endpoint: envOptional("APIGENT_STORAGE_S3_ENDPOINT"),
        accessKeyId: envOptional("APIGENT_STORAGE_S3_ACCESS_KEY_ID") ?? "",
        secretAccessKey: envOptional("APIGENT_STORAGE_S3_SECRET_ACCESS_KEY") ?? "",
      };

    case "gcs":
      return {
        provider: "gcs",
        bucket: envOptional("APIGENT_STORAGE_GCS_BUCKET") ?? "",
        projectId: envOptional("APIGENT_STORAGE_GCS_PROJECT_ID") ?? "",
      };

    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }
}

// ───────────────────────────────────────────────────────────────────
// Queue Provider
// ───────────────────────────────────────────────────────────────────

function loadQueue(): QueueConfig {
  const provider = env("APIGENT_QUEUE_PROVIDER", "bullmq") as QueueConfig["provider"];

  switch (provider) {
    case "bullmq":
      return {
        provider: "bullmq",
        redisUrl: envOptional("APIGENT_REDIS_URL") ?? "",
      };

    case "rabbitmq":
      return {
        provider: "rabbitmq",
        url: envOptional("APIGENT_RABBITMQ_URL") ?? "",
      };

    case "sqs":
      return {
        provider: "sqs",
        region: envOptional("APIGENT_SQS_REGION") ?? "us-east-1",
        queuePrefix: env("APIGENT_SQS_QUEUE_PREFIX", "apigent-"),
      };

    case "memory":
      return { provider: "memory" };

    default:
      throw new Error(`Unknown queue provider: ${provider}`);
  }
}

// ───────────────────────────────────────────────────────────────────
// Auth
// ───────────────────────────────────────────────────────────────────

function loadAuth(): AuthConfig {
  const providers = envList("APIGENT_AUTH_PROVIDERS", ["credentials"]);

  const config: AuthConfig = {
    secret: env("APIGENT_AUTH_SECRET"),
    providers: providers as AuthConfig["providers"],
    sessionMaxAge: envInt("APIGENT_AUTH_SESSION_MAX_AGE", 604800),
  };

  if (providers.includes("github")) {
    config.github = {
      clientId: env("APIGENT_AUTH_GITHUB_ID"),
      clientSecret: env("APIGENT_AUTH_GITHUB_SECRET"),
    };
  }

  if (providers.includes("google")) {
    config.google = {
      clientId: env("APIGENT_AUTH_GOOGLE_ID"),
      clientSecret: env("APIGENT_AUTH_GOOGLE_SECRET"),
    };
  }

  return config;
}

// ───────────────────────────────────────────────────────────────────
// MCP & Server & Webapp
// ───────────────────────────────────────────────────────────────────

function loadMCP(): MCPConfig {
  return {
    path: env("APIGENT_MCP_PATH", "/mcp"),
    transport: env("APIGENT_MCP_TRANSPORT", "streamable-http") as MCPConfig["transport"],
  };
}

function loadServer(): ServerConfig {
  return {
    host: env("APIGENT_SERVER_HOST", DEFAULT_SERVER_CONFIG.host),
    port: envInt("APIGENT_SERVER_PORT", 3002),
    nodeEnv: env("NODE_ENV", DEFAULT_SERVER_CONFIG.nodeEnv) as ServerConfig["nodeEnv"],
    logLevel: env("APIGENT_LOG_LEVEL", DEFAULT_SERVER_CONFIG.logLevel) as ServerConfig["logLevel"],
  };
}

function loadWebapp(): WebappConfig {
  return {
    platformUrl: env("APIGENT_PLATFORM_URL", "http://localhost:3000"),
    adminUrl: env("APIGENT_ADMIN_URL", "http://localhost:3001"),
    apiUrl: env("APIGENT_API_URL", "http://localhost:3002"),
  };
}

// ───────────────────────────────────────────────────────────────────
// Shared singleton — used by both loaders
// ───────────────────────────────────────────────────────────────────

let _config: ApigentConfig | null = null;

/**
 * Build config from environment variables WITHOUT caching.
 * @internal — used by file-loader.ts to build the base config before YAML merge.
 */
export function _buildConfigFromEnv(): ApigentConfig {
  return {
    database: loadDatabase(),
    vectorStore: loadVectorStore(),
    llm: loadLLM(),
    embedding: loadEmbedding(),
    rag: loadRAG(),
    storage: loadStorage(),
    queue: loadQueue(),
    auth: loadAuth(),
    mcp: loadMCP(),
    server: loadServer(),
    webapp: loadWebapp(),
  };
}

/**
 * Get the currently loaded config.
 * Throws if {@link loadConfig} hasn't been called yet.
 */
export function getConfig(): ApigentConfig {
  if (!_config) {
    throw new Error(
      "Config not loaded. Call loadConfig() from @apigent/core/config at startup."
    );
  }
  return _config;
}

/**
 * Reset cached config (useful for testing).
 */
export function resetConfig(): void {
  _config = null;
}

/**
 * Set the cached config directly.
 * @internal — used by file-loader.ts to cache the merged config.
 */
export function setConfig(config: ApigentConfig): void {
  _config = config;
}
