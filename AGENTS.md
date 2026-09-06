# Repository Guidelines

This file supplements [CLAUDE.md](./CLAUDE.md), the primary contributor guide. CLAUDE.md already covers the project overview, architecture decisions, configuration system (YAML + `.env`), technology stack, port conventions, package structure & import rules, and the full command tables (typecheck/lint/test, Drizzle DB). Read it first.

AGENTS.md records only the conventions not already described there.

## Coding Style & Naming Conventions

- Prettier (`.prettierrc`): 2-space indent, double quotes, semicolons, trailing commas, 100-char width.
- ESLint (`eslint.config.mjs`, typescript-eslint): unused variables/args are errors unless prefixed with `_`.
- `strict` TypeScript with `moduleResolution: "bundler"` (`tsconfig.base.json`).
- Source files are kebab-case `src/**/*.ts`; subpath exports point at barrel files, e.g. `@apigent/core/config` → `src/config/index.ts`. See CLAUDE.md for the `export type { ... }` rule.
- `openapi:export` writes the public spec to `apps/platform/openapi/`.

## Testing Guidelines

- Vitest with `globals: true` (per-package `vitest.config.mts`). Tests import `describe`/`it`/`expect` from `"vitest"` and live beside source as `*.test.ts`.
- Run one suite: `pnpm --filter @apigent/<name> test` (e.g. `@apigent/core`). Root `pnpm test` runs every package.
- Coverage is only enforced where a package configures it.

## Commit & Pull Request Guidelines

- Conventional Commits: `type(scope): subject`, e.g. `feat(server): add versioning smoke script`. Prefer `feat` / `fix` / `refactor` / `chore` / `test` / `docs`.
- PRs: explain the change and why, link a GitHub issue, add screenshots for UI changes, and keep `docs/*.md` and their `.zh.md` counterparts in sync.

## Development Commands

`pnpm dev` boots all three apps (platform:3000, admin:3001, open:3002); `pnpm dev:platform` starts one. Filter any package script with `pnpm --filter @apigent/<name> <script>`. For everything else, see CLAUDE.md's command tables.
