// ═══════════════════════════════════════════════════════════════════
// Platform Import Service — OpenAPI 预览 / 导入（创建不可变版本快照）
// ═══════════════════════════════════════════════════════════════════
//
// 设计（与 UX 稿一致，git-like 版本模型）：
// - 预览阶段只解析不落库，返回统计 + 问题列表；
// - 确认后创建新快照：repo_versions 一行 + 挂在该版本下的
//   endpoints / data_models / modules / endpoint_modules / endpoint_responses，
//   最后把 repositories.current_version_id 指针切到新版本，旧快照保留可回滚。
// - version 为导入序号 v1/v2/v3…，OpenAPI info.version 存入 spec_version 展示。
//
// TODO(后续迭代)：导入解析 + 落库为长耗时操作，改为异步任务执行（队列 Worker，
// 见 docs/tech-design.zh.md 异步任务章节），提交后立即返回任务进度，结果通过
// 顶栏消息通知 + 仓库详情状态徽章展示（进行中 / 成功 / 失败可重试）。
// 同步实现为 V0 基线，日志打点（openapi.import.*）为时长统计与排查预留。

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { count, eq } from "drizzle-orm";
import { parseOpenAPI } from "@apigent/server/openapi";
import type { ParseIssue, ParsedAPIModel } from "@apigent/server/openapi";
import { generateId } from "@apigent/server/id";
import {
  dataModels,
  endpointModules,
  endpointResponses,
  endpoints,
  getDB,
  modules,
  repositories,
  repoVersions,
} from "@apigent/server/db";
import { logError, logInfo } from "@/lib/logger";

export const MAX_SPEC_BYTES = 5 * 1024 * 1024;

export class ImportError extends Error {
  constructor(public readonly issues: ParseIssue[]) {
    super("OpenAPI document is not importable");
    this.name = "ImportError";
  }
}

export class RepoNotFoundError extends Error {
  constructor(repoId: string) {
    super(`Repository not found: ${repoId}`);
    this.name = "RepoNotFoundError";
  }
}

export interface ImportPreview {
  openapiVersion: string;
  specTitle: string | null;
  specVersion: string | null;
  /** 确认导入后将创建的版本号（导入序号） */
  nextVersion: string;
  fatal: boolean;
  stats: {
    endpoints: number;
    models: number;
    modules: number;
  };
  issues: ParseIssue[];
}

export interface ImportResult {
  versionId: string;
  version: string;
  specVersion: string | null;
  stats: {
    endpoints: number;
    models: number;
    modules: number;
  };
  issues: ParseIssue[];
}

/** 文档级错误（无法解析 / 版本不支持）视为阻断；单接口错误宽容处理。 */
function hasFatalIssue(issues: ParseIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error" && !issue.apiId);
}

function moduleCount(model: ParsedAPIModel): number {
  return new Set(model.apis.flatMap((api) => api.tags)).size;
}

async function nextVersionFor(repoId: string): Promise<string> {
  const db = getDB();
  const [row] = await db
    .select({ value: count() })
    .from(repoVersions)
    .where(eq(repoVersions.repoId, repoId));
  return `v${(row?.value ?? 0) + 1}`;
}

export async function previewImport(
  repoId: string,
  content: string,
): Promise<ImportPreview> {
  const startedAt = Date.now();
  const timer = createTimer();
  try {
    const db = getDB();
    const [repoRow] = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);
    timer.mark("repoCheck");
    if (!repoRow) throw new RepoNotFoundError(repoId);

    const model = parseOpenAPI({ source: "text", content, repoId });
    timer.mark("parse");
    const nextVersion = await nextVersionFor(repoId);
    timer.mark("nextVersion");

    const preview: ImportPreview = {
      openapiVersion: model.meta.openapiVersion,
      specTitle: model.meta.specTitle ?? null,
      specVersion: model.meta.specVersion ?? null,
      nextVersion,
      fatal: hasFatalIssue(model.parseIssues),
      stats: {
        endpoints: model.apis.length,
        models: model.schemas.length,
        modules: moduleCount(model),
      },
      issues: model.parseIssues,
    };

    logInfo("openapi.import.preview", {
      repoId,
      durationMs: Date.now() - startedAt,
      timings: timer.timings,
      openapiVersion: preview.openapiVersion,
      specVersion: preview.specVersion,
      nextVersion,
      fatal: preview.fatal,
      stats: preview.stats,
      issues: issueCounts(preview.issues),
    });
    return preview;
  } catch (err) {
    logError("openapi.import.preview_failed", err, {
      repoId,
      durationMs: Date.now() - startedAt,
      timings: timer.timings,
    });
    throw err;
  }
}

