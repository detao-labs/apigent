// ═══════════════════════════════════════════════════════════════════
// Migrate — 应用迁移，并在失败时**非零退出**
// ═══════════════════════════════════════════════════════════════════
//
// 为什么不用 `drizzle-kit migrate`：它会吞掉异常。spinner 清理时把 stderr 一起
// 抹掉，结果是"退出码 0、没有任何输出、迁移根本没进库"——本地和 CI 都会被静默
// 骗过去（本项目已经踩过两次）。
//
// 这里直接用 drizzle-orm 的 migrator API，并且迁移后显式断言：已应用的条数必须
// 不少于 `meta/_journal.json` 里的条目数。少一条就非零退出。
//
// 用法（仓库根目录）：  pnpm db:migrate
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "@apigent/core/config";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

function expectedMigrationCount(): number {
  const journal = JSON.parse(
    readFileSync(join(MIGRATIONS_FOLDER, "meta/_journal.json"), "utf8"),
  ) as { entries?: unknown[] };
  return journal.entries?.length ?? 0;
}

export async function runMigrations(): Promise<{ applied: number; expected: number }> {
  const config = loadConfig();
  const expected = expectedMigrationCount();
  const pool = new Pool({ connectionString: config.database.url });

  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });

    const result = await pool.query<{ n: number }>(
      "select count(*)::int as n from drizzle.__drizzle_migrations",
    );
    const applied = result.rows[0]?.n ?? 0;
    if (applied < expected) {
      throw new Error(
        `Migration did not take effect: ${applied}/${expected} applied. ` +
          `Check the SQL in ${MIGRATIONS_FOLDER}.`,
      );
    }
    return { applied, expected };
  } finally {
    await pool.end();
  }
}

// Run directly:  pnpm --filter @apigent/server migrate
if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations()
    .then(({ applied, expected }) => {
      console.log(`[migrate] ${applied}/${expected} migrations applied`);
      process.exit(0);
    })
    .catch((err) => {
      // drizzle 会把真实原因包在 cause 里；而连不上库时 cause 往往是
      // AggregateError（IPv4+IPv6 都拒绝），它的 message 是空的，得往下取一层。
      // 只打 drizzle 的 message 则会是 "Failed query: CREATE SCHEMA ..."，
      // 看起来像 SQL 有问题，其实根本连不上库。
      const cause = (err as { cause?: { message?: string; errors?: { message?: string }[] } })
        ?.cause;
      const detail =
        cause?.errors
          ?.map((e) => e.message)
          .filter(Boolean)
          .join("; ") ||
        cause?.message ||
        (err instanceof Error ? err.message : String(err));
      console.error("[migrate] Failed:", detail);
      process.exit(1);
    });
}
