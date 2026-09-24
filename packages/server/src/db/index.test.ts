import { describe, it, expect } from "vitest";
// Import through the public package boundary — this test fails if the
// "./db" subpath export is ever dropped from package.json again.
import {
  users,
  repositories,
  secretKeys,
  operationLogs,
  knowledgeChunks,
  knowledgeChunkLinks,
  implQueueJobs,
  repositoryTasks,
  notifications,
} from "@apigent/server/db";

describe("@apigent/server/db public export", () => {
  it("exposes the Drizzle schema tables with their columns", () => {
    expect(users.email).toBeDefined();
    expect(repositories.organizationId).toBeDefined();
    expect(secretKeys.keyHash).toBeDefined();
    expect(operationLogs.operationType).toBeDefined();
    expect(knowledgeChunks.embedding).toBeDefined();
    // 生产者身份列（P0-2 / P0-3，迁移 0005）—— 少了任何一列，
    // 「检索按当前模型过滤 / 分词口径变更需 REINDEX」这两条就没有落点。
    expect(knowledgeChunks.embeddingModel).toBeDefined();
    expect(knowledgeChunks.embeddingDim).toBeDefined();
    expect(knowledgeChunks.embeddingUpdatedAt).toBeDefined();
    expect(knowledgeChunks.tokenizerVersion).toBeDefined();
    expect(knowledgeChunks.searchVector).toBeDefined();
    expect(knowledgeChunks.chunkKey).toBeDefined();
    // 内容寻址（P0-4，迁移 0006）：chunk 是版本无关的内容块，版本关系在 links 表。
    expect(knowledgeChunks.contentHash).toBeDefined();
    expect(knowledgeChunkLinks.commitId).toBeDefined();
    expect(knowledgeChunkLinks.chunkId).toBeDefined();
    expect(implQueueJobs.queueName).toBeDefined();
    expect(implQueueJobs.data).toBeDefined();
    expect(repositoryTasks.taskType).toBeDefined();
    expect(repositoryTasks.payload).toBeDefined();
    expect(notifications.priority).toBeDefined();
  });
});
