// ═══════════════════════════════════════════════════════════════════
// Platform Repos Service — list / detail / entities for API repositories
// ═══════════════════════════════════════════════════════════════════
//
// 新模型：versions = 活线(branch)，version_commits = 快照，
// version_entity_links = 版本树（commit → identity → blob）。
// 模块（tag 分组）由 endpoints.tags 派生，不再有 modules 表。
// ═══════════════════════════════════════════════════════════════════

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  components,
  dataModels,
  endpointResponses,
  endpoints,
  getDB,
  organizations,
  repositories,
  users,
  versionCommits,
  versionEntityLinks,
  versions,
} from "@apigent/server/db";
import {
  ForbiddenError,
  assertOrgRole,
  assertRepoAccess,
  listAccessibleRepoIds,
} from "@apigent/server/authz";
import { generateId } from "@apigent/server/id";
import { getOrgById } from "@/services/orgs";

export interface RepoSummary {
  id: string;
  name: string;
  description: string | null;
  orgName: string | null;
  orgId: string | null;
  endpointCount: number;
  currentVersion: string | null;
  mcpEnabled: boolean;
  updatedAt: Date;
}

export class OrgNotFoundError extends Error {
  constructor(orgId: string) {
    super(`Organization not found: ${orgId}`);
    this.name = "OrgNotFoundError";
  }
}

export interface CreatedRepo {
  id: string;
  name: string;
  description: string | null;
  orgId: string;
  orgName: string;
  mcpEnabled: boolean;
  createdAt: Date;
}

export async function createRepo(
  input: {
    orgId: string;
    name: string;
    description?: string;
  },
  userId: string,
): Promise<CreatedRepo> {
  await assertOrgRole(userId, input.orgId, "org_member");
  const org = await getOrgById(input.orgId);
  if (!org) throw new OrgNotFoundError(input.orgId);

  const db = getDB();
  const [repo] = await db
    .insert(repositories)
    .values({
      id: generateId("repo"),
      orgId: org.id,
      name: input.name,
      description:
        input.description && input.description.trim() !== "" ? input.description.trim() : null,
    })
    .returning({
      id: repositories.id,
      name: repositories.name,
      description: repositories.description,
      orgId: repositories.orgId,
      mcpEnabled: repositories.mcpEnabled,
      createdAt: repositories.createdAt,
    });

  if (!repo) throw new Error("Failed to create repository");

  // 新建仓库即创建默认 main 版本（活线），首个导入前 head 为 NULL。
  await db.insert(versions).values({
    id: generateId("version"),
    repoId: repo.id,
    name: "main",
    isDefault: true,
    headCommitId: null,
  });

  return {
    ...repo,
    mcpEnabled: Boolean(repo.mcpEnabled ?? false),
    orgName: org.name,
  };
}

export async function updateRepo(
  repoId: string,
  input: { name?: string; description?: string },
  userId: string,
) {
  await assertRepoAccess(userId, repoId, "repo_editor");
  const db = getDB();
  const [repo] = await db
    .update(repositories)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? {
            description: input.description.trim() !== "" ? input.description.trim() : null,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repoId))
    .returning({
      id: repositories.id,
      name: repositories.name,
      description: repositories.description,
      orgId: repositories.orgId,
      mcpEnabled: repositories.mcpEnabled,
      updatedAt: repositories.updatedAt,
    });
  if (!repo) throw new Error(`Repository not found: ${repoId}`);
  return { ...repo, mcpEnabled: Boolean(repo.mcpEnabled ?? false) };
}

