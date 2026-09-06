// ═══════════════════════════════════════════════════════════════════
// Platform Contexts Service — 业务上下文的读取与人工编辑
// ═══════════════════════════════════════════════════════════════════
//
// 新模型：context 以 version_commits.id 为版本（默认为主版本 head commit）。
// ═══════════════════════════════════════════════════════════════════

import { and, count, eq } from "drizzle-orm";
import { BusinessContextSchema } from "@apigent/core/agent";
import type { BusinessContext } from "@apigent/core/agent";
import {
  businessContexts,
  endpoints,
  getDB,
  versionEntityLinks,
  versions,
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
  constraints: unknown[] | null;
  sideEffects: string[] | null;
  usageScenarios: string[] | null;
  confidence: number | null;
  needsReview: boolean;
  editedByHuman: boolean;
  generatedBy: string | null;
  sourceContextId: string | null;
}

async function defaultCommitId(repoId: string): Promise<string | null> {
  const db = getDB();
  const [v] = await db
    .select({ headCommitId: versions.headCommitId })
    .from(versions)
    .where(and(eq(versions.repoId, repoId), eq(versions.isDefault, true)))
    .limit(1);
  return v?.headCommitId ?? null;
}

/** 当前版本下所有接口的上下文状态（含未生成的接口）。 */
export async function listEndpointContexts(
  repoId: string,
): Promise<EndpointContextSummary[]> {
  const db = getDB();
  const commitId = await defaultCommitId(repoId);
  if (!commitId) return [];

  const rows = await db
    .select({
      endpointId: endpoints.id,
      method: endpoints.method,
      path: endpoints.path,
      summary: endpoints.summary,
      capabilityName: businessContexts.capabilityName,
      intent: businessContexts.intent,
      constraints: businessContexts.constraints,
      sideEffects: businessContexts.sideEffects,
      usageScenarios: businessContexts.usageScenarios,
      confidence: businessContexts.confidence,
      needsReview: businessContexts.needsReview,
      editedByHuman: businessContexts.editedByHuman,
      generatedBy: businessContexts.generatedBy,
      sourceContextId: businessContexts.sourceContextId,
    })
    .from(versionEntityLinks)
    .innerJoin(endpoints, eq(endpoints.id, versionEntityLinks.entityId))
    .leftJoin(
      businessContexts,
      and(
        eq(businessContexts.endpointId, endpoints.id),
        eq(businessContexts.versionId, commitId),
      ),
    )
    .where(and(eq(versionEntityLinks.commitId, commitId), eq(versionEntityLinks.entityType, "endpoint")))
    .orderBy(endpoints.path, endpoints.method);

  return rows.map((row) => ({
    ...row,
    constraints: (row.constraints ?? null) as unknown[] | null,
    sideEffects: (row.sideEffects ?? null) as string[] | null,
    usageScenarios: (row.usageScenarios ?? null) as string[] | null,
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
  source?: "ai" | "human";
}

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
  const commitId = await defaultCommitId(repoId);
  if (!commitId) throw new Error(`Repository has no version: ${repoId}`);

  const [endpoint] = await db
    .select({ id: endpoints.id })
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
        eq(businessContexts.versionId, commitId),
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
      entityType: "endpoint",
      entityId: endpointId,
      endpointId,
      versionId: commitId,
      ...values,
    });
  }

  await refreshCapabilitySnapshot(repoId, commitId);
}

async function refreshCapabilitySnapshot(
  repoId: string,
  commitId: string,
): Promise<void> {
  const db = getDB();
  const [epCount] = await db
    .select({ value: count() })
    .from(versionEntityLinks)
    .where(and(eq(versionEntityLinks.commitId, commitId), eq(versionEntityLinks.entityType, "endpoint")));
  const rows = await db
    .select({
      generatedBy: businessContexts.generatedBy,
      needsReview: businessContexts.needsReview,
    })
    .from(businessContexts)
    .where(eq(businessContexts.versionId, commitId));

  await buildCapabilitySnapshot(repoId, commitId, {
    endpointCount: Number(epCount?.value ?? 0),
    generatedCount: rows.filter((row) => row.generatedBy === "ai").length,
    reusedCount: rows.filter((row) => row.generatedBy === "reused").length,
    failedCount: 0,
  });
}
