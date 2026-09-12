// ═══════════════════════════════════════════════════════════════════
// Organization Deletion — 删除组织
// ═══════════════════════════════════════════════════════════════════
//
// 规则（docs/tech-design.md §2.8.3）：必须先把组织下的仓库全部删完，才能删组织。
// 只允许 `org_owner`。
//
// 审计处理与仓库删除不同，原因值得记下来：`operation_logs.organization_id` 是
// 外键，组织一旦消失，日志要么跟着删、要么置空。置空会让这些租户日志落进
// `organization_id IS NULL` 的平台级视图（Admin 审计页），误导性更强；所以这里
// **删除该组织的租户审计**，而删除动作本身记成一条平台级事件（组织已不存在）。
// ═══════════════════════════════════════════════════════════════════

import { count, eq, inArray } from "drizzle-orm";
import {
  getDB,
  knowledgeChunks,
  operationLogDetails,
  operationLogs,
  organizationMembers,
  organizations,
  repositories,
} from "@apigent/server/db";
import { assertOrgRole } from "@apigent/server/authz";
import { recordOperation, withAuditTransaction } from "@apigent/server/audit";

export class OrgNotEmptyError extends Error {
  constructor(public readonly repositoryCount: number) {
    super("org-not-empty");
    this.name = "OrgNotEmptyError";
  }
}

export class OrgNotFoundError extends Error {
  constructor(id: string) {
    super(`Organization not found: ${id}`);
    this.name = "OrgNotFoundError";
  }
}

/**
 * 删除组织（其下必须已无仓库）。需要 `org_owner`。
 * 返回被删组织的名字。
 */
export async function deleteOrganization(
  organizationId: string,
  actorId: string,
): Promise<{ name: string }> {
  await assertOrgRole(actorId, organizationId, "org_owner");

  const [org] = await getDB()
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1);
  if (!org) throw new OrgNotFoundError(organizationId);

  const [repoCount] = await getDB()
    .select({ value: count() })
    .from(repositories)
    .where(eq(repositories.organizationId, organizationId));
  const repositoryCount = Number(repoCount?.value ?? 0);
  if (repositoryCount > 0) throw new OrgNotEmptyError(repositoryCount);

  await withAuditTransaction(async (tx) => {
    // 平台级事件：组织即将不存在，这条日志描述的是"某组织被删除了"
    await recordOperation(tx, {
      actorId,
      organizationId: null,
      operationType: "org.delete",
      resourceType: "organization",
      resourceId: organizationId,
      summary: { name: org.name, repositoryCount: 0 },
    });

    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.organizationId, organizationId));

    const orgLogIds = tx
      .select({ id: operationLogs.id })
      .from(operationLogs)
      .where(eq(operationLogs.organizationId, organizationId));
    await tx.delete(operationLogDetails).where(inArray(operationLogDetails.operationId, orgLogIds));
    await tx.delete(operationLogs).where(eq(operationLogs.organizationId, organizationId));

    await tx
      .delete(organizationMembers)
      .where(eq(organizationMembers.organizationId, organizationId));
    await tx.delete(organizations).where(eq(organizations.id, organizationId));
  });

  return { name: org.name };
}
