// ═══════════════════════════════════════════════════════════════════
// Database Connection — Drizzle + pg (node-postgres) Pool
// ═══════════════════════════════════════════════════════════════════
//
// Creates a Drizzle ORM instance backed by a node-postgres Pool.
// The connection URL comes from the config system (loaded via loadConfig()).
//
// Usage:
//   import { getDB } from "@apigent/server/db";
//   const db = getDB();
//   const users = await db.query.users.findMany();
// ═══════════════════════════════════════════════════════════════════

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getConfig, loadConfig } from "@apigent/core/config";
import * as schema from "./schema";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _pool: Pool | null = null;

/**
 * Get the singleton Drizzle database instance.
 * Creates a new connection pool on first call.
 * Requires {@link loadConfig} to have been called first.
 */
export function getDB() {
  if (!_db) {
    const config = (() => {
      try {
        return getConfig();
      } catch {
        // Lazily load once when the host (Next.js server component, script,
        // test) hasn't called loadConfig() at startup. loadConfig() is cached,
        // so repeated calls are cheap.
        return loadConfig();
      }
    })();
    _pool = new Pool({
      connectionString: config.database.url,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    _db = drizzle(_pool, { schema });
  }
  return _db;
}

/**
 * Get the raw pg Pool (for transactions, health checks, etc.).
 */
export function getPool(): Pool {
  if (!_pool) {
    getDB(); // Initialize
  }
  return _pool!;
}

/**
 * Close the database connection pool.
 * Call during graceful shutdown.
 */
export async function closeDB(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
    _db = null;
  }
}

/**
 * Reset the database singleton (for testing).
 * Ends the underlying pool so no connections leak between test runs.
 */
export async function resetDB(): Promise<void> {
  if (_pool) {
    await _pool.end();
  }
  _pool = null;
  _db = null;
}

export type DBClient = ReturnType<typeof drizzle<typeof schema>>;