export async function importVersion(
  repoId: string,
  content: string,
): Promise<ImportResult> {
  const startedAt = Date.now();
  const timer = createTimer();
  let storagePath: string | null = null;
  try {
    if (Buffer.byteLength(content, "utf8") > MAX_SPEC_BYTES) {
      throw new ImportError([
        {
          severity: "error",
          message: `OpenAPI document exceeds the ${MAX_SPEC_BYTES / 1024 / 1024}MB limit`,
        },
      ]);
    }

    const model = parseOpenAPI({ source: "text", content, repoId });
    timer.mark("parse");
    if (hasFatalIssue(model.parseIssues)) {
      throw new ImportError(model.parseIssues);
    }

    const db = getDB();
    const [repoRow] = await db
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.id, repoId))
      .limit(1);
    timer.mark("repoCheck");
    if (!repoRow) throw new RepoNotFoundError(repoId);

    const versionId = generateId("version");
    const version = await nextVersionFor(repoId);
    timer.mark("nextVersion");
    const ext = content.trimStart().startsWith("{") ? ".json" : ".yaml";
    storagePath = path.join(
      process.cwd(),
      ".data",
      "specs",
      repoId,
      `${versionId}${ext}`,
    );

    // 先落盘原文，再开事务写结构化数据；事务失败时清理文件。
    await mkdir(path.dirname(storagePath), { recursive: true });
    await writeFile(storagePath, content, "utf8");
    timer.mark("specWrite");
    // 事务回调内 TS 不会保留 let 变量的收窄，先固定为 string。
    const specStoragePath = storagePath;

    const txTimer = createTimer();
    const stats = await db.transaction(async (tx) => {
      await tx.insert(repoVersions).values({
        id: versionId,
        repoId,
        version,
        specVersion: model.meta.specVersion ?? null,
        specStoragePath,
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
            repoId,
            operationId: api.operationId ?? null,
            method: api.method,
            path: api.path,
            summary: api.summary ?? null,
            description: api.description ?? null,
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
            content: resp.content ?? null,
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
            repoId,
            versionId,
            name,
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
            repoId,
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
        .where(eq(repositories.id, repoId));
      txTimer.mark("pointer");

      return {
        endpoints: model.apis.length,
        models: model.schemas.length,
        modules: moduleCount(model),
      };
    });
    timer.mark("transaction");

    const result: ImportResult = {
      versionId,
      version,
      specVersion: model.meta.specVersion ?? null,
      stats,
      issues: model.parseIssues,
    };

    logInfo("openapi.import.completed", {
      repoId,
      versionId,
      version,
      specVersion: result.specVersion,
      stats: result.stats,
      issues: issueCounts(result.issues),
      durationMs: Date.now() - startedAt,
      timings: {
        ...timer.timings,
        transaction: txTimer.timings,
      },
    });
    return result;
  } catch (err) {
    logError("openapi.import.failed", err, {
      repoId,
      durationMs: Date.now() - startedAt,
      timings: timer.timings,
    });
    if (storagePath) await unlink(storagePath).catch(() => {});
    throw err;
  }
}

function isErrorStatus(statusCode: string): boolean {
  const code = Number.parseInt(statusCode, 10);
  return Number.isFinite(code) && code >= 400;
}

function issueCounts(issues: ParseIssue[]) {
  return {
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
  };
}

/** 分段耗时计时器：mark 记录上一段到现在的毫秒数。 */
function createTimer() {
  let last = Date.now();
  const timings: Record<string, number> = {};
  return {
    timings,
    mark(key: string) {
      const now = Date.now();
      timings[key] = now - last;
      last = now;
    },
  };
}
