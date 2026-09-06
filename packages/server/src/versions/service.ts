// ═══════════════════════════════════════════════════════════════════
// Repo Versions Service — 分支(版本) 列表 / 新建 / 设为默认 / 回滚 / 对比
// ═══════════════════════════════════════════════════════════════════
//
// versions = 活线（branch），version_commits = 不可变快照（单父），
// version_entity_links = 版本树（commit → identity → blob）。
// 鉴权由调用方（platform API route）负责；本模块只做数据读写。
// ═══════════════════════════════════════════════════════════════════

import { and, desc, eq, sql } from "drizzle-orm";
import {
  getDB,
  components,
  dataModels,
  endpoints,
  versionCommits,
  versionEntityLinks,
  versions,
} from "../db";
import { generateId } from "../id";
import { diffVersionSnapshots, type DiffResult, type VersionSnapshot } from "../diff/engine";

export class VersionNotFoundError extends Error {
  constructor(versionId: string) {
    super(`Version not found: ${versionId}`);
    this.name = "VersionNotFoundError";
  }
}

export interface RepoVersionRow {
  id: string;
  name: string;
  isDefault: boolean;
  parentVersionId: string | null;
  headCommitId: string | null;
  specVersion: string | null;
  importedAt: Date;
  endpointCount: number;
  modelCount: number;
  componentCount: number;
}

/** 取某版本 head commit 下按类型的 link 数（entity_id 为多态引用，直接数 link 即可）。 */
async function countEntities(commitId: string | null, type: "endpoint" | "data_model" | "component"): Promise<number> {
  if (!commitId) return 0;
  const [row] = await getDB()
    .select({ value: sql<number>`count(*)::int` })
    .from(versionEntityLinks)
    .where(and(eq(versionEntityLinks.commitId, commitId), eq(versionEntityLinks.entityType, type)));
  return Number(row?.value ?? 0);
}

/** 列某仓库的所有版本（分支），按创建倒序。head commit 为空的统计 0。 */
export async function listVersions(repoId: string): Promise<RepoVersionRow[]> {
  const db = getDB();
  const rows = await db.select().from(versions).where(eq(versions.repoId, repoId)).orderBy(desc(versions.createdAt));

  return Promise.all(
    rows.map(async (v) => {
      const [commit] = v.headCommitId
        ? await db
            .select({ specVersion: versionCommits.specVersion, createdAt: versionCommits.createdAt })
            .from(versionCommits)
            .where(eq(versionCommits.id, v.headCommitId))
            .limit(1)
        : [];
      return {
        id: v.id,
        name: v.name,
        isDefault: v.isDefault,
        parentVersionId: v.parentVersionId,
        headCommitId: v.headCommitId,
        specVersion: commit?.specVersion ?? null,
        importedAt: commit?.createdAt ?? v.createdAt,
        endpointCount: await countEntities(v.headCommitId, "endpoint"),
        modelCount: await countEntities(v.headCommitId, "data_model"),
        componentCount: await countEntities(v.headCommitId, "component"),
      };
    }),
  );
}

export async function getDefaultVersionId(repoId: string): Promise<string | null> {
  const [row] = await getDB()
    .select({ id: versions.id })
    .from(versions)
    .where(and(eq(versions.repoId, repoId), eq(versions.isDefault, true)))
    .limit(1);
  return row?.id ?? null;
}

export interface CreateVersionInput {
  name: string;
  /** 基于哪个版本 fork；缺省为默认主版本；null 表示空树新建 */
  parentVersionId?: string | null;
  /** 空树新建：head 指向空 commit */
  empty?: boolean;
}

/** 新建版本（分支）。默认 `is_default=false`。 */
export async function createVersion(repoId: string, input: CreateVersionInput): Promise<string> {
  const db = getDB();
  const parent = input.parentVersionId === undefined ? await getDefaultVersionId(repoId) : input.parentVersionId;
  let headCommitId: string | null = null;

  if (!input.empty && parent) {
    const [parentRow] = await db
      .select({ headCommitId: versions.headCommitId })
      .from(versions)
      .where(eq(versions.id, parent))
      .limit(1);
    headCommitId = parentRow?.headCommitId ?? null;
  }

  const [v] = await db
    .insert(versions)
    .values({
      id: generateId("version"),
      repoId,
      name: input.name,
      parentVersionId: parent,
      headCommitId,
      isDefault: false,
    })
    .returning({ id: versions.id });
  if (!v) throw new Error("Failed to create version");
  return v.id;
}

