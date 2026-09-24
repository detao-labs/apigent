import { describe, it, expect } from "vitest";
import { RagConfigError, type DenseChunkRecord, type RagScope } from "../contracts";
import { memoryIndex } from "./memory-index";

const MODEL = "test:hash";

function record(
  overrides: Partial<DenseChunkRecord> & Pick<DenseChunkRecord, "chunkKey">,
): DenseChunkRecord {
  return {
    repositoryId: "repo-a",
    commitIds: ["commit-1"],
    level: "endpoint",
    lang: "zh",
    text: "退款接口",
    vector: [1, 0, 0],
    embeddingModel: MODEL,
    ...overrides,
  };
}

function scope(overrides: Partial<RagScope> = {}): RagScope {
  return { repositoryIds: ["repo-a"], ...overrides };
}

describe("memoryIndex — retrieval and ranking", () => {
  it("returns hits sorted by descending score", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({ chunkKey: "far", vector: [0, 1, 0] }),
      record({ chunkKey: "near", vector: [1, 0.1, 0] }),
    ]);

    const hits = await index.search({
      vector: [1, 0, 0],
      scope: scope(),
      limit: 10,
      embeddingModel: MODEL,
    });

    expect(hits.map((hit) => hit.chunkKey)).toEqual(["near", "far"]);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("breaks score ties by chunkKey so ranking is reproducible", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({ chunkKey: "z-last" }),
      record({ chunkKey: "a-first" }),
      record({ chunkKey: "m-middle" }),
    ]);

    const hits = await index.search({
      vector: [1, 0, 0],
      scope: scope(),
      limit: 10,
      embeddingModel: MODEL,
    });

    expect(hits.map((hit) => hit.chunkKey)).toEqual(["a-first", "m-middle", "z-last"]);
  });

  it("applies the limit after filtering (filter before truncate)", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({ chunkKey: "other-repo", repositoryId: "repo-b" }),
      record({ chunkKey: "mine", vector: [1, 0.5, 0] }),
    ]);

    const hits = await index.search({
      vector: [1, 0, 0],
      scope: scope(),
      limit: 1,
      embeddingModel: MODEL,
    });

    expect(hits.map((hit) => hit.chunkKey)).toEqual(["mine"]);
  });
});

describe("memoryIndex — permission and version invariants (P0-4)", () => {
  it("returns only records inside scope.repositoryIds (permission filter on chunks)", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({ chunkKey: "mine" }),
      record({ chunkKey: "theirs", repositoryId: "repo-b" }),
    ]);

    const hits = await index.search({
      vector: [1, 0, 0],
      scope: scope(),
      limit: 10,
      embeddingModel: MODEL,
    });

    expect(hits.map((hit) => hit.chunkKey)).toEqual(["mine"]);
  });

  it("treats an empty scope as no permission, never as the whole corpus", async () => {
    const index = memoryIndex();
    await index.upsert([record({ chunkKey: "mine" })]);

    const hits = await index.search({
      vector: [1, 0, 0],
      scope: { repositoryIds: [] },
      limit: 10,
      embeddingModel: MODEL,
    });

    expect(hits).toEqual([]);
  });

  it("narrows by scope.commitIds without granting access (version filter on links)", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({ chunkKey: "commit-1-only", commitIds: ["commit-1"] }),
      record({ chunkKey: "shared", commitIds: ["commit-1", "commit-2"] }),
    ]);

    const active = await index.search({
      vector: [1, 0, 0],
      scope: scope({ commitIds: ["commit-2"] }),
      limit: 10,
      embeddingModel: MODEL,
    });

    expect(active.map((hit) => hit.chunkKey)).toEqual(["shared"]);
  });

  it("narrows by scope.organizationId using the chunk snapshot column", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({ chunkKey: "main-org", organizationId: "org-demo" }),
      record({ chunkKey: "other-org", organizationId: "org-other" }),
    ]);

    const hits = await index.search({
      vector: [1, 0, 0],
      scope: scope({ organizationId: "org-other" }),
      limit: 10,
      embeddingModel: MODEL,
    });

    expect(hits.map((hit) => hit.chunkKey)).toEqual(["other-org"]);
  });

  it("does not leak records from the wrong embedding model (P0-2)", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({ chunkKey: "current" }),
      record({ chunkKey: "stale", embeddingModel: "qwen:old" }),
    ]);

    const hits = await index.search({
      vector: [1, 0, 0],
      scope: scope(),
      limit: 10,
      embeddingModel: MODEL,
    });

    expect(hits.map((hit) => hit.chunkKey)).toEqual(["current"]);
  });
});

