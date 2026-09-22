# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Apigent is an API collaboration platform that annotates APIs with business context and semantic knowledge, then exposes them to AI Agents through the MCP (Model Context Protocol). Think "Postman but built for AI Agents" — APIs become machine-discoverable capabilities.

The project is in **early design/implementation phase** (V0). Most architecture exists in `docs/`; code under `packages/` is the beginning of implementation.

**Domain model terminology:** Organization (top-level tenant) → Repository (OpenAPI technical assets + version history); Project is an independent business entity that aggregates Repositories across Organizations (M:N). Project is model-only in V0, with features shipping in V1+. Technical/permission layer uses `repository_id`; business/knowledge layer uses `project_id`. Business knowledge is split into two layers: **Capability Context** (Repository-level, V0 — what the backend provides) and **Usage Context** (Project-level, V1+ — how a project uses each Repository's capabilities).

**Calling modes:** the platform exposes three surfaces — internal Webapps (session cookie; the browser calls Next.js Route Handlers that invoke `@apigent/server` in-process), external REST (OpenAPI spec + SecretKey `api:*` scopes — spec is exported, not served yet), and external AI agents via the MCP Gateway (SecretKey `mcp:*` scopes — V1, not implemented). There is **no `@hono/zod-openapi` contract layer**: the Route Handlers validate with shared Zod schemas, and the OpenAPI 3.1 document is generated offline from those same schemas by `zod-openapi`.

**Application map:** `apps/platform` and `apps/admin` are **Next.js** apps (Platform also hosts the Platform REST API as Route Handlers); `apps/open` is the **Hono** process — the only non-Next.js runtime, reserved for the machine-facing Open Gateway.

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

All infrastructure concerns have TypeScript interfaces (`VectorStore`, `StorageProvider`, `QueueProvider`) with default implementations. Business code never imports concrete implementations directly — it uses `getContainer().getVectorStore()` etc. See `docs/tech-design.md` Section 5.5.

> **Implementation status:** the config + DI scaffolding is in place, but only the `memory` vector store, `local` storage, and Postgres queue providers are registered. pgvector, BullMQ, and the MCP Gateway are defined in config/types but have no factory yet — `getVectorStore()` (non-`memory`) and `getQueue()` (non-`postgres`/`memory`) fail fast with `not implemented` (see the fail-fast tests in `packages/core/src/di/container.test.ts`). **LLM calls do work** — product code (business-context generation, agent runtime) uses `createLanguageModel()` from `@apigent/core/ai` on the Vercel AI SDK. Note: the container used to expose `getLLM()` / `getEmbedding()` fail-fast stubs; they were **removed** and LLM/embedding now live in `@apigent/core/ai` (see `docs/modules/rag-package.md` §9 A1).

### Bilingual documentation

`docs/*.md` files should have a `.zh.md` counterpart, and both must stay in sync when documentation changes (the `common-docs-i18n` skill handles this). Note: only `docs/blueprint.md` and `docs/tech-design.md` currently have `.zh.md`; the `docs/modules/*` docs are English-only as of now.

## External Surface Naming

**One rule: everything is `camelCase` except the MCP tool name.**

| Surface                                                                                   | Convention   |
| ----------------------------------------------------------------------------------------- | ------------ |
| MCP tool **name**                                                                         | `snake_case` |
| MCP tool **parameters** (`inputSchema.properties`)                                        | `camelCase`  |
| Platform REST JSON (`apps/platform/src/lib/openapi-schemas.ts` → `openapi/platform.json`) | `camelCase`  |
| Internal TS types                                                                         | `camelCase`  |

Why the tool name is the lone exception — it and the parameter names play different roles:

- The **tool name is an identifier on the protocol surface**: it shows up in client configs, allowlists, log lines and audit trails, and it shares a namespace with other servers (clients aggregating several servers often prefix it). Cross-system identifiers follow ecosystem convention, and mainstream MCP servers use `snake_case` names.
- **Parameter names are this server's own data contract** — plain JSON Schema `properties` with no cross-server namespace. Using local idiom costs nothing and lets them match the internal types, avoiding a field-name mapping layer.

**What the MCP spec actually says** (`server/tools` → "Tool Names"): tool names SHOULD be 1–128 characters, case-sensitive, restricted to `[A-Za-z0-9_.-]`, and unique within a server. The spec is **casing-neutral** — its own examples include `getUser` and `DATA_EXPORT_v2` — and it says **nothing at all about parameter names**: `inputSchema` is handed to JSON Schema and the `properties` keys are the server's choice. So the split above is _our_ convention, not a spec requirement.

> Consequence worth knowing: keeping parameter names in `camelCase` means the existing agent tools in `packages/core` (`get_endpoint_spec` with `repositoryId`) already conform — no migration needed, and no breaking change to tool calls an LLM has already learned.

## Technology Stack (V0)

| Layer         | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Webapps       | Next.js 15 App Router + React 19 — Platform (:3000) and Admin (:3001), separate instances; `dev` runs Turbopack                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Platform API  | Next.js Route Handlers (`apps/platform/src/app/api/**`, `withRoute` wrapper) calling `@apigent/server` services in-process                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Open Gateway  | Hono (`apps/open`, :3002) — separate process; `/` + `/health` only, MCP endpoint not mounted yet                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| API contract  | Zod schemas in the Route Handlers; OpenAPI 3.1 document generated offline via `zod-openapi` (`openapi:platform` → `apps/platform/openapi/platform.json`)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Database      | PostgreSQL + Drizzle ORM                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Vector store  | `memory` (implemented, dev/tests); `pgvector` is the V0 target — schema columns exist, provider not wired                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| LLM           | Vercel AI SDK (`@ai-sdk/openai-compatible`) → `qwen` (DashScope); `openai`/`ollama` selectable, `claude`/`gemini` throw. Single entry point `@apigent/core/ai`（`createLanguageModel(flow)` + provider 传输层）；`@apigent/server/ai` 是兼容 re-export                                                                                                                                                                                                                                                                                                                    |
| Embedding     | Config-target `qwen` text-embedding-v4; 尚未实现。embedding 模型工厂属于 RAG 专属能力，将随 `@apigent/rag` 落地（不放在 core）                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Async tasks   | Postgres queue (implemented V0 default); BullMQ + Redis is the scale target — not yet implemented                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Auth          | Auth.js v5 (NextAuth `5.0.0-beta.32`) credentials provider with JWT sessions. **Two independent instances:** Platform signs `apigent.*` cookies with `auth.secret`, Admin signs `apigent-admin.*` cookies with `auth.adminSecret` — including the Auth.js helper cookies (csrf / callbackUrl / state / pkce / nonce), because cookies are shared across ports on the same host. Authorization stays in `packages/server` and only ever sees a `userId`; roles never enter the token. Third-party providers (GitHub/Google) are not wired yet (docs/tech-design.md 5.4.9). |
| Authorization | Two independent systems in `packages/server/src/authz`: **tenant** roles (`org_*` / `repo_*`, rank-based, inheritance + per-repo override) and **admin** roles (`admin_super`, instance-scoped — design only). See `docs/tech-design.md` §2.8                                                                                                                                                                                                                                                                                                                             |
| MCP transport | Streamable HTTP (`@modelcontextprotocol/sdk`) — config scaffold + dependency only, Gateway not implemented yet                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Port Conventions

Listening ports are set on the launch command, not in `apigent.config.yaml`:

| Port | Service                   | Set by                         |
| ---- | ------------------------- | ------------------------------ |
| 3000 | Platform Webapp (Next.js) | `next dev/start -p 3000`       |
| 3001 | Admin Webapp (Next.js)    | `next dev/start -p 3001`       |
| 3002 | Open Gateway (Hono)       | `tsx src/index.ts --port 3002` |

Platform and Admin are Next.js processes that also serve their own Route Handlers; `apps/open` is the single Hono process.

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
- **Client components must never value-import from a barrel that (transitively) touches `@apigent/server/db`.** `next build` resolves the whole client graph, so importing e.g. `REPO_ROLES` from `@apigent/server/authz` pulls `pg` and node builtins into the browser bundle and fails with `Module not found: Can't resolve 'fs'`. Type-only imports (`import type { ... }`) are erased and safe. When a client component needs a value, add a dependency-free leaf subpath — `@apigent/server/authz/roles` is the example — and keep that module's imports at zero.

## Config Module Architecture

The config system is the first implemented module. It has three layers:

| File             | Role                                                                                            | Public?                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `types.ts`       | Discriminated unions for every infrastructure component                                         | Yes — all types re-exported                             |
| `loader.ts`      | Builds the base config from hardcoded defaults (no env reads), manages singleton                | Internal only (`_buildConfigFromDefaults`, `setConfig`) |
| `file-loader.ts` | Reads `apigent.config.yaml` + calls loader + injects secrets from `.env` → caches via singleton | **Yes — `loadConfig()` is the only public entry point** |
| `schema.ts`      | Zod schemas mirroring `types.ts`; `loadConfig()` validates the merged config before caching     | Yes — `ApigentConfigSchema` re-exported                 |
| `defaults.ts`    | Per-provider default model maps + default RAG/apps config                                       | Yes                                                     |

**Resolution priority:** `apigent.config.yaml` > hardcoded defaults. There are **no env-var scheme overrides** — providers, models and strategies come exclusively from the YAML. Secrets (API keys, passwords, connection URLs) are **never** in defaults or YAML — they come exclusively from `.env` via `injectSecrets()`. Listening ports are the one exception to "config drives everything": they belong to the launch command (see Port Conventions), so `apps.*` only carries `logLevel`.

**Notable:** `yaml` is a declared dependency (full YAML 1.2 parsing). `loadConfig()` loads `<rootDir>/.env` into `process.env` (shell env wins), then validates the fully-merged config with the zod `ApigentConfigSchema` — wrong-typed YAML values and unknown provider names fail at startup with a readable error.

**Adding a new config slot — the four-place rule:** `ApigentConfigSchema` is `.strict()`, so a slot that exists in `types.ts` but not in `schema.ts` (or vice versa) either fails validation or silently strips the YAML value. Always touch all four:

| #   | File                                   | What to add                                                                 |
| --- | -------------------------------------- | --------------------------------------------------------------------------- |
| 1   | `packages/core/src/config/types.ts`    | the TypeScript type (add to the component's interface / union)              |
| 2   | `packages/core/src/config/schema.ts`   | the zod schema entry — `.strict()` means a missing entry is a startup error |
| 3   | `packages/core/src/config/defaults.ts` | the default value (`DEFAULT_*` constant)                                    |
| 4   | `apigent.config.example.yaml`          | the documented, commented example users copy from                           |

Two more only when they apply:

- **secret-backed slot** → also wire it in `packages/core/src/config/file-loader.ts` `injectSecrets()` (env var name must follow the convention below; **never** put the secret in `defaults.ts` or the YAML).
- **consumed slot** → also update whatever reads it. A slot nobody reads is worse than no slot: `rag.vectorStore.indexType` shipped with a type, a schema entry, a default and documented YAML — but **no code reads it at all**, so changing it in YAML does nothing (and the default even disagreed with the migration's actual index). Grep the field name before calling the work done.

Verify with `pnpm --filter @apigent/core test` (there are config schema/loader tests) — the schema tests are the fastest way to catch a missed entry.

**Env var naming convention:** `.env` holds **secrets only** — `APIGENT_<CATEGORY>_<KEY>` (e.g., `APIGENT_DATABASE_URL`, `APIGENT_AUTH_SECRET`) and third-party keys using their standard names (`DASHSCOPE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`). Provider/scheme choices live only in `apigent.config.yaml`. (Note: the header comment in `packages/core/src/config/types.ts` mentions `APIGENT_*_PROVIDER` env overrides, but no such override is implemented.)

## Available Commands

| Command          | Where            | Description                          |
| ---------------- | ---------------- | ------------------------------------ |
| `pnpm typecheck` | `packages/core/` | Run `tsc --noEmit` for type-checking |
| `pnpm lint`      | `packages/core/` | Run ESLint over `src/`               |
| `pnpm test`      | `packages/core/` | Run Vitest                           |
| `pnpm -r <cmd>`  | root             | Run a script across all packages     |
| `pnpm build`     | root             | Production build (`pnpm -r build`)   |

### Build & bundling

- **No orchestration layer** (turborepo/nx): `pnpm -r` already runs scripts in topological order, and since packages ship TypeScript sources (no compile step) there are few artifacts to cache. Revisit only when multi-package production builds make build time the bottleneck (`docs/agent-prd.md` §2).
- **Root `pnpm build`** fans out to every package that defines a `build` script — currently `apps/platform` and `apps/admin` (`next build`). Libraries under `packages/*` have no `build` on purpose: `main`/`exports` point at `src/**/*.ts` and runtimes consume the sources directly via tsx/bun.
- **Bundler choice:** `next build` runs on webpack. Turbopack (`--turbopack`) is enabled for `dev` in both webapps; the build path stays on webpack until Next.js promotes Turbopack builds out of alpha (Next 16). Measured on this repo: compile 18.4s → 7.0s and dev `Ready` 1.9s → 0.9s, not worth running alpha in production for apps this size.
- **Hono gateway** (`apps/open`) currently runs from source via tsx in both dev and start; the PRD target is an esbuild single-file bundle for production (`docs/agent-prd.md` §2) — not implemented yet.

When adding tooling, follow the monorepo pattern established by `packages/core/package.json`.

**Reserved route paths:** do not create an App Router page at `/500` (or `/404`). Next.js maps those URLs to the built-in `_error` page (`defaultMap['/500'] = { page: '/_error' }` in `build/index.js`) and `next build` fails with `ENOENT ... rename '.next/export/500.html'`. The platform's database-down page therefore lives at `/server-error`.

### Database (Drizzle)

| Command            | Description                                  |
| ------------------ | -------------------------------------------- |
| `pnpm db:generate` | Generate a migration from schema changes     |
| `pnpm db:migrate`  | Apply pending migrations to the database     |
| `pnpm db:push`     | Push schema directly to the DB (dev only)    |
| `pnpm db:check`    | Compare schema vs DB state                   |
| `pnpm db:seed`     | Seed development data (packages/server seed) |
| `pnpm db:studio`   | Open Drizzle Studio                          |

**Granting a platform admin** (the first `admin_super` can only come from here — the Admin Webapp is gated by `admin_members`, so nobody could grant the first one from inside):

```bash
pnpm --filter @apigent/server admin:grant -- --email=you@example.com
```

The target account must already exist (register in the Platform Webapp first); the command is idempotent and writes an `admin.grant` audit row in the same transaction.

**Migration naming:** drizzle-kit auto-generates random `NNNN_adjective_hero` names by default. Prefer explicit names for reviewability (e.g. `0000_init`):

```bash
pnpm db:generate -- --name=add_users   # → 0001_add_users.sql
```

The Drizzle schema and migrations live in `packages/server` (`drizzle.config.ts` + `drizzle/`). The connection URL comes from `APIGENT_DATABASE_URL` (root `.env`), resolved through `@apigent/core/config`.

## Current State

Working apps and server modules exist (V0 is further along than the earliest config/DI scaffolding):

- `apps/platform` — Platform Webapp (Next.js SSR, port 3000): repos, endpoints, schemas, versions, settings, context pages, **plus the Platform REST API** under `src/app/api/**`.
- `apps/admin` — Admin Webapp (Next.js SSR, port 3001): platform-admin sign-in (`/login`), a capability-gated `(authed)` shell, platform stats (dashboard), a platform-level audit log (`/audit`), a read-only user list + detail (`/users`) and admin management (`/admins`).
- `apps/open` — Open Gateway (Hono, port 3002); currently serves `/` and `/health` only. No MCP endpoint yet.
- `packages/core` — config (`loadConfig()`: YAML + `.env` + zod), fail-fast DI container, types, i18n, agent registry.
- `packages/server` — framework-agnostic services: Drizzle schema + migrations, Postgres queue, OpenAPI parser, contexts, versions, imports, auth/authz, audit, notifications, logging, and the AI SDK model adapter (`src/ai`).
- `packages/ui` — shadcn/ui components (Base UI + Tailwind v4).
- Tests (Vitest) for `packages/core` config/DI and `packages/server` modules.
- `tsconfig.base.json` at root, with per-package tsconfigs extending it.

Not yet implemented (designed only): MCP Gateway, the Embedding / pgvector / BullMQ providers. LLM access is implemented in `@apigent/core/ai` (`@apigent/server/ai` re-exports it for compatibility); embedding lands with `@apigent/rag`.

**Repo access model:** the repository **directory** is visible to every signed-in user, but repository **contents** are gated by `repository_members` (explicit members) plus the implied roles of the owning Organization's `org_admin` / `org_owner`; anyone else gets 403. Resolution order is: explicit `repository_members` row → organization role → 403. Member management lives in repo settings → members (Platform), never in Admin.

**Audit logging:** membership and create events (`member.*`, `repo.member_*`, `org.transfer`, `org.create`, `repo.create`) write an `operation_logs` row inside the same transaction as the business write, through `recordOperation(tx, …)` / `withAuditTransaction()` in `@apigent/server/audit`. Read paths: `GET /api/repos/:id/operations` (`repo_viewer`), `GET /api/orgs/:id/operations` (`org_member`), surfaced at `/repos/:id/settings/audit` and the Organization detail "Activity log" tab. Import detail rows, repository edit/delete, version activate/rollback, MCP, secret keys and `admin.*` are still unwired.

**Platform (admin) access:** the Admin Webapp is gated by `admin_members` — one row means "this user may sign in". Login is separate from Platform (own cookie namespace, own secret — see the Auth row above), the guard lives in `apps/admin/src/app/(authed)/layout.tsx`, and capability checks go through `roleHasAdminCapability()` (`@apigent/server/authz`) for pages / `requireAdminApi()` for routes. `/admins` grants and revokes admins (`POST /api/admins`, `DELETE /api/admins/:userId`) and refuses to revoke the last one; `/audit` shows platform-level operations. Grant logic lives once in `@apigent/server/admin` — the CLI command above is a thin wrapper over it.

**Secret keys:** issue / list / revoke / edit-scope ship (`@apigent/server/keys`, surfaced at `/settings/keys`; keys belong to a user, plaintext is returned once and only a SHA-256 hash is stored). A key has two independent narrowing dimensions: `scopes` (which kinds of calls) and `repository_ids` (which repositories — picked from what the owner can already access, empty = unrestricted; the org/repo tree is grouping only). Effective access is **scopes ∩ repository scope ∩ the owner's own RBAC**. **Verification is deliberately not written yet** — its first consumer is the MCP Gateway, so `verifySecretKey()` lands with that endpoint and must also reject keys whose owner is disabled or deleted (docs/tech-design.md §3.10).

**Known authorization gaps** (full list and rollout order in `docs/tech-design.md` §5.4.8): key _verification_ is unimplemented (nothing validates a key today, because no machine-facing surface exists yet). Tenant deletion (`org:delete` / `repo:delete`) ships, and the Admin console now covers the account lifecycle: disable / enable takes effect on the next request, delete is refused for an Org owner, the last admin, or yourself.
