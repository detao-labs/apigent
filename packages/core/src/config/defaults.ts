// ═══════════════════════════════════════════════════════════════════
// Apigent Config — Default Values (development environment)
// ═══════════════════════════════════════════════════════════════════
//
// These defaults are designed for local development. In production,
// values are overridden via apigent.config.yaml.
//
// IMPORTANT: Defaults must NEVER contain secrets.
// Secrets come exclusively from .env (see .env.example).
// ═══════════════════════════════════════════════════════════════════

import type { AppsConfig, LLMFlowModelMap, ObservabilityConfig, RAGConfig } from "./types";

// ───────────────────────────────────────────────────────────────────
// LLM — per-flow model defaults (Claude)
// ───────────────────────────────────────────────────────────────────

export const DEFAULT_CLAUDE_MODELS: LLMFlowModelMap = {
  default: "claude-sonnet-5",
  business_context: "claude-sonnet-5",
  query_rewrite: "claude-haiku-4-5-20251001",
  rag_answer: "claude-sonnet-5",
  editing: "claude-sonnet-5",
};

// ───────────────────────────────────────────────────────────────────
// LLM — per-flow model defaults (Qwen / DashScope)
// ───────────────────────────────────────────────────────────────────

export const DEFAULT_QWEN_MODELS: LLMFlowModelMap = {
  default: "qwen3.7-plus",
  business_context: "qwen3.7-plus",
  query_rewrite: "qwen3.7-flash",
  rag_answer: "qwen3.7-plus",
  editing: "qwen3.7-plus",
};

// ───────────────────────────────────────────────────────────────────
// LLM — per-flow model defaults (OpenAI)
// ───────────────────────────────────────────────────────────────────

export const DEFAULT_OPENAI_MODELS: LLMFlowModelMap = {
  default: "gpt-4o",
  business_context: "gpt-4o",
  query_rewrite: "gpt-4o-mini",
  rag_answer: "gpt-4o",
  editing: "gpt-4o",
};

// ───────────────────────────────────────────────────────────────────
// LLM — per-flow model defaults (Gemini)
// ───────────────────────────────────────────────────────────────────

export const DEFAULT_GEMINI_MODELS: LLMFlowModelMap = {
  default: "gemini-2.0-flash",
  business_context: "gemini-2.0-flash",
  query_rewrite: "gemini-2.0-flash-lite",
  rag_answer: "gemini-2.0-flash",
  editing: "gemini-2.0-flash",
};

// ───────────────────────────────────────────────────────────────────
// LLM — per-flow model defaults (Ollama)
// ───────────────────────────────────────────────────────────────────

export const DEFAULT_OLLAMA_MODELS: LLMFlowModelMap = {
  default: "llama3.1",
  business_context: "llama3.1",
  query_rewrite: "llama3.1",
  rag_answer: "llama3.1",
  editing: "llama3.1",
};

// ───────────────────────────────────────────────────────────────────
// RAG — default pipeline configuration
// ───────────────────────────────────────────────────────────────────

export const DEFAULT_RAG_CONFIG: RAGConfig = {
  provider: "builtin",
  chunkStrategy: "hierarchical",
  embedding: { provider: "qwen", apiKey: "", model: "text-embedding-v4" },
  vectorStore: { provider: "pgvector" },
  searchStore: { provider: "pg-fts-jieba" },
  queryRewrite: true,
  queryRewriteCacheTtl: 3600,
  retrieval: {
    retrievalMode: "hybrid",
    fusionMethod: "rrf",
    // minScore 有意不设默认值（不写 = 不设阈值）：合适的最低相似度只能由 golden set
    // 定（Phase 7）。给一个拍脑袋的数字会让召回悄悄变少，而「少了几条」比「多几条
    // 低分」更难被发现。类型上是可选字段，schema 也允许缺省。
    coarseRankTopK: 20,
    fineRankTopK: 10,
    reranker: { provider: "qwen", apiKey: "", model: "qwen3-rerank" },
  },
  knowledgeGraph: { enabled: false },
};

// ───────────────────────────────────────────────────────────────────
// Apps — default per-app runtime settings (server is a shared module, no standalone service)
// ───────────────────────────────────────────────────────────────────

export const DEFAULT_APPS_CONFIG: AppsConfig = {
  platform: { logLevel: "info" },
  admin: { logLevel: "info" },
  open: { logLevel: "info" },
};

// ───────────────────────────────────────────────────────────────────
// Observability — default (local structured logs to stdout)
// ───────────────────────────────────────────────────────────────────

export const DEFAULT_OBSERVABILITY_CONFIG: ObservabilityConfig = {
  provider: "none",
  logLevel: "info",
};
