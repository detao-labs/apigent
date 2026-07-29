// ═══════════════════════════════════════════════════════════════════
// Apigent Config — File Loader (YAML)
// ═══════════════════════════════════════════════════════════════════
//
// Reads scheme choices from apigent.config.yaml and secrets from .env.
// Merges them into a typed ApigentConfig.
//
// Priority:
//   1. apigent.config.yaml  (if exists)
//   2. apigent.config.yml   (if exists)
//   3. Environment variables (as fallback for any missing field)
//   4. Hardcoded defaults
//
// Secrets (API keys, passwords) ALWAYS come from process.env / .env
// — the config file references them by name, never inlines them.
// ═══════════════════════════════════════════════════════════════════

import * as fs from "node:fs";
import * as path from "node:path";
import type { ApigentConfig } from "./types";
import {
  _buildConfigFromEnv,
  getConfig,
  resetConfig,
  setConfig,
} from "./loader";

// ───────────────────────────────────────────────────────────────────
// Config file discovery
// ───────────────────────────────────────────────────────────────────

const CONFIG_FILE_NAMES = [
  "apigent.config.yaml",
  "apigent.config.yml",
] as const;

/**
 * Find the first existing config file from the default list.
 * Searches from `rootDir` (default: cwd).
 */
export function findConfigFile(rootDir?: string): string | null {
  const root = rootDir ?? process.cwd();
  for (const name of CONFIG_FILE_NAMES) {
    const filePath = path.join(root, name);
    if (fs.existsSync(filePath)) {
      return filePath;
    }
  }
  return null;
}

// ───────────────────────────────────────────────────────────────────
// YAML parsing
// ───────────────────────────────────────────────────────────────────

/**
 * Parse a YAML string into an object.
 * Tries to use the `yaml` package if available, otherwise falls back
 * to a built-in simple parser (handles the common Apigent config subset).
 */
function parseYAML(content: string): Record<string, unknown> {
  // Try external YAML parser first
  try {
    const yaml = require("yaml");
    return yaml.parse(content) ?? {};
  } catch {
    // Fall through
  }

  try {
    const jsYaml = require("js-yaml");
    return jsYaml.load(content) ?? {};
  } catch {
    // Fall through
  }

  // Built-in simple YAML parser — handles Apigent's config subset:
  // - key: value pairs (scalars, numbers, booleans, quoted strings)
  // - nested objects (indented blocks)
  // - arrays ( - item)
  // - comments (#)
  return parseSimpleYAML(content);
}

/**
 * Simple YAML parser for Apigent config files.
 * Handles the common subset: scalars, objects, arrays, comments.
 * Not a full YAML 1.2 spec — but sufficient for apigent.config.yaml.
 */
function parseSimpleYAML(content: string): Record<string, unknown> {
  const lines = content.split("\n");
  const result: Record<string, unknown> = {};
  const stack: Array<{
    key: string;
    obj: Record<string, unknown>;
    indent: number;
  }> = [];
  let currentObj = result;

  for (const rawLine of lines) {
    // Strip comments
    const commentIdx = rawLine.indexOf("#");
    const line = commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine;

    // Skip empty lines
    if (line.trim() === "") continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    // Array item: - value
    if (trimmed.startsWith("- ")) {
      const value = parseYamlValue(trimmed.slice(2).trim());
      const lastKey = stack.length > 0 ? stack[stack.length - 1].key : "";
      const target = stack.length > 0 ? stack[stack.length - 1].obj : currentObj;
      const existing = target[lastKey];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        target[lastKey] = [value];
      }
      continue;
    }

    // Pop stack based on indentation
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    // Key: value
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const valueStr = trimmed.slice(colonIdx + 1).trim();

    const target = stack.length > 0 ? stack[stack.length - 1].obj : currentObj;

    if (valueStr === "" || valueStr === "{}") {
      // Nested object starts
      const nested: Record<string, unknown> = {};
      target[key] = nested;
      stack.push({ key, obj: nested, indent });
    } else {
      target[key] = parseYamlValue(valueStr);
    }
  }

  return result;
}

