// ═══════════════════════════════════════════════════════════════════
// Platform Contexts Service — 业务上下文的读取与人工编辑
// ═══════════════════════════════════════════════════════════════════

import { and, count, eq } from "drizzle-orm";
import { BusinessContextSchema } from "@apigent/core/agent";
import type { BusinessContext } from "@apigent/core/agent";
import {
  businessContexts,
  endpoints,
  getDB,
  repositories,
} from "@apigent/server/db";
import { generateId } from "@apigent/server/id";
import { buildCapabilitySnapshot } from "@apigent/server/contexts";

export interface EndpointContextSummary {
  endpointId: string;
  method: string;
  path: string;
  summary: string | null;
  capabilityName: string | null;
  intent: string | null;
  confidence: number | null;
  needsReview: boolean;
  editedByHuman: boolean;
  generatedBy: string | null;
  sourceContextId: string | null;
}

/** 当前版本下所有接口的上下文状态（含未生成的接口）。 */
export async function listEndpointContexts(
  repoId: string,
): Promise<EndpointContextSummary[]> {
  const db = getDB();
  const [repo] = await db
    .select({ currentVersionId: repositories.currentVersionId })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  if (!repo?.currentVersionId) return [];
  const versionId = repo.currentVersionId;

  const rows = await db
    .select({
      endpointId: endpoints.id,
      method: endpoints.method,
      path: endpoints.path,
      summary: endpoints.summary,
      capabilityName: businessContexts.capabilityName,
      intent: businessContexts.intent,
      confidence: businessContexts.confidence,
      needsReview: businessContexts.needsReview,
      editedByHuman: businessContexts.editedByHuman,
      generatedBy: businessContexts.generatedBy,
      sourceContextId: businessContexts.sourceContextId,
    })
    .from(endpoints)
    .leftJoin(
      businessContexts,
      and(
        eq(businessContexts.endpointId, endpoints.id),
        eq(businessContexts.versionId, versionId),
      ),
    )
    .where(and(eq(endpoints.repoId, repoId), eq(endpoints.versionId, versionId)))
    .orderBy(endpoints.path, endpoints.method);

  return rows.map((row) => ({
    ...row,
    needsReview: Boolean(row.needsReview),
    editedByHuman: Boolean(row.editedByHuman),
  }));
}

/** 单接口上下文（未生成时返回 null context 信息）。 */
export async function getEndpointContext(
  repoId: string,
  endpointId: string,
): Promise<EndpointContextSummary | null> {
  const rows = await listEndpointContexts(repoId);
  return rows.find((row) => row.endpointId === endpointId) ?? null;
}

export interface SaveContextOptions {
  /** human = 人工编辑（confidence 1、edited_by_human true）；ai = agent/自动保存 */
  source?: "ai" | "human";
}

/**
 * 保存/覆盖单接口业务上下文（upsert）。
 * 人工编辑优先：edited_by_human = true、confidence = 1、needs_review = false。
 * 保存后刷新 repo 聚合快照。
 */
export async function saveEndpointContext(
  repoId: string,
  endpointId: string,
  context: BusinessContext,
  options: SaveContextOptions = {},
): Promise<void> {
  const parsed = BusinessContextSchema.safeParse(context);
  if (!parsed.success) {
    throw new Error("invalid business context payload");
  }

  const db = getDB();
  const [endpoint] = await db
    .select({
      id: endpoints.id,
      versionId: endpoints.versionId,
    })
    .from(endpoints)
    .where(and(eq(endpoints.id, endpointId), eq(endpoints.repoId, repoId)))
    .limit(1);
  if (!endpoint) throw new Error(`Endpoint not found: ${endpointId}`);

  const source = options.source ?? "human";
  const data = parsed.data;
  const values = {
    capabilityName: data.capabilityName,
    intent: data.intent,
    constraints: data.constraints,
    sideEffects: data.sideEffects,
    usageScenarios: data.usageScenarios,
    confidence: source === "human" ? 1 : data.confidence,
    needsReview: source === "human" ? false : data.needsReview,
    editedByHuman: source === "human",
    editedAt: source === "human" ? new Date() : null,
    generatedBy: source,
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select({ id: businessContexts.id })
    .from(businessContexts)
    .where(
      and(
        eq(businessContexts.endpointId, endpointId),
        eq(businessContexts.versionId, endpoint.versionId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(businessContexts)
      .set(values)
      .where(eq(businessContexts.id, existing.id));
  } else {
    await db.insert(businessContexts).values({
      id: generateId("context"),
      endpointId,
      versionId: endpoint.versionId,
      ...values,
    });
  }

  await refreshCapabilitySnapshot(repoId, endpoint.versionId);
}

/** 保存后轻量重聚合 repo 快照（统计当前版本 context 分布）。 */
async function refreshCapabilitySnapshot(
  repoId: string,
  versionId: string,
): Promise<void> {
  const db = getDB();
  const [epCount] = await db
    .select({ value: count() })
    .from(endpoints)
    .where(eq(endpoints.versionId, versionId));
  const rows = await db
    .select({
      generatedBy: businessContexts.generatedBy,
      needsReview: businessContexts.needsReview,
    })
    .from(businessContexts)
    .where(eq(businessContexts.versionId, versionId));

  await buildCapabilitySnapshot(repoId, versionId, {
    endpointCount: Number(epCount?.value ?? 0),
    generatedCount: rows.filter((row) => row.generatedBy === "ai").length,
    reusedCount: rows.filter((row) => row.generatedBy === "reused").length,
    failedCount: 0,
  });
}
