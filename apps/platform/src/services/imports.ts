// ═══════════════════════════════════════════════════════════════════
// Platform Import Service — OpenAPI 预览（异步提交见 @apigent/server/imports）
// ═══════════════════════════════════════════════════════════════════
//
// 预览阶段只解析不落库，返回统计 + 问题列表；确认后的导入由
// packages/server 的异步任务执行（createImportTask / import_tasks）。

import { eq } from "drizzle-orm";
import { parseOpenAPI } from "@apigent/server/openapi";
import type { ParseIssue } from "@apigent/server/openapi";
import { getDB, repositories } from "@apigent/server/db";
import {
  createTimer,
  hasFatalIssue,
  issueCounts,
  moduleCount,
  RepoNotFoundError,
} from "@apigent/server/imports";
import { logError, logInfo } from "@/lib/logger";

export { ImportError, MAX_SPEC_BYTES, RepoNotFoundError } from "@apigent/server/imports";

export interface ImportPreview {
  openapiVersion: string;
  specTitle: string | null;
  specVersion: string | null;
  fatal: boolean;
  stats: {
    endpoints: number;
    models: number;
    modules: number;
  };
  issues: ParseIssue[];
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

    const preview: ImportPreview = {
      openapiVersion: model.meta.openapiVersion,
      specTitle: model.meta.specTitle ?? null,
      specVersion: model.meta.specVersion ?? null,
      fatal: hasFatalIssue(model.parseIssues),
      stats: {
        endpoints: model.apis.length,
        models: model.schemas.length,
        modules: moduleCount(model.apis),
      },
      issues: model.parseIssues,
    };

    logInfo("openapi.import.preview", {
      repoId,
      durationMs: Date.now() - startedAt,
      timings: timer.timings,
      openapiVersion: preview.openapiVersion,
      specVersion: preview.specVersion,
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
