// ═══════════════════════════════════════════════════════════════════
// Capability Snapshot — Repository 级聚合快照
// ═══════════════════════════════════════════════════════════════════
//
// 生成任务结束时按规则聚合（不额外调用 LLM）：
//   capabilities 去重收集接口级 capability_name；
//   summary 由能力名 + 统计拼接；置信度取接口级均值。
// 写入 repositories.capability_context，供概览页与后续检索使用。
// ═══════════════════════════════════════════════════════════════════

import { and, eq } from "drizzle-orm";
import { businessContexts, endpoints, getDB, repositories } from "../db";

export interface ContextStats {
  endpointCount: number;
  generatedCount: number;
  reusedCount: number;
  failedCount: number;
}

export async function buildCapabilitySnapshot(
  repoId: string,
  versionId: string,
  stats: ContextStats,
): Promise<void> {
  const db = getDB();
  const rows = await db
    .select({
      capabilityName: businessContexts.capabilityName,
      confidence: businessContexts.confidence,
      needsReview: businessContexts.needsReview,
    })
    .from(businessContexts)
    .innerJoin(endpoints, eq(businessContexts.endpointId, endpoints.id))
    .where(
      and(eq(endpoints.repoId, repoId), eq(businessContexts.versionId, versionId)),
    );

  const capabilities = [
    ...new Set(
      rows
        .map((row) => row.capabilityName)
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  const confidences = rows
    .map((row) => row.confidence)
    .filter((value): value is number => typeof value === "number");
  const confidence =
    confidences.length > 0
      ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
      : null;
  const needsReviewCount = rows.filter((row) => row.needsReview).length;

  const snapshot = {
    summary:
      capabilities.length > 0
        ? `${capabilities.slice(0, 5).join("、")}等 ${stats.endpointCount} 项能力`
        : "",
    capabilities,
    stats: {
      endpointCount: stats.endpointCount,
      generatedCount: stats.generatedCount,
      reusedCount: stats.reusedCount,
      needsReviewCount,
      failedCount: stats.failedCount,
    },
    confidence,
    versionId,
    generatedAt: new Date().toISOString(),
    source: "aggregate",
  };

  await db
    .update(repositories)
    .set({ capabilityContext: snapshot })
    .where(eq(repositories.id, repoId));
}
