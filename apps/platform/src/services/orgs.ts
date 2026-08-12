// ═══════════════════════════════════════════════════════════════════
// Platform Orgs Service — list / get / create organizations
// ═══════════════════════════════════════════════════════════════════
//
// App-level service (single consumer today). If admin/open ever need org
// operations, move this to packages/server verbatim.
// ═══════════════════════════════════════════════════════════════════

import { desc, eq } from "drizzle-orm";
import { getDB, organizations } from "@apigent/server/db";

export interface OrgSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export async function listOrgs(): Promise<OrgSummary[]> {
  return getDB()
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      createdAt: organizations.createdAt,
    })
    .from(organizations)
    .orderBy(desc(organizations.createdAt));
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