describe("memoryIndex — structured filters", () => {
  it("filters by method (case-insensitive), tags and path prefix", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({
        chunkKey: "refund",
        fields: { method: "post", path: "/orders/{id}/refund", tags: ["订单", "退款"] },
      }),
      record({
        chunkKey: "shipment",
        fields: { method: "GET", path: "/shipments/{id}", tags: ["订单", "发货单"] },
      }),
    ]);

    const byMethod = await index.search({
      vector: [1, 0, 0],
      scope: scope(),
      limit: 10,
      embeddingModel: MODEL,
      filters: { methods: ["POST"] },
    });
    expect(byMethod.map((hit) => hit.chunkKey)).toEqual(["refund"]);

    const byTag = await index.search({
      vector: [1, 0, 0],
      scope: scope(),
      limit: 10,
      embeddingModel: MODEL,
      filters: { tags: ["发货单"] },
    });
    expect(byTag.map((hit) => hit.chunkKey)).toEqual(["shipment"]);

    const byPath = await index.search({
      vector: [1, 0, 0],
      scope: scope(),
      limit: 10,
      embeddingModel: MODEL,
      filters: { pathPrefix: "/orders/" },
    });
    expect(byPath.map((hit) => hit.chunkKey)).toEqual(["refund"]);
  });
});

describe("memoryIndex — upsert / reconciliation / GC", () => {
  it("merges commit links on re-upsert and overwrites the vector", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({ chunkKey: "shared", commitIds: ["commit-1"], vector: [1, 0, 0], text: "旧" }),
    ]);
    await index.upsert([
      record({ chunkKey: "shared", commitIds: ["commit-2"], vector: [0, 1, 0], text: "新" }),
    ]);

    expect(await index.size()).toBe(1);
    const hits = await index.search({
      vector: [0, 1, 0],
      scope: scope({ commitIds: ["commit-1"] }),
      limit: 10,
      embeddingModel: MODEL,
    });
    expect(hits.map((hit) => hit.text)).toEqual(["新"]);
  });

  it("keeps a chunk that is still referenced by another commit when unlinking", async () => {
    const index = memoryIndex();
    await index.upsert([record({ chunkKey: "shared", commitIds: ["commit-1", "commit-2"] })]);

    const affected = await index.unlink({ repositoryId: "repo-a", commitId: "commit-1" });

    expect(affected).toBe(1);
    expect(await index.size()).toBe(1);
    const hits = await index.search({
      vector: [1, 0, 0],
      scope: scope({ commitIds: ["commit-2"] }),
      limit: 10,
      embeddingModel: MODEL,
    });
    expect(hits).toHaveLength(1);
  });

  it("garbage-collects the chunk once its last commit link is gone", async () => {
    const index = memoryIndex();
    await index.upsert([record({ chunkKey: "gone", commitIds: ["commit-1"] })]);

    await index.unlink({ repositoryId: "repo-a", commitId: "commit-1" });

    expect(await index.size()).toBe(0);
  });

  it("scopes unlink to the given chunkKeys and repository", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({ chunkKey: "a", commitIds: ["commit-1"] }),
      record({ chunkKey: "b", commitIds: ["commit-1"] }),
      record({ chunkKey: "a", repositoryId: "repo-b", commitIds: ["commit-1"] }),
    ]);

    const affected = await index.unlink({
      repositoryId: "repo-a",
      commitId: "commit-1",
      chunkKeys: ["a"],
    });

    expect(affected).toBe(1);
    expect(await index.size()).toBe(2);
  });

  it("drops a whole repository without touching the others", async () => {
    const index = memoryIndex();
    await index.upsert([
      record({ chunkKey: "a" }),
      record({ chunkKey: "b", repositoryId: "repo-b" }),
    ]);

    expect(await index.dropRepository("repo-a")).toBe(1);
    expect(await index.size()).toBe(1);
    expect(await index.dropRepository("repo-a")).toBe(0);
  });
});

describe("memoryIndex — vector dimension contract (P0-2)", () => {
  it("rejects a mismatched vector dimension instead of silently mixing models", async () => {
    const index = memoryIndex();
    await index.upsert([record({ chunkKey: "a", vector: [1, 0, 0] })]);

    await expect(
      index.upsert([record({ chunkKey: "b", vector: [1, 0, 0, 0] })]),
    ).rejects.toBeInstanceOf(RagConfigError);
  });

  it("rejects an empty vector", async () => {
    await expect(memoryIndex().upsert([record({ chunkKey: "a", vector: [] })])).rejects.toThrow(
      RagConfigError,
    );
  });

  it("rejects a query vector of the wrong dimension", async () => {
    const index = memoryIndex();
    await index.upsert([record({ chunkKey: "a", vector: [1, 0, 0] })]);

    await expect(
      index.search({ vector: [1, 0], scope: scope(), limit: 10, embeddingModel: MODEL }),
    ).rejects.toThrow(RagConfigError);
  });
});
