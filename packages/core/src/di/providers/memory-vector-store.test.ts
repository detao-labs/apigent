import { describe, it, expect, beforeEach } from "vitest";
import { MemoryVectorStore } from "./memory-vector-store";
import type { VectorRecord } from "../../types";

describe("MemoryVectorStore", () => {
  let store: MemoryVectorStore;

  beforeEach(async () => {
    store = new MemoryVectorStore();
    const records: VectorRecord[] = [
      { id: "a", embedding: [1, 0, 0], metadata: { repo_id: "r1", org_id: "o1", deprecated: false, summary: "Refund orders" } },
      { id: "b", embedding: [0, 1, 0], metadata: { repo_id: "r1", org_id: "o1", deprecated: true, summary: "Create order" } },
      { id: "c", embedding: [0, 0, 1], metadata: { repo_id: "r2", org_id: "o2", deprecated: false, summary: "List payments" } },
    ];
    await store.insert(records);
  });

  it("filters with $in before ranking (permission-aware retrieval)", async () => {
    const results = await store.search([1, 0, 0], {
      topK: 10,
      filter: { repo_id: { $in: ["r1"] } },
    });
    expect(results.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("filters with $eq and $ne", async () => {
    const eq = await store.search([1, 0, 0], { filter: { org_id: { $eq: "o2" } } });
    expect(eq.map((r) => r.id)).toEqual(["c"]);

    const ne = await store.search([1, 0, 0], { filter: { repo_id: { $ne: "r2" } } });
    expect(ne.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("filters with $exists and $contains", async () => {
    const exists = await store.search([1, 0, 0], { filter: { deprecated: { $exists: false } } });
    expect(exists).toHaveLength(0);

    const contains = await store.search([1, 0, 0], {
      filter: { summary: { $contains: "Refund" } },
    });
    expect(contains.map((r) => r.id)).toEqual(["a"]);
  });

  it("combines multiple operators on one field with AND", async () => {
    const results = await store.search([1, 0, 0], {
      filter: { repo_id: { $in: ["r1", "r2"], $ne: "r2" } },
    });
    expect(results.map((r) => r.id).sort()).toEqual(["a", "b"]);
  });

  it("returns no results when the filter matches nothing", async () => {
    const results = await store.search([1, 0, 0], { filter: { repo_id: { $in: ["r9"] } } });
    expect(results).toEqual([]);
  });
});
