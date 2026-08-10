# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Apigent is an API collaboration platform that annotates APIs with business context and semantic knowledge, then exposes them to AI Agents through the MCP (Model Context Protocol). Think "Postman but built for AI Agents" — APIs become machine-discoverable capabilities.

The project is in **early design/implementation phase** (V0). Most architecture exists in `docs/`; code under `packages/` is the beginning of implementation.

**Domain model terminology:** Organization (top-level tenant) → Repository (OpenAPI technical assets + version history); Project is an independent business entity that aggregates Repositories across Organizations (M:N). Project is model-only in V0, with features shipping in V1+. Technical/permission layer uses `repo_id`; business/knowledge layer uses `project_id`. Business knowledge is split into two layers: **Capability Context** (Repository-level, V0 — what the backend provides) and **Usage Context** (Project-level, V1+ — how a project uses each Repository's capabilities).

**Calling modes:** the platform exposes three surfaces — internal Webapps (session auth, Hono RPC typed client), external REST (OpenAPI spec, SecretKey `api:*` scopes), and external AI agents via MCP Gateway (SecretKey `mcp:*` scopes). All REST routes are defined with `@hono/zod-openapi`: one contract, with the public spec filtered to `public` routes only.

## Key Architecture Decisions

### Agent vs. Platform Service distinction

Not every module is an LLM-powered agent. The codebase has two categories:

- **Platform Service** (deterministic, TypeScript modules): OpenAPI parsing, knowledge graph construction, data aggregation, MCP protocol routing. No LLM involved.
- **AI Agent** (LLM-driven): Business context inference, semantic search. LLM calls only when deterministic rules can't solve the problem.

See `docs/modules/README.md` for the full rationale and component inventory.

### Configuration system — YAML + .env

Single entry point: `import { loadConfig } from "@apigent/core/config"`.

- `apigent.config.yaml` → scheme choices (which provider/model/strategy). Tracked in Git.
- `.env` → secrets only (API keys, passwords, connection URLs). Never committed.
- `apigent.config.ts` → programmatic overrides for custom provider implementations (advanced use only).

Config types live in `packages/core/src/config/types.ts` as discriminated unions — every infrastructure component (DB, vector store, LLM, embedding, storage, queue) can be swapped by changing config, not code. See `.env.example` and `apigent.config.example.yaml` for all available options.

### Extensibility — everything behind interfaces

All infrastructure concerns have TypeScript interfaces (`VectorStore`, `LLMProvider`, `EmbeddingProvider`, `StorageProvider`, `QueueProvider`) with default implementations. Business code never imports concrete implementations directly — it uses `getContainer().getVectorStore()` etc. See `docs/tech-design.md` Section 5.5.

### Bilingual documentation

All `docs/*.md` files have a `.zh.md` counterpart. Both must be kept in sync when documentation changes. The `common-docs-i18n` skill handles this.

## Technology Stack (V0)

| Layer         | Choice                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| API Server    | Hono (TypeScript, independent process — not bundled with Next.js)                                    |
| Webapps       | Next.js App Router (Platform + Admin, separate instances)                                            |
| Webapp ↔ API  | REST + Hono RPC (`hc`) + OpenAPI (Zod schemas); public REST uses SecretKey `api:*`, MCP uses `mcp:*` |
| Database      | PostgreSQL + Drizzle ORM                                                                             |
| Vector store  | pgvector (swappable to Milvus/Qdrant/etc.)                                                           |
| LLM           | Qwen API (DashScope; swappable to Claude/OpenAI/Gemini/Ollama)                                       |
| Embedding     | Qwen text-embedding-v4 (DashScope)                                                                   |
| Async tasks   | BullMQ + Redis                                                                                       |
| Auth          | NextAuth.js with RBAC                                                                                |
| MCP transport | Streamable HTTP (`@modelcontextprotocol/sdk`)                                                        |

## Port Conventions

| Port | Service                   |
| ---- | ------------------------- |
| 3000 | Platform Webapp (Next.js) |
| 3001 | Admin Webapp (Next.js)    |
| 3002 | Core API Server (Hono)    |

## Key Documentation Files

- `docs/blueprint.md` — product vision, roadmap V0-V2, domain model, non-goals
- `docs/tech-design.md` — platform architecture, RBAC model, technology choices, extensibility system
- `docs/modules/README.md` — Agent vs. Service distinction, component inventory, MCP tool definitions
- `docs/modules/*.agent.md` — AI Agent design docs (LLM-driven)
- `docs/modules/*.md` (no `.agent.`) — Platform Service design docs (deterministic)

## Package Structure & Import Conventions

Only `@apigent/core` exists so far. There is **no root `package.json`** — each package is self-contained. Work inside the package directory:

```bash
cd packages/core
pnpm typecheck    # tsc --noEmit
```

All packages follow this pattern from `packages/core/package.json`:

- `main`/`types`/`exports` point to TypeScript source (no build step yet — runtimes consume `.ts` directly via ts-node/tsx/bun).
- Subpath exports (e.g., `@apigent/core/config`) map to barrel files under `src/config/index.ts`.
- Barrel exports re-export types separately from values — types are `export type { ... }` to avoid runtime import errors.

## Config Module Architecture

The config system is the first (and currently only) implemented module. It has three layers:

| File             | Role                                                                                            | Public?                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `types.ts`       | Discriminated unions for every infrastructure component                                         | Yes — all types re-exported                             |
| `loader.ts`      | Reads `process.env` (with `APIGENT_` prefix), builds typed config objects, manages singleton    | Internal only (`_buildConfigFromEnv`, `setConfig`)      |
| `file-loader.ts` | Reads `apigent.config.yaml` + calls loader + injects secrets from `.env` → caches via singleton | **Yes — `loadConfig()` is the only public entry point** |
| `defaults.ts`    | Per-provider default model maps and dev defaults                                                | Yes                                                     |

**Resolution priority:** YAML file > env vars > hardcoded defaults. Secrets (API keys, passwords, URLs) are **never** in defaults or YAML — they come exclusively from `process.env` / `.env` via `injectSecrets()`.

**Notable:** `file-loader.ts` includes a built-in simple YAML parser as a fallback when neither `yaml` nor `js-yaml` packages are installed. It handles the Apigent config subset (scalars, nested objects, arrays, comments) and avoids a mandatory dependency for config loading alone.

**Env var naming convention:** `APIGENT_<CATEGORY>_<KEY>` (e.g., `APIGENT_DATABASE_URL`, `APIGENT_LLM_PROVIDER`, `APIGENT_RAG_COARSE_RANK_TOP_K`). Third-party keys use their standard names (`DASHSCOPE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).

## Available Commands

| Command          | Where            | Description                          |
| ---------------- | ---------------- | ------------------------------------ |
| `pnpm typecheck` | `packages/core/` | Run `tsc --noEmit` for type-checking |

There is no build system (turborepo/nx), no linter, no test framework, and no root `package.json` configured yet. When adding tooling, follow the monorepo pattern established by `packages/core/package.json`.

## Current State

No working application yet. What exists:

- `packages/core/src/config/` — fully typed configuration system (the first implemented module)
- Design documents covering the full V0 architecture
- `tsconfig.base.json` at root, per-package tsconfigs extending it