export async function listRepos(userId: string): Promise<RepoSummary[]> {
  const accessible = await listAccessibleRepoIds(userId);
  if (accessible.length === 0) return [];
  const db = getDB();

  const rows = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      description: repositories.description,
      orgName: organizations.name,
      orgId: organizations.id,
      mcpEnabled: repositories.mcpEnabled,
      updatedAt: repositories.updatedAt,
      currentVersion: versions.name,
      endpointCount: sql<number>`(
        select count(*)::int
        from version_entity_links vel
        where vel.commit_id = ${versions.headCommitId}
          and vel.entity_type = 'endpoint'
      )`,
    })
    .from(repositories)
    .leftJoin(organizations, eq(repositories.orgId, organizations.id))
    .leftJoin(versions, and(eq(versions.repoId, repositories.id), eq(versions.isDefault, true)))
    .where(inArray(repositories.id, accessible))
    .orderBy(desc(repositories.updatedAt));

  return rows.map((row) => ({
    ...row,
    mcpEnabled: Boolean(row.mcpEnabled ?? false),
    endpointCount: Number(row.endpointCount ?? 0),
  }));
}

export interface RepoVersionSummary {
  id: string;
  version: string;
  specVersion: string | null;
  isDefault: boolean;
  source: string;
  importedAt: Date;
  endpointCount: number;
}

export interface RepoDetail {
  id: string;
  name: string;
  description: string | null;
  orgName: string | null;
  orgId: string | null;
  mcpEnabled: boolean;
  currentVersion: string | null;
  currentSpecVersion: string | null;
  capabilityContext: Record<string, unknown> | null;
  endpointCount: number;
  modelCount: number;
  versionCount: number;
  versions: RepoVersionSummary[];
}

export async function getRepoDetail(id: string, userId: string): Promise<RepoDetail | null> {
  await assertRepoAccess(userId, id, "repo_viewer");
  const db = getDB();
  const [repo] = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      description: repositories.description,
      orgName: organizations.name,
      orgId: organizations.id,
      mcpEnabled: repositories.mcpEnabled,
      capabilityContext: repositories.capabilityContext,
    })
    .from(repositories)
    .leftJoin(organizations, eq(repositories.orgId, organizations.id))
    .where(eq(repositories.id, id))
    .limit(1);
  if (!repo) return null;

  const allVersions = await db.select().from(versions).where(eq(versions.repoId, id)).orderBy(desc(versions.createdAt));
  const defaultVersion = allVersions.find((v) => v.isDefault) ?? null;
  const headCommitId = defaultVersion?.headCommitId ?? null;

  const [ep, dm] = await Promise.all([
    headCommitId
      ? db
          .select({ value: sql<number>`count(*)::int` })
          .from(versionEntityLinks)
          .where(and(eq(versionEntityLinks.commitId, headCommitId), eq(versionEntityLinks.entityType, "endpoint")))
      : undefined,
    headCommitId
      ? db
          .select({ value: sql<number>`count(*)::int` })
          .from(versionEntityLinks)
          .where(and(eq(versionEntityLinks.commitId, headCommitId), eq(versionEntityLinks.entityType, "data_model")))
      : undefined,
  ]);

  // 各版本的统计（取 head commit 的 endpoint 数）
  const verCounts = await Promise.all(
    allVersions.map(async (v) => {
      const [head] = v.headCommitId
        ? await db
            .select({ specVersion: versionCommits.specVersion, source: versionCommits.source })
            .from(versionCommits)
            .where(eq(versionCommits.id, v.headCommitId))
            .limit(1)
        : [];
      return {
        id: v.id,
        version: v.name,
        specVersion: head?.specVersion ?? null,
        isDefault: v.isDefault,
        source: head?.source ?? "import",
        importedAt: v.createdAt,
        endpointCount: v.headCommitId
          ? Number(
              (
                await db
                  .select({ value: sql<number>`count(*)::int` })
                  .from(versionEntityLinks)
                  .where(
                    and(
                      eq(versionEntityLinks.commitId, v.headCommitId),
                      eq(versionEntityLinks.entityType, "endpoint"),
                    ),
                  )
              )[0]?.value ?? 0,
            )
          : 0,
      };
    }),
  );

  return {
    ...repo,
    mcpEnabled: Boolean(repo.mcpEnabled ?? false),
    capabilityContext: (repo.capabilityContext ?? null) as Record<string, unknown> | null,
    endpointCount: Number(ep?.[0]?.value ?? 0),
    modelCount: Number(dm?.[0]?.value ?? 0),
    versionCount: allVersions.length,
    currentVersion: defaultVersion?.name ?? null,
    currentSpecVersion: headCommitId
      ? (
          await db
            .select({ specVersion: versionCommits.specVersion })
            .from(versionCommits)
            .where(eq(versionCommits.id, headCommitId))
            .limit(1)
        )[0]?.specVersion ?? null
      : null,
    versions: verCounts,
  };
}

