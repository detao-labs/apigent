// ═══════════════════════════════════════════════════════════════════
// Apigent Config — File Loader (YAML)
// ═══════════════════════════════════════════════════════════════════
//
// Reads scheme choices from apigent.config.yaml and secrets from .env.
// Merges them into a typed ApigentConfig.
//
// Priority:
//   1. apigent.config.yaml / apigent.config.yml (scheme choices — providers, models, ports, strategies)
//   2. Hardcoded defaults
//
// Secrets (API keys, passwords, connection URLs) ALWAYS come from .env
// and are injected by name — the config file never inlines them.
// ═══════════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import type { ApigentConfig } from "./types";
import { ApigentConfigSchema } from "./schema";
import { _buildConfigFromDefaults, getConfig, resetConfig, setConfig } from "./loader";

// ───────────────────────────────────────────────────────────────────
// Config file discovery
// ───────────────────────────────────────────────────────────────────

const CONFIG_FILE_NAMES = ["apigent.config.yaml", "apigent.config.yml"] as const;

/**
 * Find the first existing config file from the default list.
 * Searches upward from `rootDir` (default: cwd) so that any app or script
 * inside the monorepo can resolve the repo-root config file.
 */
export function findConfigFile(rootDir?: string): string | null {
  const root = rootDir ?? process.cwd();
  for (const name of CONFIG_FILE_NAMES) {
    const filePath = findUp(root, name);
    if (filePath) return filePath;
  }
  return null;
}

/** Walk up from `startDir` until `fileName` is found or the filesystem root is reached. */
function findUp(startDir: string, fileName: string): string | null {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, fileName);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// ───────────────────────────────────────────────────────────────────
// YAML parsing
// ───────────────────────────────────────────────────────────────────

/**
 * Parse a YAML string into an object.
 * Uses the `yaml` package (declared dependency) — full YAML 1.2 support.
 */
function parseYAML(content: string): Record<string, unknown> {
  const parsed = parseYaml(content);
  if (parsed === null || parsed === undefined) return {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("apigent.config.yaml must contain a top-level mapping (object).");
  }
  return parsed as Record<string, unknown>;
}

// ───────────────────────────────────────────────────────────────────
// Deep merge — file config overrides env config
// ───────────────────────────────────────────────────────────────────

function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const result = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || value === null) continue;

    const existing = (result as Record<string, unknown>)[key];
    if (
      typeof existing === "object" &&
      existing !== null &&
      !Array.isArray(existing) &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        existing as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
}

// ───────────────────────────────────────────────────────────────────
// Secrets injection — fill in API keys from .env
// ───────────────────────────────────────────────────────────────────

/**
 * Inject secrets from environment variables into the config.
 * The file config only references provider names; actual keys come from .env.
 */
