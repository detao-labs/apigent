// ═══════════════════════════════════════════════════════════════════
// Platform Repos Service — list / detail for API repositories
// ═══════════════════════════════════════════════════════════════════

import { and, count, desc, eq, sql } from "drizzle-orm";
import {
  dataModels,
  endpointModules,
  endpointResponses,
  endpoints,
  getDB,
  modules,
  organizations,
  repositories,
  repoVersions,
} from "@apigent/server/db";
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

export async function createRepo(input: {
  orgId: string;
  name: string;
  description?: string;
}): Promise<CreatedRepo> {
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
        input.description && input.description.trim() !== ""
          ? input.description.trim()
          : null,
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

  return {
    ...repo,
    mcpEnabled: Boolean(repo.mcpEnabled ?? false),
    orgName: org.name,
  };
}

export async function listRepos(): Promise<RepoSummary[]> {
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
      endpointCount: sql<number>`${count(endpoints.id)}::int`,
      currentVersion: sql<string | null>`
        (select ${repoVersions.version}
         from ${repoVersions}
         where ${repoVersions.repoId} = ${repositories.id}
         order by ${repoVersions.importedAt} desc
         limit 1)`,
    })
    .from(repositories)
    .leftJoin(organizations, eq(repositories.orgId, organizations.id))
    .leftJoin(endpoints, eq(endpoints.repoId, repositories.id))
    .groupBy(repositories.id, organizations.name, organizations.id)
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
  importedAt: Date;
  source: string;
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

export async function getRepoDetail(id: string): Promise<RepoDetail | null> {
  const db = getDB();
  const [repo] = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      description: repositories.description,
      orgName: organizations.name,
      orgId: organizations.id,
      mcpEnabled: repositories.mcpEnabled,
      currentVersion: repoVersions.version,
      currentSpecVersion: repoVersions.specVersion,
      capabilityContext: repositories.capabilityContext,
    })
    .from(repositories)
    .leftJoin(organizations, eq(repositories.orgId, organizations.id))
    .leftJoin(repoVersions, eq(repositories.currentVersionId, repoVersions.id))
    .where(eq(repositories.id, id))
    .limit(1);

  if (!repo) return null;

  const [ep] = await db
    .select({ value: sql<number>`${count(endpoints.id)}::int` })
    .from(endpoints)
    .where(eq(endpoints.repoId, id));
  const [dm] = await db
    .select({ value: sql<number>`${count(dataModels.id)}::int` })
    .from(dataModels)
    .where(eq(dataModels.repoId, id));
  const [ver] = await db
    .select({ value: sql<number>`${count(repoVersions.id)}::int` })
    .from(repoVersions)
    .where(eq(repoVersions.repoId, id));

  const versions = await db
    .select({
      id: repoVersions.id,
      version: repoVersions.version,
      specVersion: repoVersions.specVersion,
      importedAt: repoVersions.importedAt,
      source: repoVersions.source,
      endpointCount: sql<number>`${count(endpoints.id)}::int`,
    })
    .from(repoVersions)
    .leftJoin(endpoints, eq(endpoints.versionId, repoVersions.id))
    .where(eq(repoVersions.repoId, id))
    .groupBy(repoVersions.id)
    .orderBy(desc(repoVersions.importedAt))
    .limit(10);

  return {
    ...repo,
    mcpEnabled: Boolean(repo.mcpEnabled ?? false),
    capabilityContext: (repo.capabilityContext ?? null) as Record<
      string,
      unknown
    > | null,
    endpointCount: Number(ep?.value ?? 0),
    modelCount: Number(dm?.value ?? 0),
    versionCount: Number(ver?.value ?? 0),
    versions: versions.map((v) => ({
      ...v,
      source: v.source ?? "import",
      endpointCount: Number(v.endpointCount ?? 0),
    })),
  };
}

export interface RepoEndpointResponse {
  statusCode: string;
  description: string | null;
  content: unknown;
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
  requestSchema: unknown;
  responses: RepoEndpointResponse[];
}

/** 当前版本快照下的接口列表（含模块、参数、响应），供接口页展示。 */
export async function getRepoEndpoints(
  repoId: string,
): Promise<RepoEndpoint[]> {
  const db = getDB();
  const [repo] = await db
    .select({ currentVersionId: repositories.currentVersionId })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  if (!repo?.currentVersionId) return [];
  const versionId = repo.currentVersionId;

  const [endpointRows, moduleRows, responseRows] = await Promise.all([
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
        requestSchema: endpoints.requestSchema,
      })
      .from(endpoints)
      .where(and(eq(endpoints.repoId, repoId), eq(endpoints.versionId, versionId)))
      .orderBy(endpoints.path, endpoints.method),
    db
      .select({
        endpointId: endpointModules.endpointId,
        name: modules.name,
      })
      .from(endpointModules)
      .innerJoin(modules, eq(modules.id, endpointModules.moduleId))
      .innerJoin(endpoints, eq(endpoints.id, endpointModules.endpointId))
      .where(and(eq(endpoints.repoId, repoId), eq(endpoints.versionId, versionId))),
    db
      .select({
        endpointId: endpointResponses.endpointId,
        statusCode: endpointResponses.statusCode,
        description: endpointResponses.description,
        content: endpointResponses.content,
        isError: endpointResponses.isError,
      })
      .from(endpointResponses)
      .innerJoin(endpoints, eq(endpoints.id, endpointResponses.endpointId))
      .where(and(eq(endpoints.repoId, repoId), eq(endpoints.versionId, versionId)))
      .orderBy(endpointResponses.statusCode),
  ]);

  const moduleByEndpoint = new Map<string, string[]>();
  for (const row of moduleRows) {
    const list = moduleByEndpoint.get(row.endpointId) ?? [];
    list.push(row.name);
    moduleByEndpoint.set(row.endpointId, list);
  }
  const responsesByEndpoint = new Map<string, RepoEndpointResponse[]>();
  for (const row of responseRows) {
    const list = responsesByEndpoint.get(row.endpointId) ?? [];
    list.push({
      statusCode: row.statusCode,
      description: row.description,
      content: row.content,
      isError: Boolean(row.isError),
    });
    responsesByEndpoint.set(row.endpointId, list);
  }

  return endpointRows.map((row) => ({
    ...row,
    deprecated: Boolean(row.deprecated),
    parameters: (row.parameters ?? []) as unknown[],
    requestSchema: row.requestSchema ?? null,
    modules: moduleByEndpoint.get(row.id) ?? [],
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

/** 当前版本快照下的数据模型列表，供数据模型页展示。 */
export async function getRepoDataModels(
  repoId: string,
): Promise<RepoDataModel[]> {
  const db = getDB();
  const [repo] = await db
    .select({ currentVersionId: repositories.currentVersionId })
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);
  if (!repo?.currentVersionId) return [];

  const rows = await db
    .select({
      id: dataModels.id,
      name: dataModels.name,
      schemaType: dataModels.schemaType,
      description: dataModels.description,
      schemaRaw: dataModels.schemaRaw,
    })
    .from(dataModels)
    .where(
      and(
        eq(dataModels.repoId, repoId),
        eq(dataModels.versionId, repo.currentVersionId),
      ),
    )
    .orderBy(dataModels.name);

  return rows.map((row) => ({
    ...row,
    schemaRaw: (row.schemaRaw ?? null) as RepoDataModel["schemaRaw"],
  }));
}
