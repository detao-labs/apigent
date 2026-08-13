// ═══════════════════════════════════════════════════════════════════
// Platform Repos Service — list / detail for API repositories
// ═══════════════════════════════════════════════════════════════════

import { count, desc, eq, sql } from "drizzle-orm";
import {
  dataModels,
  endpoints,
  getDB,
  organizations,
  repositories,
  repoVersions,
} from "@apigent/server/db";

export interface RepoSummary {
  id: string;
  name: string;
  description: string | null;
  orgName: string | null;
  orgSlug: string | null;
  endpointCount: number;
  currentVersion: string | null;
  mcpEnabled: boolean;
  updatedAt: Date;
}

export async function listRepos(): Promise<RepoSummary[]> {
  const db = getDB();
  const rows = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      description: repositories.description,
      orgName: organizations.name,
      orgSlug: organizations.slug,
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
    .groupBy(repositories.id, organizations.name, organizations.slug)
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
  importedAt: Date;
  source: string;
  endpointCount: number;
}

export interface RepoDetail {
  id: string;
  name: string;
  description: string | null;
  orgName: string | null;
  orgSlug: string | null;
  mcpEnabled: boolean;
  currentVersion: string | null;
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
      orgSlug: organizations.slug,
      mcpEnabled: repositories.mcpEnabled,
      currentVersion: repoVersions.version,
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
