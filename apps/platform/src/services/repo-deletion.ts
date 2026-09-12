// ═══════════════════════════════════════════════════════════════════
// Repository Deletion — 删除仓库及其全部内容
// ═══════════════════════════════════════════════════════════════════
//
// 数据库里所有指向 repositories 的外键都是 NO ACTION，因此必须在**同一个事务**
// 里按依赖顺序清理干净（顺序依据实际外键图，勿随意调整）：
//
//   operation_log_details → knowledge_chunks → business_contexts
//   → endpoint_relationships → endpoint_responses → endpoints
//   → data_models / components → version_entity_links
//   → repository_tasks → version_commits → versions
//   → repository_members → repositories
//
// 审计行**不删除**：只把 `repository_id` 置空，日志本身留在组织维度上继续可查
// （仓库的删除事件本身也在其中，靠 summary 保留仓库名）。
// ═══════════════════════════════════════════════════════════════════

import { eq, inArray } from "drizzle-orm";
import {
  businessContexts,
  components,
  dataModels,
  endpointRelationships,
  endpointResponses,
  endpoints,
  getDB,
  knowledgeChunks,
  operationLogDetails,
  operationLogs,
  repositories,
  repositoryMembers,
  repositoryTasks,
  versionCommits,
  versionEntityLinks,
  versions,
} from "@apigent/server/db";
import { assertRepoAccess } from "@apigent/server/authz";
import { recordOperation, withAuditTransaction } from "@apigent/server/audit";

export class RepoNotFoundError extends Error {
  constructor(id: string) {
    super(`Repository not found: ${id}`);
    this.name = "RepoNotFoundError";
  }
}

/**
 * 删除仓库。需要 `repo_owner`（组织 owner 隐含持有）。
 * 返回被删仓库的名字，供调用方提示与跳转。
 */
export async function deleteRepository(
  repositoryId: string,
  actorId: string,
): Promise<{ name: string; organizationId: string }> {
  await assertRepoAccess(actorId, repositoryId, "repo_owner");

  const [repo] = await getDB()
    .select({
      id: repositories.id,
      name: repositories.name,
      organizationId: repositories.organizationId,
    })
    .from(repositories)
    .where(eq(repositories.id, repositoryId))
    .limit(1);
  if (!repo) throw new RepoNotFoundError(repositoryId);

  await withAuditTransaction(async (tx) => {
    // 先写审计：下面会把 repository_id 置空，这行日志描述的正是这次删除
    await recordOperation(tx, {
      actorId,
      organizationId: repo.organizationId,
      repositoryId: repo.id,
      operationType: "repo.delete",
      resourceType: "repository",
      resourceId: repo.id,
      summary: { name: repo.name, organizationId: repo.organizationId },
    });

    const repoLogIds = tx
      .select({ id: operationLogs.id })
      .from(operationLogs)
      .where(eq(operationLogs.repositoryId, repositoryId));
    await tx
      .delete(operationLogDetails)
      .where(inArray(operationLogDetails.operationId, repoLogIds));

    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.repositoryId, repositoryId));

    const repoEndpointIds = tx
      .select({ id: endpoints.id })
      .from(endpoints)
      .where(eq(endpoints.repositoryId, repositoryId));
    await tx.delete(businessContexts).where(inArray(businessContexts.endpointId, repoEndpointIds));

    await tx
      .delete(endpointRelationships)
      .where(eq(endpointRelationships.repositoryId, repositoryId));
    await tx.delete(endpointResponses).where(eq(endpointResponses.repositoryId, repositoryId));
    await tx.delete(endpoints).where(eq(endpoints.repositoryId, repositoryId));

    await tx.delete(dataModels).where(eq(dataModels.repositoryId, repositoryId));
    await tx.delete(components).where(eq(components.repositoryId, repositoryId));

    const repoCommitIds = tx
      .select({ id: versionCommits.id })
      .from(versionCommits)
      .where(eq(versionCommits.repositoryId, repositoryId));
    await tx.delete(versionEntityLinks).where(inArray(versionEntityLinks.commitId, repoCommitIds));

    // repository_tasks 有自引用 depends_on：先断开再删，避免同语句内的顺序问题
    await tx
      .update(repositoryTasks)
      .set({ dependsOn: null })
      .where(eq(repositoryTasks.repositoryId, repositoryId));
    await tx.delete(repositoryTasks).where(eq(repositoryTasks.repositoryId, repositoryId));

    await tx.delete(versionCommits).where(eq(versionCommits.repositoryId, repositoryId));
    await tx.delete(versions).where(eq(versions.repositoryId, repositoryId));
    await tx.delete(repositoryMembers).where(eq(repositoryMembers.repositoryId, repositoryId));

    // 保留审计：只解除仓库关联，日志仍留在组织维度
    await tx
      .update(operationLogs)
      .set({ repositoryId: null })
      .where(eq(operationLogs.repositoryId, repositoryId));

    await tx.delete(repositories).where(eq(repositories.id, repositoryId));
  });

  return { name: repo.name, organizationId: repo.organizationId };
}