/** 设为默认/主版本。 */
export async function setDefaultVersion(repoId: string, versionId: string): Promise<void> {
  const db = getDB();
  const [version] = await db
    .select({ id: versions.id })
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.repoId, repoId)))
    .limit(1);
  if (!version) throw new VersionNotFoundError(versionId);

  await db
    .update(versions)
    .set({ isDefault: false })
    .where(and(eq(versions.repoId, repoId), eq(versions.isDefault, true)));
  await db.update(versions).set({ isDefault: true }).where(eq(versions.id, versionId));
}

/** 回滚（R1，移指针）：把版本 head 指回目标 commit。 */
export async function rollbackVersion(repoId: string, versionId: string, targetCommitId: string): Promise<void> {
  const db = getDB();
  const [version] = await db
    .select({ id: versions.id })
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.repoId, repoId)))
    .limit(1);
  if (!version) throw new VersionNotFoundError(versionId);
  await db.update(versions).set({ headCommitId: targetCommitId }).where(eq(versions.id, versionId));
}

/** 回滚（R1，移指针）：把版本 head 沿 parent_commit_id 往回走 N 步。 */
export async function rollbackVersionSteps(repoId: string, versionId: string, steps: number): Promise<string> {
  const db = getDB();
  const [version] = await db
    .select({ id: versions.id, headCommitId: versions.headCommitId })
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.repoId, repoId)))
    .limit(1);
  if (!version) throw new VersionNotFoundError(versionId);

  let current = version.headCommitId;
  for (let i = 0; i < steps && current; i += 1) {
    const [commit] = await db
      .select({ parentCommitId: versionCommits.parentCommitId })
      .from(versionCommits)
      .where(eq(versionCommits.id, current))
      .limit(1);
    current = commit?.parentCommitId ?? null;
  }
  if (!current) throw new Error(`Version ${versionId} cannot roll back ${steps} step(s)`);

  await db.update(versions).set({ headCommitId: current }).where(eq(versions.id, versionId));
  return current;
}

// ───────────────────────────────────────────────────────────────
// 版本对比（diff 两 commit，复用 diff engine）
// ───────────────────────────────────────────────────────────────

