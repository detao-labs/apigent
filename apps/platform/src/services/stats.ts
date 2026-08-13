// ═══════════════════════════════════════════════════════════════════
// Platform Stats Service — dashboard counters
// ═══════════════════════════════════════════════════════════════════

import { count, eq } from "drizzle-orm";
import { endpoints, getDB, organizations, repositories } from "@apigent/server/db";

export interface DashboardStats {
  organizations: number;
  repositories: number;
  endpoints: number;
  mcpEnabled: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = getDB();
  const [orgs] = await db.select({ value: count() }).from(organizations);
  const [repos] = await db.select({ value: count() }).from(repositories);
  const [eps] = await db.select({ value: count() }).from(endpoints);
  const [mcp] = await db
    .select({ value: count() })
    .from(repositories)
    .where(eq(repositories.mcpEnabled, true));
  return {
    organizations: orgs?.value ?? 0,
    repositories: repos?.value ?? 0,
    endpoints: eps?.value ?? 0,
    mcpEnabled: mcp?.value ?? 0,
  };
}
