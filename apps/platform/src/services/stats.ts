// ═══════════════════════════════════════════════════════════════════
// Platform Stats Service — dashboard counters
// ═══════════════════════════════════════════════════════════════════

import { and, count, eq, inArray } from "drizzle-orm";
import { endpoints, getDB, organizations, repositories } from "@apigent/server/db";
import {
  listAccessibleOrgIds,
  listAccessibleRepoIds,
} from "@apigent/server/authz";

export interface DashboardStats {
  organizations: number;
  repositories: number;
  endpoints: number;
  mcpEnabled: number;
}

export async function getDashboardStats(userId: string): Promise<DashboardStats> {
  const db = getDB();
  const [accessibleOrgs, accessibleRepos] = await Promise.all([
    listAccessibleOrgIds(userId),
    listAccessibleRepoIds(userId),
  ]);
  // 空列表时用哨兵值，避免生成无效的 IN ()
  const orgIds = accessibleOrgs.length ? accessibleOrgs : ["__none__"];
  const repoIds = accessibleRepos.length ? accessibleRepos : ["__none__"];

  const [orgs] = await db
    .select({ value: count() })
    .from(organizations)
    .where(inArray(organizations.id, orgIds));
  const [repos] = await db
    .select({ value: count() })
    .from(repositories)
    .where(inArray(repositories.id, repoIds));
  const [eps] = await db
    .select({ value: count() })
    .from(endpoints)
    .where(inArray(endpoints.repoId, repoIds));
  const [mcp] = await db
    .select({ value: count() })
    .from(repositories)
    .where(and(inArray(repositories.id, repoIds), eq(repositories.mcpEnabled, true)));
  return {
    organizations: orgs?.value ?? 0,
    repositories: repos?.value ?? 0,
    endpoints: eps?.value ?? 0,
    mcpEnabled: mcp?.value ?? 0,
  };
}
