// ═══════════════════════════════════════════════════════════════════
// Repo Versions Service — 版本列表 / 设为当前 / 对比
// ═══════════════════════════════════════════════════════════════════
//
// 依赖 repo_versions（不可变快照） + repositories.current_version_id 指针。
// 鉴权由调用方（platform API route）负责（repo_viewer / repo_admin）。
// 本模块只做数据读取与切指针，不含 RBAC，便于独立测试 diff。
// ═══════════════════════════════════════════════════════════════════

import { and, desc, eq, sql } from "drizzle-orm";
import { getDB, repositories, repoVersions, endpoints, dataModels, components } from "../db";
import { diffVersionSnapshots, type DiffResult, type VersionSnapshot } from "../diff/engine";

export class VersionNotFoundError extends Error {
  constructor(versionId: string) {
    super(`Version not found: ${versionId}`);
    this.name = "VersionNotFoundError";
  }
}

export interface RepoVersionListRow {
  id: string;
  version: string;
  specVersion: string | null;
  importedAt: Date;
  source: string;
  endpointCount: number;
  modelCount: number;
  componentCount: number;
}

/** 某仓库的完整版本列表（倒序）。统计列实时 count，不落库。 */
export async function listRepoVersions(repoId: string): Promise<RepoVersionListRow[]> {
  const db = getDB();
  const rows = await db
    .select({
      id: repoVersions.id,
      version: repoVersions.version,
      specVersion: repoVersions.specVersion,
      importedAt: repoVersions.importedAt,
      source: repoVersions.source,
      endpointCount: sql<number>`
        (select count(*) from ${endpoints} where ${endpoints.versionId} = ${repoVersions.id})::int`,
      modelCount: sql<number>`
        (select count(*) from ${dataModels} where ${dataModels.versionId} = ${repoVersions.id})::int`,
      componentCount: sql<number>`
        (select count(*) from ${components} where ${components.versionId} = ${repoVersions.id})::int`,
    })
    .from(repoVersions)
    .where(eq(repoVersions.repoId, repoId))
    .orderBy(desc(repoVersions.importedAt));

  return rows.map((r) => ({
    ...r,
    source: r.source ?? "import",
    endpointCount: Number(r.endpointCount ?? 0),
    modelCount: Number(r.modelCount ?? 0),
    componentCount: Number(r.componentCount ?? 0),
  }));
}

/** 设为当前版本：只切换指针，不改动任何快照（不可变）。 */
export async function activateVersion(repoId: string, versionId: string): Promise<void> {
  const db = getDB();
  const [version] = await db
    .select({ id: repoVersions.id })
    .from(repoVersions)
    .where(and(eq(repoVersions.id, versionId), eq(repoVersions.repoId, repoId)))
    .limit(1);
  if (!version) throw new VersionNotFoundError(versionId);

  await db
    .update(repositories)
    .set({ currentVersionId: versionId })
    .where(eq(repositories.id, repoId));
}

/** 读取某版本的结构快照，用于 diff。 */
async function loadVersionSnapshot(repoId: string, versionId: string): Promise<VersionSnapshot> {
  const db = getDB();
  const [endpointRows, schemaRows, componentRows] = await Promise.all([
    db
      .select({
        method: endpoints.method,
        path: endpoints.path,
        operationId: endpoints.operationId,
        summary: endpoints.summary,
        description: endpoints.description,
        deprecated: endpoints.deprecated,
        parameters: endpoints.parameters,
        requestContentType: endpoints.requestContentType,
        requestSchema: endpoints.requestSchema,
      })
      .from(endpoints)
      .where(and(eq(endpoints.versionId, versionId), eq(endpoints.repoId, repoId))),
    db
      .select({
        name: dataModels.name,
        schemaType: dataModels.schemaType,
        schemaRaw: dataModels.schemaRaw,
      })
      .from(dataModels)
      .where(and(eq(dataModels.versionId, versionId), eq(dataModels.repoId, repoId))),
    db
      .select({ kind: components.kind, name: components.name, payload: components.payload })
      .from(components)
      .where(and(eq(components.versionId, versionId), eq(components.repoId, repoId))),
  ]);

  return {
    endpoints: endpointRows.map((e) => ({
      method: e.method,
      path: e.path,
      operationId: e.operationId,
      summary: e.summary,
      description: e.description,
      deprecated: e.deprecated ?? undefined,
      parameters: Array.isArray(e.parameters)
        ? (e.parameters as { name: string; in: string; required: boolean }[])
        : [],
      requestContentType: e.requestContentType,
      hasRequestBody: Boolean(e.requestSchema),
    })),
    schemas: schemaRows.map((s) => ({
      name: s.name,
      type: s.schemaType,
      schemaRaw: (s.schemaRaw ?? {}) as VersionSnapshot["schemas"][number]["schemaRaw"],
    })),
    components: componentRows.map((c) => ({
      kind: c.kind,
      name: c.name,
      payload: (c.payload ?? {}) as Record<string, unknown>,
    })),
  };
}

/** 对比两个版本（from → to）返回变更详情。调用方负责版本存在性校验。 */
export async function compareVersions(
  repoId: string,
  fromVersionId: string,
  toVersionId: string,
): Promise<DiffResult> {
  if (fromVersionId === toVersionId) {
    throw new Error("Cannot compare a version with itself");
  }
  const [fromSnapshot, toSnapshot] = await Promise.all([
    loadVersionSnapshot(repoId, fromVersionId),
    loadVersionSnapshot(repoId, toVersionId),
  ]);
  return diffVersionSnapshots(fromSnapshot, toSnapshot, fromVersionId, toVersionId);
}

/** 取当前版本 id（供页面标记「当前」）。 */
export async function getCurrentVersionId(repoId: string): Promise<string | null> {
  const [row] = await getDB()
    .select({ id: repositories.currentVersionId })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  return row?.id ?? null;
}
