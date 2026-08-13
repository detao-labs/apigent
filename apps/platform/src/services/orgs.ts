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

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  repoCount: number;
  createdAt: Date;
}

export async function listOrgs(): Promise<OrgSummary[]> {
  const rows = await getDB()
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
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

export async function getOrgBySlug(slug: string) {
  const [org] = await getDB()
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return org ?? null;
}

export async function createOrg(input: {
  name: string;
  slug: string;
  ownerId: string;
}) {
  const [org] = await getDB().insert(organizations).values(input).returning();
  return org;
}