function injectSecrets(config: ApigentConfig): ApigentConfig {
  // LLM — API keys
  const llmApiKeyMap: Record<string, string> = {
    qwen: "DASHSCOPE_API_KEY",
    claude: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const llmEnvKey = llmApiKeyMap[config.llm.provider];
  if (llmEnvKey && process.env[llmEnvKey]) {
    (config.llm as unknown as Record<string, unknown>).apiKey = process.env[llmEnvKey];
  }

  // Embedding — API keys
  const embApiKeyMap: Record<string, string> = {
    qwen: "DASHSCOPE_API_KEY",
    claude: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
  };
  const embEnvKey = embApiKeyMap[config.rag.embedding.provider];
  if (embEnvKey && process.env[embEnvKey]) {
    (config.rag.embedding as unknown as Record<string, unknown>).apiKey =
      process.env[embEnvKey];
  }
  if (config.rag.embedding.provider === "cohere" && process.env.APIGENT_COHERE_API_KEY) {
    (config.rag.embedding as unknown as Record<string, unknown>).apiKey =
      process.env.APIGENT_COHERE_API_KEY;
  }

  // Reranker — Cohere API key
  if (config.rag.retrieval.reranker.provider === "cohere" && process.env.APIGENT_COHERE_API_KEY) {
    (config.rag.retrieval.reranker as unknown as Record<string, unknown>).apiKey =
      process.env.APIGENT_COHERE_API_KEY;
  }
  if (config.rag.retrieval.reranker.provider === "qwen" && process.env.DASHSCOPE_API_KEY) {
    (config.rag.retrieval.reranker as unknown as Record<string, unknown>).apiKey =
      process.env.DASHSCOPE_API_KEY;
  }

  // Auth secrets
  if (process.env.APIGENT_AUTH_SECRET) {
    config.auth.secret = process.env.APIGENT_AUTH_SECRET;
  }
  // Create OAuth config objects based on the providers list (not pre-existing objects)
  if (config.auth.providers.includes("github")) {
    config.auth.github = {
      clientId: process.env.APIGENT_AUTH_GITHUB_ID ?? "",
      clientSecret: process.env.APIGENT_AUTH_GITHUB_SECRET ?? "",
    };
  }
  if (config.auth.providers.includes("google")) {
    config.auth.google = {
      clientId: process.env.APIGENT_AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.APIGENT_AUTH_GOOGLE_SECRET ?? "",
    };
  }

  // Storage — S3/MinIO credentials
  if (config.storage.provider === "s3" || config.storage.provider === "minio") {
    if (process.env.APIGENT_STORAGE_S3_ACCESS_KEY_ID) {
      (config.storage as unknown as Record<string, unknown>).accessKeyId =
        process.env.APIGENT_STORAGE_S3_ACCESS_KEY_ID;
    }
    if (process.env.APIGENT_STORAGE_S3_SECRET_ACCESS_KEY) {
      (config.storage as unknown as Record<string, unknown>).secretAccessKey =
        process.env.APIGENT_STORAGE_S3_SECRET_ACCESS_KEY;
    }
  }

  // Vector store secrets
  if (config.rag.vectorStore.provider === "milvus") {
    if (process.env.APIGENT_MILVUS_USER)
      (config.rag.vectorStore as unknown as Record<string, unknown>).user =
        process.env.APIGENT_MILVUS_USER;
    if (process.env.APIGENT_MILVUS_PASSWORD)
      (config.rag.vectorStore as unknown as Record<string, unknown>).password =
        process.env.APIGENT_MILVUS_PASSWORD;
  }
  if (config.rag.vectorStore.provider === "qdrant" && process.env.APIGENT_QDRANT_API_KEY) {
    (config.rag.vectorStore as unknown as Record<string, unknown>).apiKey =
      process.env.APIGENT_QDRANT_API_KEY;
  }
  if (config.rag.vectorStore.provider === "weaviate" && process.env.APIGENT_WEAVIATE_API_KEY) {
    (config.rag.vectorStore as unknown as Record<string, unknown>).apiKey =
      process.env.APIGENT_WEAVIATE_API_KEY;
  }
  if (config.rag.vectorStore.provider === "pinecone" && process.env.APIGENT_PINECONE_API_KEY) {
    (config.rag.vectorStore as unknown as Record<string, unknown>).apiKey =
      process.env.APIGENT_PINECONE_API_KEY;
  }

  // Connection URLs (always from env)
  if (process.env.APIGENT_DATABASE_URL) {
    config.database.url = process.env.APIGENT_DATABASE_URL;
  }
  if (process.env.APIGENT_REDIS_URL && config.queue.provider === "bullmq") {
    (config.queue as unknown as Record<string, unknown>).redisUrl = process.env.APIGENT_REDIS_URL;
  }
  if (process.env.APIGENT_RABBITMQ_URL && config.queue.provider === "rabbitmq") {
    (config.queue as unknown as Record<string, unknown>).url = process.env.APIGENT_RABBITMQ_URL;
  }

  return config;
}

// ───────────────────────────────────────────────────────────────────
// .env loading
// ───────────────────────────────────────────────────────────────────

/**
 * Load `<rootDir>/.env` into process.env (secrets only).
 * Existing shell environment variables take precedence — the file only
 * fills in missing values, matching Node's `--env-file` semantics.
 *
 * Uses `process.loadEnvFile()` when available (Node >= 20.12), with a
 * minimal KEY=VALUE fallback for older runtimes.
 */
function loadDotEnv(rootDir?: string): void {
  const root = rootDir ?? process.cwd();
  const envPath = findUp(root, ".env");
  if (!envPath) return;

  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(envPath);
    return;
  }

  for (const [key, value] of Object.entries(parseEnvFile(fs.readFileSync(envPath, "utf-8")))) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Minimal `.env` parser for older Node versions — supports comments,
 * blank lines, and single/double-quoted values. Not a full dotenv spec.
 */
function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

// ───────────────────────────────────────────────────────────────────
// Main Entry Point
// ───────────────────────────────────────────────────────────────────

/**
 * Load config from apigent.config.yaml with secrets from .env.
 *
 * This is the single entry point for Apigent configuration.
 *
 * Resolution order:
 *   1. Read apigent.config.yaml / .yml (first found)
 *   2. Fall back to env vars for any field not in the YAML file
 *   3. Inject secrets from .env (API keys, passwords, connection URLs)
 *   4. Apply hardcoded defaults for anything still missing
 *
 * Subsequent calls return the cached config.
 *
 * @param rootDir - Project root directory (default: cwd)
 * @returns Fully resolved ApigentConfig
 *
 * @example
 * ```ts
 * import { loadConfig } from "@apigent/core/config";
 * const config = loadConfig();
 * // → reads apigent.config.yaml + .env → ApigentConfig
 * ```
 */
export function loadConfig(rootDir?: string): ApigentConfig {
  // Return cached if already loaded
  try {
    return getConfig();
  } catch {
    // Not loaded yet — proceed
  }

  // Load .env before building the env-based base config, so secrets are
  // available even when the runtime didn't source them beforehand.
  loadDotEnv(rootDir);

  // 1. Build base from hardcoded defaults
  const baseConfig = _buildConfigFromDefaults();

  // 2. Try to read YAML config file
  const filePath = findConfigFile(rootDir);
  let mergedConfig = baseConfig;
  if (filePath) {
    const fileConfig = parseYAML(fs.readFileSync(filePath, "utf-8"));
    mergedConfig = deepMerge(
      baseConfig as unknown as Record<string, unknown>,
      fileConfig as Record<string, unknown>,
    ) as unknown as ApigentConfig;
  }

  // 3. Inject secrets from .env
  mergedConfig = injectSecrets(mergedConfig);

  // 4. Required secrets — fail fast with a readable error
  if (!mergedConfig.database.url) {
    throw new Error("Missing required secret: APIGENT_DATABASE_URL — set it in .env");
  }
  if (!mergedConfig.auth.secret) {
    throw new Error("Missing required secret: APIGENT_AUTH_SECRET — set it in .env");
  }

  // 5. Validate the fully-merged config before caching — wrong-typed YAML
  //    values and invalid provider names fail fast with a readable error.
  const validatedConfig = ApigentConfigSchema.parse(mergedConfig);

  // 6. Cache via shared singleton
  setConfig(validatedConfig);
  return validatedConfig;
}

// Re-export getConfig / resetConfig from loader for convenience
export { getConfig, resetConfig };
