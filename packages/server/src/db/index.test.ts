import { describe, it, expect } from "vitest";
// Import through the public package boundary — this test fails if the
// "./db" subpath export is ever dropped from package.json again.
import { users, repositories, secretKeys, operationLogs, knowledgeChunks } from "@apigent/server/db";

describe("@apigent/server/db public export", () => {
  it("exposes the Drizzle schema tables with their columns", () => {
    expect(users.email).toBeDefined();
    expect(repositories.orgId).toBeDefined();
    expect(secretKeys.keyHash).toBeDefined();
    expect(operationLogs.operationType).toBeDefined();
    expect(knowledgeChunks.embedding).toBeDefined();
    expect(knowledgeChunks.searchVector).toBeDefined();
    expect(knowledgeChunks.chunkKey).toBeDefined();
  });
});
