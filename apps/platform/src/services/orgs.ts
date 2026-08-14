// ═══════════════════════════════════════════════════════════════════
// Platform Orgs Service — list / get / create organizations
// ═══════════════════════════════════════════════════════════════════
//
// App-level service (single consumer today). If admin/open ever need org
// operations, move this to packages/server verbatim.
// ═══════════════════════════════════════════════════════════════════

import { count, desc, eq, sql } from "drizzle-orm";
import {
  getDB,
  organizationMembers,
  organizations,
  repositories,
} from "@apigent/server/db";
import { generateId } from "@apigent/server/id";

export interface OrgSummary {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  repoCount: number;
  createdAt: Date;
}

export async function listOrgs(): Promise<OrgSummary[]> {
  const rows = await getDB()
    .select({
      id: organizations.id,
      name: organizations.name,
      description: organizations.description,
      createdAt: organizations.createdAt,
      memberCount: sql<number>`${count(organizationMembers.userId)}::int`,
      repoCount: sql<number>`${count(repositories.id)}::int`,
    })
    .from(organizations)
    .leftJoin(
      organizationMembers,
      eq(organizationMembers.orgId, organizations.id),
    )
    .leftJoin(repositories, eq(repositories.orgId, organizations.id))
    .groupBy(organizations.id)
    .orderBy(desc(organizations.createdAt));

  return rows.map((row) => ({
    ...row,
    memberCount: Number(row.memberCount ?? 0),
    repoCount: Number(row.repoCount ?? 0),
  }));
}

export async function getOrgById(id: string) {
  const [org] = await getDB()
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return org ?? null;
}

export async function updateOrg(
  id: string,
  input: { name?: string; description?: string },
) {
  const [org] = await getDB()
    .update(organizations)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.description !== undefined
        ? {
            description:
              input.description.trim() !== "" ? input.description.trim() : null,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, id))
    .returning();
  return org ?? null;
}

export async function createOrg(input: {
  name: string;
  ownerId: string;
  description?: string;
}) {
  const [org] = await getDB()
    .insert(organizations)
    .values({
      id: generateId("org"),
      name: input.name,
      ownerId: input.ownerId,
      description:
        input.description && input.description.trim() !== ""
          ? input.description.trim()
          : null,
    })
    .returning();
  return org;
}
