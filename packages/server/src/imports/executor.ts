// ═══════════════════════════════════════════════════════════════════
// Import Executor — 导入任务执行器（Worker 调用）
// ═══════════════════════════════════════════════════════════════════
//
// 新模型（内容寻址 + 版本树）：
//   解析 → 确定目标版本 → 新建 commit → 每个实体算 content_hash →
//   复用/新建 blob（endpoints / data_models / components）→ 写
//   version_entity_links → 更新版本 head_commit_id。
// 全量更新：文件 = 整仓，缺席即删；增量更新：只增/改，不删。
// ═══════════════════════════════════════════════════════════════════

import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { loadConfig } from "@apigent/core/config";
import { parseOpenAPI } from "../openapi";
import {
  hashEndpoint,
  hashDataModel,
  hashComponent,
  hashResponse,
  endpointIdentity,
} from "../openapi/hash";
import type { APIEntry, SchemaEntry, ComponentDef } from "../openapi/types";
import { generateId } from "../id";
import {
  components,
  dataModels,
  endpointResponses,
  endpoints,
  getDB,
  repositories,
  versionCommits,
  versionEntityLinks,
  versions,
  repoTasks,
} from "../db";
import { notifySafely } from "../notifications";
import { logError, logInfo } from "../logger";
import { createContextTask } from "../contexts";
import {
  hasFatalIssue,
  ImportError,
  issueCounts,
  moduleCount,
  createTimer,
} from "./common";

type TaskStatus = "queued" | "running" | "succeeded" | "failed";

export interface ImportTaskPayload {
  specPath: string;
  /** full = 全量更新（缺席即删）；partial = 增量更新（只增/改，不删） */
  mode: "full" | "partial";
  /** 目标版本；缺省用默认主版本 */
  versionId?: string;
}

interface LinkRow {
  entityType: "endpoint" | "data_model" | "component";
  identityKey: string;
  entityId: string;
}

async function updateTask(
  taskId: string,
  patch: {
    status?: TaskStatus;
    progress?: number;
    versionId?: string;
    result?: unknown;
    error?: string | null;
    startedAt?: Date;
    finishedAt?: Date;
  },
): Promise<void> {
  await getDB()
    .update(repoTasks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(repoTasks.id, taskId));
}

/** 解析目标版本：payload.versionId 优先，否则取默认主版本。 */
async function resolveVersionId(repoId: string, requested?: string): Promise<string> {
  const db = getDB();
  if (requested) {
    const [v] = await db
      .select({ id: versions.id })
      .from(versions)
      .where(and(eq(versions.id, requested), eq(versions.repoId, repoId)))
      .limit(1);
    if (v) return v.id;
  }
  const [def] = await db
    .select({ id: versions.id })
    .from(versions)
    .where(and(eq(versions.repoId, repoId), eq(versions.isDefault, true)))
    .limit(1);
  if (def) return def.id;
  throw new Error(`Repository ${repoId} has no version to import into`);
}

/** 计算某 commit 的 identity 集合（key 规范化）。 */
function linkKey(type: LinkRow["entityType"], identityKey: string): string {
  return `${type}::${identityKey}`;
}

function buildChangeSummary(
  parentKeys: Set<string>,
  newKeys: Map<string, LinkRow>,
  parentBlobs: Map<string, string>,
) {
  const added: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];
  for (const [key, row] of newKeys) {
    if (!parentKeys.has(key)) added.push(row.identityKey);
    else if (parentBlobs.get(key) !== row.entityId) updated.push(row.identityKey);
  }
  for (const key of parentKeys) {
    if (!newKeys.has(key)) removed.push(key.split("::")[1]);
  }
  return { added, updated, removed };
}

/**
 * 执行导入任务。任务已非 queued 时直接返回（幂等）。
 */
