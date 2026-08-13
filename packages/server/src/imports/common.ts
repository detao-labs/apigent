// ═══════════════════════════════════════════════════════════════════
// Import Common — 共享常量、错误与工具
// ═══════════════════════════════════════════════════════════════════

import { count, eq } from "drizzle-orm";
import type { ParseIssue } from "../openapi";
import { getDB } from "../db";
import { repoVersions } from "../db";

export const MAX_SPEC_BYTES = 5 * 1024 * 1024;
export const IMPORT_QUEUE = "openapi.import";

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

export class DuplicateImportError extends Error {
  constructor(public readonly activeTaskId: string) {
    super("Repository already has an import task in progress");
    this.name = "DuplicateImportError";
  }
}

/** 文档级错误（无法解析 / 版本不支持）视为阻断；单接口错误宽容处理。 */
export function hasFatalIssue(issues: ParseIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error" && !issue.apiId);
}

export function moduleCount(apis: Array<{ tags: string[] }>): number {
  return new Set(apis.flatMap((api) => api.tags)).size;
}

export function isErrorStatus(statusCode: string): boolean {
  const code = Number.parseInt(statusCode, 10);
  return Number.isFinite(code) && code >= 400;
}

export function issueCounts(issues: ParseIssue[]) {
  return {
    errors: issues.filter((issue) => issue.severity === "error").length,
    warnings: issues.filter((issue) => issue.severity === "warning").length,
  };
}

/** 分段耗时计时器：mark 记录上一段到现在的毫秒数。 */
export function createTimer() {
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

/** 下一个导入序号（v1/v2/v3…） */
export async function nextVersionFor(repoId: string): Promise<string> {
  const db = getDB();
  const [row] = await db
    .select({ value: count() })
    .from(repoVersions)
    .where(eq(repoVersions.repoId, repoId));
  return `v${(row?.value ?? 0) + 1}`;
}