export interface RepoLoadOwner {
  name: string;
  email: string;
}

export type RepoLoadResult =
  | { status: "ok"; repo: RepoDetail; owner: RepoLoadOwner | null }
  | { status: "forbidden"; repo: null; owner: RepoLoadOwner | null }
  | { status: "not-found"; repo: null; owner: RepoLoadOwner | null };

export async function loadRepoForPage(id: string, userId: string): Promise<RepoLoadResult> {
  try {
    const repo = await getRepoDetail(id, userId);
    return repo
      ? { status: "ok", repo, owner: null }
      : { status: "not-found", repo: null, owner: null };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { status: "forbidden", repo: null, owner: await getRepoOwnerContact(id) };
    }
    throw err;
  }
}

async function getRepoOwnerContact(repoId: string): Promise<RepoLoadOwner | null> {
  const db = getDB();
  const [repo] = await db
    .select({ orgId: repositories.orgId })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  if (!repo) return null;
  const [org] = await db
    .select({ ownerId: organizations.ownerId })
    .from(organizations)
    .where(eq(organizations.id, repo.orgId))
    .limit(1);
  if (!org) return null;
  const [owner] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, org.ownerId))
    .limit(1);
  return owner ? { name: owner.name, email: owner.email } : null;
}

export interface RepoEndpointResponse {
  statusCode: string;
  description: string | null;
  contentType: string | null;
  schema: unknown;
  isError: boolean;
}

export interface RepoEndpoint {
  id: string;
  operationId: string | null;
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  deprecated: boolean;
  modules: string[];
  parameters: unknown[];
  requestContentType: string | null;
  requestSchema: unknown;
  responses: RepoEndpointResponse[];
}

/** 解析默认主版本 head commit。 */
async function defaultHeadCommitId(repoId: string): Promise<string | null> {
  const db = getDB();
  const [v] = await db
    .select({ headCommitId: versions.headCommitId })
    .from(versions)
    .where(and(eq(versions.repoId, repoId), eq(versions.isDefault, true)))
    .limit(1);
  return v?.headCommitId ?? null;
}

