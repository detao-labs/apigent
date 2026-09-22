import { describe, it, expect } from "vitest";
import { hashEmbedder, hashEmbedderTokens } from "./hash-embedder";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

describe("hashEmbedder", () => {
  it("is deterministic across calls (CI 指标可复现的前提)", async () => {
    const embedder = hashEmbedder();
    const first = await embedder.embed(["退款接口"]);
    const second = await embedder.embed(["退款接口"]);

    expect(first.vectors[0]).toEqual(second.vectors[0]);
  });

  it("uses the P0-2 default dimension and reports its identity", async () => {
    const embedder = hashEmbedder();
    const { vectors } = await embedder.embed(["refund"]);

    expect(embedder.identity).toEqual({ model: "test:hash", dim: 1024 });
    expect(vectors[0]).toHaveLength(1024);
  });

  it("honours a custom dimension and model name", async () => {
    const embedder = hashEmbedder({ dim: 64, model: "test:hash-small" });
    const { vectors } = await embedder.embed(["refund"]);

    expect(embedder.identity).toEqual({ model: "test:hash-small", dim: 64 });
    expect(vectors[0]).toHaveLength(64);
  });

  it("returns unit-length vectors so cosine is a plain dot product", async () => {
    const { vectors } = await hashEmbedder().embed(["发货单查询接口"]);
    const norm = Math.sqrt(vectors[0].reduce((sum, value) => sum + value * value, 0));

    expect(norm).toBeCloseTo(1, 10);
  });

  it("ranks texts sharing tokens above unrelated ones (否则 hit@k 在 CI 里没有意义)", async () => {
    const embedder = hashEmbedder();
    const { vectors } = await embedder.embed([
      "查询退款进度",
      "退款接口：对已支付的订单发起退款",
      "优惠券核销接口",
    ]);
    const [query, related, unrelated] = vectors;

    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
    expect(cosine(query, unrelated)).toBeLessThanOrEqual(0.2);
  });

  it("matches 发货 against 发货单（bigram 让中文子串可召回）", async () => {
    const { vectors } = await hashEmbedder().embed(["发货", "发货单查询接口", "优惠券核销"]);
    const [query, shipment, coupon] = vectors;

    expect(cosine(query, shipment)).toBeGreaterThan(cosine(query, coupon));
    expect(cosine(query, shipment)).toBeGreaterThan(0);
  });

  it("maps empty text to a zero vector instead of NaN", async () => {
    const { vectors } = await hashEmbedder({ dim: 8 }).embed(["", "   "]);

    expect(vectors[0]).toEqual(new Array<number>(8).fill(0));
    expect(vectors[1].every((value) => value === 0)).toBe(true);
    expect(vectors[1].some((value) => Number.isNaN(value))).toBe(false);
  });

  it("reports an estimated token count so the token plumbing is exercised", async () => {
    const { tokens } = await hashEmbedder().embed(["退款", "refund"]);

    expect(tokens).toBeGreaterThan(0);
  });
});

describe("hashEmbedderTokens", () => {
  it("splits CJK into unigrams + bigrams and keeps identifier runs whole", () => {
    expect(hashEmbedderTokens("退款接口 POST /orders/{id}/refund")).toEqual([
      "退",
      "退款",
      "款",
      "款接",
      "接",
      "接口",
      "口",
      "post",
      "orders",
      "id",
      "refund",
    ]);
  });

  it("lowercases so the same content hashes identically", () => {
    expect(hashEmbedderTokens("REFUND GET /Refund")).toEqual(["refund", "get", "refund"]);
  });
});
