// ═══════════════════════════════════════════════════════════════════
// Platform Stats — 平台级统计（Admin 仪表盘）
// ═══════════════════════════════════════════════════════════════════
//
// 与 apps/platform 的 getDashboardStats(userId) 不同：那个是**租户级**（只统计
// 该用户能访问的组织 / 仓库），这里是**整台部署**的口径，因此只给 Admin 用。
//
// MCP 调用量不在其中——MCP Gateway 尚未实现（§5.4.9 之外的设计见 modules/mcp-gateway.md）。
// ═══════════════════════════════════════════════════════════════════

import { gte, sql } from "drizzle-orm";
import { count } from "drizzle-orm";
import { endpoints, getDB, organizations, repositories, users } from "../db";

export interface PlatformStats {
  users: number;
  /** 近 7 天注册数 */
  newUsers: number;
  organizations: number;
  repositories: number;
  /** 已开启 MCP 的仓库数（配置项，不代表 Gateway 已可用） */
  mcpEnabledRepositories: number;
  endpoints: number;
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const db = getDB();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [userCount, newUserCount, orgCount, repoRows, endpointCount] = await Promise.all([
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(users).where(gte(users.createdAt, weekAgo)),
    db.select({ value: count() }).from(organizations),
    db
      .select({
        value: count(),
        mcpEnabled: sql<number>`count(*) filter (where ${repositories.mcpEnabled})`,
      })
      .from(repositories),
    db.select({ value: count() }).from(endpoints),
  ]);

  return {
    users: Number(userCount[0]?.value ?? 0),
    newUsers: Number(newUserCount[0]?.value ?? 0),
    organizations: Number(orgCount[0]?.value ?? 0),
    repositories: Number(repoRows[0]?.value ?? 0),
    mcpEnabledRepositories: Number(repoRows[0]?.mcpEnabled ?? 0),
    endpoints: Number(endpointCount[0]?.value ?? 0),
  };
}
