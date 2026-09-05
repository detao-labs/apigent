// ═══════════════════════════════════════════════════════════════════
// Apigent Config — Defaults Loader (INTERNAL)
// ═══════════════════════════════════════════════════════════════════
//
// Builds the base config from hardcoded defaults ONLY — no environment
// variables are read here. Scheme choices (providers, models, ports,
// strategies) come exclusively from apigent.config.yaml, which the
// file-loader deep-merges over this base. Secrets (API keys, passwords,
// connection strings) are injected by file-loader.ts from .env.
//
// DO NOT use this directly. The public API is loadConfig() from
// file-loader.ts.
// ═══════════════════════════════════════════════════════════════════

import type { ApigentConfig } from "./types";
import {
  DEFAULT_APPS_CONFIG,
  DEFAULT_OBSERVABILITY_CONFIG,
  DEFAULT_QWEN_MODELS,
  DEFAULT_RAG_CONFIG,
} from "./defaults";

// ───────────────────────────────────────────────────────────────────
// Base config from defaults
// ───────────────────────────────────────────────────────────────────

/**
 * Build the base config from defaults WITHOUT caching.
 * @internal — used by file-loader.ts before the YAML merge.
 */
export function _buildConfigFromDefaults(): ApigentConfig {
  return {
    database: { provider: "postgresql", url: "" },
    llm: { provider: "qwen", apiKey: "", models: DEFAULT_QWEN_MODELS },
    // Clone shared constants so injectSecrets never mutates them.
    rag: structuredClone(DEFAULT_RAG_CONFIG),
    storage: { provider: "local", basePath: "./data/uploads" },
    queue: { provider: "postgres" },
    businessContext: {
      autoGenerate: false,
      batchSize: 5,
      concurrency: 2,
      minConfidence: 0.6,
      language: "auto",
      skipHumanEdited: true,
    },
    auth: { secret: "", providers: ["credentials"], sessionMaxAge: 604800 },
    mcp: { path: "/mcp", transport: "streamable-http" },
    observability: structuredClone(DEFAULT_OBSERVABILITY_CONFIG),
    apps: structuredClone(DEFAULT_APPS_CONFIG),
  };
}

// ───────────────────────────────────────────────────────────────────
// Shared singleton — used by both loaders
// ───────────────────────────────────────────────────────────────────

let _config: ApigentConfig | null = null;

/**
 * Get the currently loaded config.
 * Throws if {@link loadConfig} hasn't been called yet.
 */
export function getConfig(): ApigentConfig {
  if (!_config) {
    throw new Error("Config not loaded. Call loadConfig() from @apigent/core/config at startup.");
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