/** 默认主版本下的接口列表（模块由 tags 派生）。 */
export async function getRepoEndpoints(repoId: string, userId: string): Promise<RepoEndpoint[]> {
  await assertRepoAccess(userId, repoId, "repo_viewer");
  const db = getDB();
  const commitId = await defaultHeadCommitId(repoId);
  if (!commitId) return [];

  const [endpointRows, responseRows] = await Promise.all([
    db
      .select({
        id: endpoints.id,
        operationId: endpoints.operationId,
        method: endpoints.method,
        path: endpoints.path,
        summary: endpoints.summary,
        description: endpoints.description,
        deprecated: endpoints.deprecated,
        parameters: endpoints.parameters,
        requestContentType: endpoints.requestContentType,
        requestSchema: endpoints.requestSchema,
        tags: endpoints.tags,
      })
      .from(versionEntityLinks)
      .innerJoin(endpoints, eq(endpoints.id, versionEntityLinks.entityId))
      .where(and(eq(versionEntityLinks.commitId, commitId), eq(versionEntityLinks.entityType, "endpoint")))
      .orderBy(endpoints.path, endpoints.method),
    db
      .select({
        endpointId: endpointResponses.endpointId,
        statusCode: endpointResponses.statusCode,
        description: endpointResponses.description,
        contentType: endpointResponses.contentType,
        schema: endpointResponses.schema,
        isError: endpointResponses.isError,
      })
      .from(endpointResponses)
      .innerJoin(endpoints, eq(endpoints.id, endpointResponses.endpointId))
      .innerJoin(versionEntityLinks, eq(versionEntityLinks.entityId, endpoints.id))
      .where(and(eq(versionEntityLinks.commitId, commitId), eq(versionEntityLinks.entityType, "endpoint")))
      .orderBy(endpointResponses.statusCode),
  ]);

  const responsesByEndpoint = new Map<string, RepoEndpointResponse[]>();
  for (const row of responseRows) {
    const list = responsesByEndpoint.get(row.endpointId) ?? [];
    list.push({
      statusCode: row.statusCode,
      description: row.description,
      contentType: row.contentType,
      schema: row.schema,
      isError: Boolean(row.isError),
    });
    responsesByEndpoint.set(row.endpointId, list);
  }

  return endpointRows.map((row) => ({
    ...row,
    deprecated: Boolean(row.deprecated),
    parameters: (row.parameters ?? []) as unknown[],
    requestContentType: row.requestContentType ?? null,
    requestSchema: row.requestSchema ?? null,
    modules: (row.tags ?? []) as string[],
    responses: responsesByEndpoint.get(row.id) ?? [],
  }));
}

export interface RepoDataModel {
  id: string;
  name: string;
  schemaType: string | null;
  description: string | null;
  schemaRaw: {
    type?: string | null;
    properties?: Record<string, unknown>;
    required?: string[];
  } | null;
}

export async function getRepoDataModels(repoId: string, userId: string): Promise<RepoDataModel[]> {
  await assertRepoAccess(userId, repoId, "repo_viewer");
  const db = getDB();
  const commitId = await defaultHeadCommitId(repoId);
  if (!commitId) return [];

  const rows = await db
    .select({
      id: dataModels.id,
      name: dataModels.name,
      schemaType: dataModels.schemaType,
      description: dataModels.description,
      schemaRaw: dataModels.schemaRaw,
    })
    .from(versionEntityLinks)
    .innerJoin(dataModels, eq(dataModels.id, versionEntityLinks.entityId))
    .where(and(eq(versionEntityLinks.commitId, commitId), eq(versionEntityLinks.entityType, "data_model")))
    .orderBy(dataModels.name);

  return rows.map((row) => ({
    ...row,
    schemaRaw: (row.schemaRaw ?? null) as RepoDataModel["schemaRaw"],
  }));
}

export type ComponentKind =
  | "response"
  | "securityScheme"
  | "parameter"
  | "requestBody"
  | "header"
  | "example"
  | "link"
  | "callback";

export interface RepoComponentDef {
  id: string;
  kind: ComponentKind;
  name: string;
  defType: string | null;
  description: string | null;
  payload: Record<string, unknown>;
}

export async function getRepoComponentDefs(
  repoId: string,
  userId: string,
  kind?: ComponentKind,
): Promise<RepoComponentDef[]> {
  await assertRepoAccess(userId, repoId, "repo_viewer");
  const db = getDB();
  const commitId = await defaultHeadCommitId(repoId);
  if (!commitId) return [];

  const conditions = [eq(versionEntityLinks.commitId, commitId), eq(versionEntityLinks.entityType, "component")];
  if (kind) conditions.push(eq(components.kind, kind));

  const rows = await db
    .select({
      id: components.id,
      kind: components.kind,
      name: components.name,
      defType: components.defType,
      description: components.description,
      payload: components.payload,
    })
    .from(versionEntityLinks)
    .innerJoin(components, eq(components.id, versionEntityLinks.entityId))
    .where(and(...conditions))
    .orderBy(components.kind, components.name);

  return rows.map((row) => ({
    ...row,
    kind: row.kind as ComponentKind,
    payload: (row.payload ?? {}) as Record<string, unknown>,
  }));
}
