// ═══════════════════════════════════════════════════════════════════
// Import Executor — 导入任务执行器（Worker 调用）
// ═══════════════════════════════════════════════════════════════════
//
// 执行一个 import_tasks 任务：
//   解析 → 计算版本号 → 快照落库（事务）→ 切换 current_version_id →
//   更新任务状态 + 写通用通知 + 日志打点。
// 失败时保留 spec 原文（spec_path 指向磁盘文件），支持重试。
// ═══════════════════════════════════════════════════════════════════

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { loadConfig } from "@apigent/core/config";
import { parseOpenAPI } from "../openapi";
import { generateId } from "../id";
import {
  dataModels,
  endpointModules,
  endpointResponses,
  endpoints,
  getDB,
  modules,
  repositories,
  repoVersions,
  repoTasks,
} from "../db";
import { notifySafely } from "../notifications";
import { logError, logInfo } from "../logger";
import { createContextTask } from "../contexts";
import {
  hasFatalIssue,
  ImportError,
  isErrorStatus,
  issueCounts,
  moduleCount,
  nextVersionFor,
  createTimer,
} from "./common";

type TaskStatus = "queued" | "running" | "succeeded" | "failed";

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

/**
 * 执行导入任务。任务已非 queued 时直接返回（幂等，防重复执行）。
 * 失败时把任务置 failed 并重新抛出，让队列把 job 标记为失败。
 */
export async function executeImportTask(taskId: string): Promise<void> {
  const startedAt = Date.now();
  const timer = createTimer();

  const db = getDB();
  const [task] = await db
    .select()
    .from(repoTasks)
    .where(eq(repoTasks.id, taskId))
    .limit(1);
  if (!task) throw new Error(`Import task not found: ${taskId}`);
  if (task.status !== "queued") {
    logInfo("openapi.import.skipped", { taskId, repoId: task.repoId, status: task.status });
    return;
  }

  await updateTask(taskId, { status: "running", progress: 5, startedAt: new Date() });

  try {
    const payload = task.payload as { specPath?: string };
    const specPath = payload.specPath;
    if (!specPath) throw new Error(`Import task missing specPath: ${taskId}`);
    const content = await readFile(specPath, "utf8");
    timer.mark("specRead");

    const model = parseOpenAPI({ source: "text", content, repoId: task.repoId });
    timer.mark("parse");
    await updateTask(taskId, { progress: 30 });

    if (hasFatalIssue(model.parseIssues)) {
      throw new ImportError(model.parseIssues);
    }

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

    const versionId = generateId("version");
    const version = await nextVersionFor(task.repoId);
    timer.mark("nextVersion");
    await updateTask(taskId, { progress: 40, result: { nextVersion: version } });

    const txTimer = createTimer();
    const stats = await db.transaction(async (tx) => {
      await tx.insert(repoVersions).values({
        id: versionId,
        repoId: task.repoId,
        version,
        specVersion: model.meta.specVersion ?? null,
        description: model.meta.specDescription ?? null,
        specStoragePath: specPath,
        source: "import",
      });
      txTimer.mark("versionRow");

      if (model.apis.length > 0) {
        const endpointIds = new Map<string, string>();
        const moduleIds = new Map<string, string>();

        for (const api of model.apis) {
          endpointIds.set(api.id, generateId("endpoint"));
          for (const tag of api.tags) {
            if (!moduleIds.has(tag)) moduleIds.set(tag, generateId("module"));
          }
        }

        await tx.insert(endpoints).values(
          model.apis.map((api) => ({
            id: endpointIds.get(api.id)!,
            versionId,
            repoId: task.repoId,
            operationId: api.operationId ?? null,
            method: api.method,
            path: api.path,
            summary: api.summary ?? null,
            description: api.description ?? null,
            requestContentType: api.requestContentType ?? null,
            requestSchema: api.requestBody ?? null,
            parameters: api.parameters,
            deprecated: api.deprecated,
          })),
        );
        txTimer.mark("endpoints");

        const responseRows = model.apis.flatMap((api) =>
          api.responses.map((resp) => ({
            id: generateId("response"),
            endpointId: endpointIds.get(api.id)!,
            statusCode: resp.statusCode,
            description: resp.description,
            headers: [],
            contentType: resp.contentType ?? null,
            schema: resp.schema ?? null,
            isError: isErrorStatus(resp.statusCode),
          })),
        );
        if (responseRows.length > 0) {
          await tx.insert(endpointResponses).values(responseRows);
        }
        txTimer.mark("responses");

        const moduleRows = [...moduleIds.entries()].map(
          ([name, id], index) => ({
            id,
            repoId: task.repoId,
            versionId,
            name,
            description: model.tagDescriptions?.[name] ?? null,
            sortOrder: index,
          }),
        );
        if (moduleRows.length > 0) {
          await tx.insert(modules).values(moduleRows);
        }
        txTimer.mark("modules");

        const moduleLinks = model.apis.flatMap((api) =>
          api.tags.map((tag) => ({
            endpointId: endpointIds.get(api.id)!,
            moduleId: moduleIds.get(tag)!,
          })),
        );
        if (moduleLinks.length > 0) {
          await tx.insert(endpointModules).values(moduleLinks);
        }
        txTimer.mark("moduleLinks");
      }

      if (model.schemas.length > 0) {
        await tx.insert(dataModels).values(
          model.schemas.map((schema) => ({
            id: generateId("dataModel"),
            versionId,
            repoId: task.repoId,
            name: schema.name,
            schemaType: schema.type ?? null,
            schemaRaw: {
              type: schema.type ?? null,
              properties: schema.properties,
              required: schema.required,
            },
            description: schema.description ?? null,
            isModified: false,
          })),
        );
      }
      txTimer.mark("models");

      await tx
        .update(repositories)
        .set({ currentVersionId: versionId })
        .where(eq(repositories.id, task.repoId));
      txTimer.mark("pointer");

      return {
        endpoints: model.apis.length,
        models: model.schemas.length,
        modules: moduleCount(model.apis),
      };
    });
    timer.mark("transaction");

    const issues = model.parseIssues;
    await updateTask(taskId, {
      status: "succeeded",
      progress: 100,
      versionId,
      result: { stats, issues, nextVersion: version },
      finishedAt: new Date(),
    });

    await notifySafely({
      userId: task.userId,
      category: "import",
      type: "import.succeeded",
      priority: "medium",
      titleKey: "notifications.import.succeeded",
      titleParams: { repoName: repoRow.name, version },
      payload: {
        href: `/repos/${task.repoId}/endpoints?version=${versionId}`,
        repoId: task.repoId,
        versionId,
        taskId,
      },
      metadata: { orgId: null },
    });

    // 自动触发（默认关闭）：导入成功后联动创建上下文生成任务
    if (loadConfig().businessContext.autoGenerate) {
      await createContextTask(task.repoId, task.userId, {
        trigger: "auto",
        dependsOn: taskId,
      }).catch((err) => {
        logError("business.context.auto_trigger_failed", err, {
          repoId: task.repoId,
          importTaskId: taskId,
        });
      });
    }

    logInfo("openapi.import.completed", {
      taskId,
      repoId: task.repoId,
      userId: task.userId,
      versionId,
      version,
      specVersion: model.meta.specVersion ?? null,
      stats,
      issues: issueCounts(issues),
      durationMs: Date.now() - startedAt,
      timings: { ...timer.timings, transaction: txTimer.timings },
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
      payload: {
        href: `/repos/${task.repoId}/versions`,
        repoId: task.repoId,
        taskId,
      },
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