async function loadCommitSnapshot(repoId: string, commitId: string | null): Promise<VersionSnapshot> {
  const db = getDB();
  if (!commitId) {
    return { endpoints: [], schemas: [], components: [] };
  }
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
      .from(versionEntityLinks)
      .innerJoin(endpoints, eq(endpoints.id, versionEntityLinks.entityId))
      .where(and(eq(versionEntityLinks.commitId, commitId), eq(versionEntityLinks.entityType, "endpoint"))),
    db
      .select({ name: dataModels.name, schemaType: dataModels.schemaType, schemaRaw: dataModels.schemaRaw })
      .from(versionEntityLinks)
      .innerJoin(dataModels, eq(dataModels.id, versionEntityLinks.entityId))
      .where(and(eq(versionEntityLinks.commitId, commitId), eq(versionEntityLinks.entityType, "data_model"))),
    db
      .select({ kind: components.kind, name: components.name, payload: components.payload })
      .from(versionEntityLinks)
      .innerJoin(components, eq(components.id, versionEntityLinks.entityId))
      .where(and(eq(versionEntityLinks.commitId, commitId), eq(versionEntityLinks.entityType, "component"))),
  ]);

  return {
    endpoints: endpointRows.map((e) => ({
      method: e.method,
      path: e.path,
      operationId: e.operationId,
      summary: e.summary,
      description: e.description,
      deprecated: e.deprecated ?? undefined,
      parameters: Array.isArray(e.parameters) ? (e.parameters as { name: string; in: string; required: boolean }[]) : [],
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

/** 对比两个 commit。from/to 传 commit id；传版本 id 时会取其 head commit。 */
export async function compareVersions(
  repoId: string,
  fromCommitId: string,
  toCommitId: string,
): Promise<DiffResult> {
  if (fromCommitId === toCommitId) throw new Error("Cannot compare a version with itself");
  const [fromSnapshot, toSnapshot] = await Promise.all([
    loadCommitSnapshot(repoId, fromCommitId),
    loadCommitSnapshot(repoId, toCommitId),
  ]);
  return diffVersionSnapshots(fromSnapshot, toSnapshot, fromCommitId, toCommitId);
}

export { loadCommitSnapshot };

export interface VersionHistoryEntry {
  commitId: string;
  versionId: string;
  versionName: string;
  specTitle: string | null;
  specVersion: string | null;
  source: string | null;
  changeSummary: {
    added: string[];
    updated: string[];
    removed: string[];
  } | null;
  createdAt: Date;
}

/** 仓库全部 commit 的变更日志（按时间倒序）。 */
export async function listVersionHistory(repoId: string): Promise<VersionHistoryEntry[]> {
  const rows = await getDB()
    .select({
      commitId: versionCommits.id,
      versionId: versionCommits.versionId,
      versionName: versions.name,
      specTitle: versionCommits.specTitle,
      specVersion: versionCommits.specVersion,
      source: versionCommits.source,
      changeSummary: versionCommits.changeSummary,
      createdAt: versionCommits.createdAt,
    })
    .from(versionCommits)
    .innerJoin(versions, eq(versions.id, versionCommits.versionId))
    .where(eq(versionCommits.repoId, repoId))
    .orderBy(desc(versionCommits.createdAt));
  return rows as VersionHistoryEntry[];
}

export interface DeleteEntityResult {
  commitId: string;
  identityKey: string;
  entityType: string;
}

/**
 * 手动删除：在目标版本上新建一个 commit，去掉该实体的 link（其内容仍作为 blob 保留，
 * 历史 commit 引用它），并把版本 head 移到新 commit。可回滚找回。
 */
export async function deleteVersionEntity(
  repoId: string,
  versionId: string,
  entityId: string,
): Promise<DeleteEntityResult> {
  const db = getDB();
  const [version] = await db
    .select({ headCommitId: versions.headCommitId })
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.repoId, repoId)))
    .limit(1);
  if (!version) throw new VersionNotFoundError(versionId);
  const parentCommitId = version.headCommitId;
  if (!parentCommitId) throw new Error(`Version ${versionId} has no head commit to delete from`);

  const [link] = await db
    .select({
      identityKey: versionEntityLinks.identityKey,
      entityType: versionEntityLinks.entityType,
    })
    .from(versionEntityLinks)
    .where(and(eq(versionEntityLinks.commitId, parentCommitId), eq(versionEntityLinks.entityId, entityId)))
    .limit(1);
  if (!link) throw new Error(`Entity not found in version ${versionId}: ${entityId}`);

  const parentLinks = await db
    .select({
      entityType: versionEntityLinks.entityType,
      identityKey: versionEntityLinks.identityKey,
      entityId: versionEntityLinks.entityId,
    })
    .from(versionEntityLinks)
    .where(eq(versionEntityLinks.commitId, parentCommitId));
  const remaining = parentLinks.filter((l) => !(l.entityId === entityId && l.identityKey === link.identityKey));

  const [parentMeta] = await db
    .select({
      specTitle: versionCommits.specTitle,
      specVersion: versionCommits.specVersion,
      description: versionCommits.description,
      specStoragePath: versionCommits.specStoragePath,
      tagMeta: versionCommits.tagMeta,
    })
    .from(versionCommits)
    .where(eq(versionCommits.id, parentCommitId))
    .limit(1);

  const commitId = generateId("commit");
  await db.insert(versionCommits).values({
    id: commitId,
    repoId,
    versionId,
    parentCommitId,
    specTitle: parentMeta?.specTitle ?? null,
    specVersion: parentMeta?.specVersion ?? null,
    description: parentMeta?.description ?? null,
    specStoragePath: parentMeta?.specStoragePath ?? null,
    source: "manual",
    tagMeta: parentMeta?.tagMeta ?? null,
    changeSummary: { added: [], updated: [], removed: [link.identityKey] },
  });
  if (remaining.length > 0) {
    await db
      .insert(versionEntityLinks)
      .values(remaining.map((l) => ({ ...l, commitId })))
      .onConflictDoNothing();
  }
  await db.update(versions).set({ headCommitId: commitId }).where(eq(versions.id, versionId));

  return { commitId, identityKey: link.identityKey, entityType: link.entityType };
}
