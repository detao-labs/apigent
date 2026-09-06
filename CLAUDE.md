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

> **Implementation status:** the config + DI scaffolding is in place, but only the `memory` vector store, `local` storage, and Postgres queue providers are registered. LLM, Embedding, pgvector, BullMQ, and the MCP Gateway are defined in config/types but have no factory yet — `getLLM()`, `getEmbedding()`, `getVectorStore()` (non-`memory`), and `getQueue()` (non-`postgres`/`memory`) fail fast with `not implemented` (see the fail-fast tests in `packages/core/src/di/container.test.ts`).

### Bilingual documentation

`docs/*.md` files should have a `.zh.md` counterpart, and both must stay in sync when documentation changes (the `common-docs-i18n` skill handles this). Note: only `docs/blueprint.md` and `docs/tech-design.md` currently have `.zh.md`; the `docs/modules/*` docs are English-only as of now.

## Technology Stack (V0)

| Layer         | Choice                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| API Server    | Hono (TypeScript, independent process — not bundled with Next.js)                                         |
| Webapps       | Next.js App Router (Platform + Admin, separate instances)                                                 |
| Webapp ↔ API  | REST + Hono RPC (`hc`) + OpenAPI (Zod schemas); public REST uses SecretKey `api:*`, MCP uses `mcp:*`        |
| Database      | PostgreSQL + Drizzle ORM                                                                                  |
| Vector store  | `memory` (implemented, dev/tests); `pgvector` is the V0 target — not yet implemented                       |
| LLM           | Config-target `qwen` (Claude/OpenAI/Gemini/Ollama selectable); only a stub exists — `getLLM()` throws       |
| Embedding     | Config-target `qwen` text-embedding-v4; only a stub exists — `getEmbedding()` throws                        |
| Async tasks   | Postgres queue (implemented V0 default); BullMQ + Redis is the scale target — not yet implemented           |
| Auth          | NextAuth.js with RBAC                                                                                     |
| MCP transport | Streamable HTTP (`@modelcontextprotocol/sdk`) — config scaffold only, Gateway not implemented yet           |

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

The workspace is a pnpm monorepo with a root `package.json` (scripts: `typecheck`, `lint`, `test`, `format`) — `packages/core` plus the `apps/*` shells. Most work happens inside a package directory:

```bash
cd packages/core
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint src/
pnpm test         # vitest run
```

All packages follow this pattern from `packages/core/package.json`:

- `main`/`types`/`exports` point to TypeScript source (no build step yet — runtimes consume `.ts` directly via ts-node/tsx/bun).
- Subpath exports (e.g., `@apigent/core/config`) map to barrel files under `src/config/index.ts`.
- Barrel exports re-export types separately from values — types are `export type { ... }` to avoid runtime import errors.

## Config Module Architecture

The config system is the first implemented module. It has three layers:

| File             | Role                                                                                            | Public?                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `types.ts`       | Discriminated unions for every infrastructure component                                         | Yes — all types re-exported                             |
| `loader.ts`      | Builds the base config from hardcoded defaults (no env reads), manages singleton                 | Internal only (`_buildConfigFromDefaults`, `setConfig`) |
| `file-loader.ts` | Reads `apigent.config.yaml` + calls loader + injects secrets from `.env` → caches via singleton | **Yes — `loadConfig()` is the only public entry point** |
| `schema.ts`      | Zod schemas mirroring `types.ts`; `loadConfig()` validates the merged config before caching    | Yes — `ApigentConfigSchema` re-exported                 |
| `defaults.ts`    | Per-provider default model maps + default RAG/apps config                                        | Yes                                                     |

**Resolution priority:** `apigent.config.yaml` > hardcoded defaults. There are **no env-var scheme overrides** — providers, models, ports and strategies come exclusively from the YAML. Secrets (API keys, passwords, connection URLs) are **never** in defaults or YAML — they come exclusively from `.env` via `injectSecrets()`.

**Notable:** `yaml` is a declared dependency (full YAML 1.2 parsing). `loadConfig()` loads `<rootDir>/.env` into `process.env` (shell env wins), then validates the fully-merged config with the zod `ApigentConfigSchema` — wrong-typed YAML values and unknown provider names fail at startup with a readable error.

**Env var naming convention:** `.env` holds **secrets only** — `APIGENT_<CATEGORY>_<KEY>` (e.g., `APIGENT_DATABASE_URL`, `APIGENT_AUTH_SECRET`) and third-party keys using their standard names (`DASHSCOPE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Provider/scheme choices live only in `apigent.config.yaml`. (Note: the header comment in `packages/core/src/config/types.ts` mentions `APIGENT_*_PROVIDER` env overrides, but no such override is implemented.)

## Available Commands

| Command          | Where            | Description                          |
| ---------------- | ---------------- | ------------------------------------ |
| `pnpm typecheck` | `packages/core/` | Run `tsc --noEmit` for type-checking |
| `pnpm lint`      | `packages/core/` | Run ESLint over `src/`               |
| `pnpm test`      | `packages/core/` | Run Vitest                           |
| `pnpm -r <cmd>`  | root             | Run a script across all packages     |

There is no build system (turborepo/nx) — TypeScript sources are consumed directly via tsx/ts-node. When adding tooling, follow the monorepo pattern established by `packages/core/package.json`.

### Database (Drizzle)

| Command             | Description                                      |
| ------------------- | ------------------------------------------------ |
| `pnpm db:generate`  | Generate a migration from schema changes         |
| `pnpm db:migrate`   | Apply pending migrations to the database         |
| `pnpm db:push`      | Push schema directly to the DB (dev only)        |
| `pnpm db:check`     | Compare schema vs DB state                       |
| `pnpm db:seed`      | Seed development data (packages/server seed)     |
| `pnpm db:studio`    | Open Drizzle Studio                              |

**Migration naming:** drizzle-kit auto-generates random `NNNN_adjective_hero` names by default. Prefer explicit names for reviewability (e.g. `0000_init`):

```bash
pnpm db:generate -- --name=add_users   # → 0001_add_users.sql
```

The Drizzle schema and migrations live in `packages/server` (`drizzle.config.ts` + `drizzle/`). The connection URL comes from `APIGENT_DATABASE_URL` (root `.env`), resolved through `@apigent/core/config`.

## Current State

Working apps and server modules exist (V0 is further along than the earliest config/DI scaffolding):

- `apps/platform` — Platform Webapp (Next.js SSR, port 3000): repos, endpoints, schemas, versions, settings, context pages.
- `apps/admin` — Admin Webapp (Next.js SSR, port 3001): audit, users, settings, stats.
- `apps/open` — Hono REST gateway (port 3002); currently serves `/` and `/health` only. No MCP endpoint yet.
- `packages/core` — config (`loadConfig()`: YAML + `.env` + zod), fail-fast DI container, types, i18n, agent registry.
- `packages/server` — Drizzle schema + migrations, Postgres queue, OpenAPI parser, contexts, versions, imports, auth/authz, notifications, logging.
- `packages/ui` — shadcn/ui components (Base UI + Tailwind v4).
- Tests (Vitest) for `packages/core` config/DI and `packages/server` modules.
- `tsconfig.base.json` at root, with per-package tsconfigs extending it.

Not yet implemented (designed only): MCP Gateway, and the LLM / Embedding / pgvector / BullMQ providers.