export async function executeImportTask(taskId: string): Promise<void> {
  const startedAt = Date.now();
  const timer = createTimer();
  const db = getDB();

  const [task] = await db.select().from(repoTasks).where(eq(repoTasks.id, taskId)).limit(1);
  if (!task) throw new Error(`Import task not found: ${taskId}`);
  if (task.status !== "queued") {
    logInfo("openapi.import.skipped", { taskId, repoId: task.repoId, status: task.status });
    return;
  }

  await updateTask(taskId, { status: "running", progress: 5, startedAt: new Date() });

  try {
    const payload = task.payload as ImportTaskPayload;
    const specPath = payload.specPath;
    if (!specPath) throw new Error(`Import task missing specPath: ${taskId}`);
    const content = await readFile(specPath, "utf8");
    timer.mark("specRead");

    const model = parseOpenAPI({ source: "text", content, repoId: task.repoId });
    timer.mark("parse");
    await updateTask(taskId, { progress: 30 });
    if (hasFatalIssue(model.parseIssues)) throw new ImportError(model.parseIssues);

    const [repoRow] = await db
      .select({ id: repositories.id, name: repositories.name })
      .from(repositories)
      .where(eq(repositories.id, task.repoId))
      .limit(1);
    timer.mark("repoCheck");
    if (!repoRow) {
      const err = new Error(`Repository not found: ${task.repoId}`);
      err.name = "RepoNotFoundError";
      throw err;
    }

    const versionId = await resolveVersionId(task.repoId, payload.versionId);
    const txData = await db.transaction(async (tx) => {
      const [versionRow] = await tx
        .select({ headCommitId: versions.headCommitId })
        .from(versions)
        .where(eq(versions.id, versionId))
        .limit(1);
      const parentCommitId = versionRow?.headCommitId ?? null;

      // 1) 新建 commit
      const commitId = generateId("commit");
      const tagMeta = Object.fromEntries(
        Object.entries(model.tagDescriptions ?? {}).map(([name, description]) => [
          name,
          { description },
        ]),
      );
      await tx.insert(versionCommits).values({
        id: commitId,
        repoId: task.repoId,
        versionId,
        parentCommitId,
        specTitle: model.meta.specTitle ?? null,
        specVersion: model.meta.specVersion ?? null,
        description: model.meta.specDescription ?? null,
        specStoragePath: specPath,
        source: "import",
        tagMeta: Object.keys(tagMeta).length > 0 ? tagMeta : null,
      });
      timer.mark("commitRow");

      // 2) 构建新树 links
      const newLinks = new Map<string, LinkRow>();
      const parentKeys = new Set<string>();
      const parentBlobs = new Map<string, string>();

      if (parentCommitId) {
        const parentLinks = await tx
          .select({ entityType: versionEntityLinks.entityType, identityKey: versionEntityLinks.identityKey, entityId: versionEntityLinks.entityId })
          .from(versionEntityLinks)
          .where(eq(versionEntityLinks.commitId, parentCommitId));
        for (const link of parentLinks) {
          const key = linkKey(link.entityType as LinkRow["entityType"], link.identityKey);
          parentKeys.add(key);
          parentBlobs.set(key, link.entityId);
          if (payload.mode === "partial") {
            newLinks.set(key, {
              entityType: link.entityType as LinkRow["entityType"],
              identityKey: link.identityKey,
              entityId: link.entityId,
            });
          }
        }
      }

      // 3) 处理接口（endpoint blob + responses + link）
      const endpointLinkRows: LinkRow[] = [];
      for (const api of model.apis) {
        const identityKey = endpointIdentity(api.operationId, api.method, api.path);
        const contentHash = hashEndpoint(api);
        const [existingBlob] = await tx
          .select({ id: endpoints.id })
          .from(endpoints)
          .where(and(eq(endpoints.repoId, task.repoId), eq(endpoints.contentHash, contentHash)))
          .limit(1);

        let endpointId = existingBlob?.id;
        if (!endpointId) {
          endpointId = generateId("endpoint");
          const responsesMeta = api.responses
            .slice()
            .sort((a, b) =>
              `${a.statusCode}:${a.contentType ?? ""}`.localeCompare(`${b.statusCode}:${b.contentType ?? ""}`),
            )
            .map((r) => ({
              hash: hashResponse(r),
              statusCode: r.statusCode,
              contentType: r.contentType ?? null,
            }));
          await tx.insert(endpoints).values({
            id: endpointId,
            repoId: task.repoId,
            contentHash,
            identityKey,
            operationId: api.operationId ?? null,
            method: api.method,
            path: api.path,
            summary: api.summary ?? null,
            description: api.description ?? null,
            requestContentType: api.requestContentType ?? null,
            requestSchema: (api.requestBody && api.requestBody.schema) || null,
            parameters: api.parameters ?? [],
            deprecated: api.deprecated,
            tags: api.tags ?? [],
            security: api.security ?? [],
            responsesMeta,
          });
          const responseRows = api.responses.map((r) => ({
            id: generateId("response"),
            repoId: task.repoId,
            endpointId: endpointId!,
            respHash: hashResponse(r),
            statusCode: r.statusCode,
            description: r.description,
            headers: [],
            contentType: r.contentType ?? null,
            schema: r.schema ?? null,
            isError: Number.parseInt(r.statusCode, 10) >= 400,
          }));
          if (responseRows.length > 0) {
            await tx.insert(endpointResponses).values(responseRows);
          }
        }

        const row: LinkRow = { entityType: "endpoint", identityKey, entityId: endpointId };
        const key = linkKey(row.entityType, row.identityKey);
        newLinks.set(key, row);
      }

      // 4) 数据模型
      for (const schema of model.schemas as SchemaEntry[]) {
        const contentHash = hashDataModel(schema);
        const [existingBlob] = await tx
          .select({ id: dataModels.id })
          .from(dataModels)
          .where(and(eq(dataModels.repoId, task.repoId), eq(dataModels.contentHash, contentHash)))
          .limit(1);
        let blobId = existingBlob?.id;
        if (!blobId) {
          blobId = generateId("dataModel");
          await tx.insert(dataModels).values({
            id: blobId,
            repoId: task.repoId,
            contentHash,
            name: schema.name,
            schemaType: schema.type ?? null,
            schemaRaw: { type: schema.type ?? null, properties: schema.properties ?? {}, required: schema.required ?? [] },
            description: schema.description ?? null,
          });
        }
        const row: LinkRow = { entityType: "data_model", identityKey: schema.name, entityId: blobId };
        const key = linkKey(row.entityType, row.identityKey);
        newLinks.set(key, row);
      }

      // 5) 组件
      for (const c of model.componentDefs as ComponentDef[]) {
        const contentHash = hashComponent(c);
        const [existingBlob] = await tx
          .select({ id: components.id })
          .from(components)
          .where(and(eq(components.repoId, task.repoId), eq(components.contentHash, contentHash)))
          .limit(1);
        let blobId = existingBlob?.id;
        if (!blobId) {
          blobId = generateId("component");
          await tx.insert(components).values({
            id: blobId,
            repoId: task.repoId,
            contentHash,
            kind: c.kind,
            name: c.name,
            defType: c.defType ?? null,
            description: c.description ?? null,
            payload: c.payload ?? {},
          });
        }
        const row: LinkRow = { entityType: "component", identityKey: `${c.kind}::${c.name}`, entityId: blobId };
        const key = linkKey(row.entityType, row.identityKey);
        newLinks.set(key, row);
      }

      // 6) 写 link（对 partial 已继承 parent；对 full 只保留文件实体，absent 即删）
      if (newLinks.size > 0) {
        await tx
          .insert(versionEntityLinks)
          .values([...newLinks.values()].map((link) => ({ ...link, commitId })))
          .onConflictDoNothing();
      }
      timer.mark("links");

      // 7) change_summary + 更新 head
      const summary = buildChangeSummary(parentKeys, newLinks, parentBlobs);
      await tx.update(versionCommits).set({ changeSummary: summary }).where(eq(versionCommits.id, commitId));
      await tx
        .update(versions)
        .set({ headCommitId: commitId })
        .where(eq(versions.id, versionId));
      timer.mark("pointer");

      return {
        commitId,
        versionId,
        endpoints: model.apis.length,
        models: model.schemas.length,
        components: model.componentDefs.length,
        modules: moduleCount(model.apis),
        changeSummary: summary,
      };
    });
    timer.mark("transaction");

    await updateTask(taskId, {
      status: "succeeded",
      progress: 100,
      versionId: txData.versionId,
      result: {
        stats: {
          endpoints: txData.endpoints,
          models: txData.models,
          components: txData.components,
          modules: txData.modules,
        },
        issues: model.parseIssues,
        commitId: txData.commitId,
      },
      finishedAt: new Date(),
    });

    await notifySafely({
      userId: task.userId,
      category: "import",
      type: "import.succeeded",
      priority: "medium",
      titleKey: "notifications.import.succeeded",
      titleParams: { repoName: repoRow.name },
      payload: {
        href: `/repos/${task.repoId}/endpoints?version=${txData.versionId}`,
        repoId: task.repoId,
        versionId: txData.versionId,
        taskId,
      },
      metadata: { orgId: null },
    });

    if (loadConfig().businessContext.autoGenerate) {
      await createContextTask(task.repoId, task.userId, {
        trigger: "auto",
        dependsOn: taskId,
      }).catch((err) => {
        logError("business.context.auto_trigger_failed", err, { repoId: task.repoId, importTaskId: taskId });
      });
    }

    logInfo("openapi.import.completed", {
      taskId,
      repoId: task.repoId,
      userId: task.userId,
      versionId: txData.versionId,
      commitId: txData.commitId,
      stats: {
        endpoints: txData.endpoints,
        models: txData.models,
        components: txData.components,
        modules: txData.modules,
      },
      changeSummary: txData.changeSummary,
      issues: issueCounts(model.parseIssues),
      durationMs: Date.now() - startedAt,
      timings: timer.timings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateTask(taskId, {
      status: "failed",
      error: message,
      result: err instanceof ImportError ? { issues: err.issues } : undefined,
      finishedAt: new Date(),
    });
    await notifySafely({
      userId: task.userId,
      category: "import",
      type: "import.failed",
      priority: "high",
      titleKey: "notifications.import.failed",
      titleParams: { repoName: task.repoId, error: message },
      payload: { href: `/repos/${task.repoId}/versions`, repoId: task.repoId, taskId, versionId: null },
      metadata: { orgId: null },
    });
    logError("openapi.import.failed", err, {
      taskId,
      repoId: task.repoId,
      userId: task.userId,
      durationMs: Date.now() - startedAt,
      timings: timer.timings,
    });
    throw err;
  }
}