function parseYamlValue(value: string): unknown {
  // boolean
  if (value === "true" || value === "True" || value === "TRUE") return true;
  if (value === "false" || value === "False" || value === "FALSE") return false;
  // null
  if (value === "null" || value === "Null" || value === "NULL" || value === "~") return null;
  // number
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  // quoted string
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
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
    claude: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
    gemini: "GEMINI_API_KEY",
  };
  const llmEnvKey = llmApiKeyMap[config.llm.provider];
  if (llmEnvKey && process.env[llmEnvKey]) {
    (config.llm as Record<string, unknown>).apiKey = process.env[llmEnvKey];
  }

  // Embedding — API keys
  const embApiKeyMap: Record<string, string> = {
    claude: "ANTHROPIC_API_KEY",
    openai: "OPENAI_API_KEY",
  };
  const embEnvKey = embApiKeyMap[config.embedding.provider];
  if (embEnvKey && process.env[embEnvKey]) {
    (config.embedding as Record<string, unknown>).apiKey = process.env[embEnvKey];
  }
  if (config.embedding.provider === "cohere" && process.env.APIGENT_COHERE_API_KEY) {
    (config.embedding as Record<string, unknown>).apiKey = process.env.APIGENT_COHERE_API_KEY;
  }

  // Reranker — Cohere API key
  if (config.rag.reranker.provider === "cohere" && process.env.APIGENT_COHERE_API_KEY) {
    (config.rag.reranker as Record<string, unknown>).apiKey = process.env.APIGENT_COHERE_API_KEY;
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
  if (
    (config.storage.provider === "s3" || config.storage.provider === "minio")
  ) {
    if (process.env.APIGENT_STORAGE_S3_ACCESS_KEY_ID) {
      (config.storage as Record<string, unknown>).accessKeyId = process.env.APIGENT_STORAGE_S3_ACCESS_KEY_ID;
    }
    if (process.env.APIGENT_STORAGE_S3_SECRET_ACCESS_KEY) {
      (config.storage as Record<string, unknown>).secretAccessKey = process.env.APIGENT_STORAGE_S3_SECRET_ACCESS_KEY;
    }
  }

  // Vector store secrets
  if (config.vectorStore.provider === "milvus") {
    if (process.env.APIGENT_MILVUS_USER) (config.vectorStore as Record<string, unknown>).user = process.env.APIGENT_MILVUS_USER;
    if (process.env.APIGENT_MILVUS_PASSWORD) (config.vectorStore as Record<string, unknown>).password = process.env.APIGENT_MILVUS_PASSWORD;
  }
  if (config.vectorStore.provider === "qdrant" && process.env.APIGENT_QDRANT_API_KEY) {
    (config.vectorStore as Record<string, unknown>).apiKey = process.env.APIGENT_QDRANT_API_KEY;
  }
  if (config.vectorStore.provider === "weaviate" && process.env.APIGENT_WEAVIATE_API_KEY) {
    (config.vectorStore as Record<string, unknown>).apiKey = process.env.APIGENT_WEAVIATE_API_KEY;
  }
  if (config.vectorStore.provider === "pinecone" && process.env.APIGENT_PINECONE_API_KEY) {
    (config.vectorStore as Record<string, unknown>).apiKey = process.env.APIGENT_PINECONE_API_KEY;
  }

  // Connection URLs (always from env)
  if (process.env.APIGENT_DATABASE_URL) {
    config.database.url = process.env.APIGENT_DATABASE_URL;
  }
  if (process.env.APIGENT_REDIS_URL && config.queue.provider === "bullmq") {
    (config.queue as Record<string, unknown>).redisUrl = process.env.APIGENT_REDIS_URL;
  }
  if (process.env.APIGENT_RABBITMQ_URL && config.queue.provider === "rabbitmq") {
    (config.queue as Record<string, unknown>).url = process.env.APIGENT_RABBITMQ_URL;
  }

  return config;
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

  // 1. Build base from env vars
  const baseConfig = _buildConfigFromEnv();

  // 2. Try to read YAML config file
  const filePath = findConfigFile(rootDir);
  let mergedConfig = baseConfig;
  if (filePath) {
    const fileConfig = parseYAML(fs.readFileSync(filePath, "utf-8"));
    mergedConfig = deepMerge(baseConfig, fileConfig as Record<string, unknown>);
  }

  // 3. Inject secrets from .env
  mergedConfig = injectSecrets(mergedConfig);

  // 4. Cache via shared singleton
  setConfig(mergedConfig);
  return mergedConfig;
}

// Re-export getConfig / resetConfig from loader for convenience
export { getConfig, resetConfig };
