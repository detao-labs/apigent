// ═══════════════════════════════════════════════════════════════════
// Testing — 替身组合冒烟（无网络、无 API key、无数据库）
// ═══════════════════════════════════════════════════════════════════
//
// 这是 P2-5 的验收证据：四个替身能拼出「写入 → 中文查询 → 排序结果」整条链路。
// 这里手写的是**最小接线**，不是正式管线 —— 真正的编排在 P2-6 的
// `createRagService()`，端到端断言在 P2-7。
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import type { DenseIndex, Embedder } from "../contracts";
import {
  fixtureDocumentSource,
  FIXTURE_REPO_CHECKOUT,
  FIXTURE_REPO_LEGACY,
} from "./fixture-document-source";
import { hashEmbedder } from "./hash-embedder";
import { memoryIndex } from "./memory-index";

const HEAD = "commit-head";

async function indexRepository(repositoryId: string): Promise<{
  index: DenseIndex;
  embedder: Embedder;
}> {
  const embedder = hashEmbedder();
  const index = memoryIndex();
  const docs = await fixtureDocumentSource().load(
    { repositoryId },
    { repositoryIds: [repositoryId] },
  );
  const { vectors } = await embedder.embed(docs.map((doc) => doc.text));

  await index.upsert(
    docs.map((doc, i) => ({
      chunkKey: doc.id,
      repositoryId,
      organizationId: doc.organizationId,
      commitIds: [HEAD],
      level: doc.level,
      lang: doc.lang,
      text: doc.text,
      fields: doc.fields,
      metadata: doc.metadata,
      vector: vectors[i],
      embeddingModel: embedder.identity.model,
    })),
  );

  return { index, embedder };
}

async function search(
  ctx: { index: DenseIndex; embedder: Embedder },
  query: string,
  repositoryIds: string[],
): Promise<string[]> {
  const { vectors } = await ctx.embedder.embed([query]);
  const hits = await ctx.index.search({
    vector: vectors[0],
    scope: { repositoryIds, commitIds: [HEAD] },
    limit: 5,
    embeddingModel: ctx.embedder.identity.model,
  });
  return hits.map((hit) => hit.chunkKey);
}

describe("testing doubles — offline retrieval chain", () => {
  it('recalls the endpoint behind the Chinese query "发货" (→ 发货单查询)', async () => {
    const ctx = await indexRepository(FIXTURE_REPO_CHECKOUT);

    const hits = await search(ctx, "发货", [FIXTURE_REPO_CHECKOUT]);

    expect(hits[0]).toBe("endpoint:GET:/shipments/{id}");
  });

  it("recalls the refund endpoint without leaking across repositories or organisations", async () => {
    const checkout = await indexRepository(FIXTURE_REPO_CHECKOUT);
    const legacy = await indexRepository(FIXTURE_REPO_LEGACY);

    const hits = await search(checkout, "退款", [FIXTURE_REPO_CHECKOUT]);
    const legacyHits = await search(legacy, "退款", [FIXTURE_REPO_LEGACY]);

    expect(hits).toContain("endpoint:POST:/orders/{id}/refund");
    expect(hits).not.toContain("endpoint:GET:/legacy/refund");
    // scope 里没有 repo-checkout 时，那条中文退款接口一条都查不出来
    expect(legacyHits).toEqual(["endpoint:GET:/legacy/refund"]);
  });

  it("also recalls the English chunk for the same query (bilingual index)", async () => {
    const ctx = await indexRepository(FIXTURE_REPO_CHECKOUT);

    const hits = await search(ctx, "refund order", [FIXTURE_REPO_CHECKOUT]);

    expect(hits).toContain("endpoint:POST:/orders/{id}/refund:en");
  });

  it("returns an empty result instead of throwing when the scope grants nothing", async () => {
    const ctx = await indexRepository(FIXTURE_REPO_CHECKOUT);

    await expect(search(ctx, "退款", [])).resolves.toEqual([]);
  });
});
