// ═══════════════════════════════════════════════════════════════════
// Repository Deletion — 删除仓库及其全部内容
// ═══════════════════════════════════════════════════════════════════
//
// 数据库里所有指向 repositories 的外键都是 NO ACTION，因此必须在**同一个事务**
// 里按依赖顺序清理干净（顺序依据实际外键图，勿随意调整）：
//
//   operation_log_details → knowledge_chunk_links → knowledge_chunks → business_contexts
//   → endpoint_relationships → endpoint_responses → endpoints
//   → data_models / components → version_entity_links
//   → repository_tasks → version_commits → versions
//   → repository_members → repositories
//
// `knowledge_chunk_links` 同时外键指向 `knowledge_chunks` 与 `version_commits`，
// 必须排在**两者之前**删除（P3-4）。
//
// 审计行**不删除**：只把 `repository_id` 置空，日志本身留在组织维度上继续可查
// （仓库的删除事件本身也在其中，靠 summary 保留仓库名）。
//
// 另外要清理 **Secret Key 的仓库白名单**（`secret_keys.repository_ids`）：那是
// `text[]`，数组元素没法加外键，数据库不会替我们清理；不清理的话密钥范围里会留
// 下悬空 id，设置页的"N 个仓库"也会把已删仓库算进去。
// ═══════════════════════════════════════════════════════════════════

import { eq, inArray, sql } from "drizzle-orm";
import {
  businessContexts,
  components,
  dataModels,
  endpointRelationships,
  endpointResponses,
  endpoints,
  getDB,
  knowledgeChunkLinks,
  knowledgeChunks,
  operationLogDetails,
  operationLogs,
  repositories,
  repositoryMembers,
  repositoryTasks,
  secretKeys,
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

    // links 指向 chunk 与 commit 两张表，两边各删一次是有意的：正常情况下两个集合
    // 一致（chunk 与 commit 同属一个仓库），任一不一致都会在这里被清干净，而不是
    // 让外键挡住整个仓库删除（顺序见文件头）。
    const repoChunkIds = tx
      .select({ id: knowledgeChunks.id })
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.repositoryId, repositoryId));
    const repoCommitIds = tx
      .select({ id: versionCommits.id })
      .from(versionCommits)
      .where(eq(versionCommits.repositoryId, repositoryId));
    await tx.delete(knowledgeChunkLinks).where(inArray(knowledgeChunkLinks.chunkId, repoChunkIds));
    await tx
      .delete(knowledgeChunkLinks)
      .where(inArray(knowledgeChunkLinks.commitId, repoCommitIds));

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

    // 从各密钥的仓库白名单里摘掉这个仓库（数组元素没有外键约束，见文件头说明）。
    //
    // 注意：**空数组 = 不限制**。所以如果一个密钥的白名单里只有这一个仓库，摘掉
    // 之后它会从"只看这一个仓库"变成"全部可访问"——那是静默提权。因此这种情况
    // 直接吊销该密钥：它的作用域已经不存在了，让它失效比悄悄放宽安全得多。
    await tx
      .update(secretKeys)
      .set({
        repositoryIds: sql`array_remove(${secretKeys.repositoryIds}, ${repositoryId})`,
        revokedAt: sql`case
          when cardinality(array_remove(${secretKeys.repositoryIds}, ${repositoryId})) = 0
          then now()
          else ${secretKeys.revokedAt}
        end`,
      })
      .where(sql`${repositoryId} = ANY(${secretKeys.repositoryIds})`);

    // 保留审计：只解除仓库关联，日志仍留在组织维度
    await tx
      .update(operationLogs)
      .set({ repositoryId: null })
      .where(eq(operationLogs.repositoryId, repositoryId));

    await tx.delete(repositories).where(eq(repositories.id, repositoryId));
  });

  return { name: repo.name, organizationId: repo.organizationId };
}
