import { describe, it, expect } from "vitest";
import { identifierTokenizer } from "./simple-tokenizer";

describe("identifierTokenizer（pg-fts-simple：稀疏只服务标识符与英文）", () => {
  const tokenizer = identifierTokenizer();

  it("连续 CJK 保留为整词 —— 这正是候选 A 的已知短板（补偿在稠密路）", () => {
    expect(tokenizer.tokenize("订单退款接口 POST /orders/{id}/refund")).toEqual([
      "订单退款接口",
      "post",
      "orders",
      "id",
      "refund",
    ]);
  });

  it("大小写不敏感、去重保序", () => {
    expect(tokenizer.tokenize("Orders orders ORDERS")).toEqual(["orders"]);
  });

  it("tokenize 与 normalizeIdentifiers 是同一口径", () => {
    const text = "POST /orders/{id}/refund";
    expect(tokenizer.tokenize(text)).toEqual(tokenizer.normalizeIdentifiers(text));
  });

  it("版本串进 tokenizer_version", () => {
    expect(tokenizer.version).toBe("identifiers@v1:norm=v1");
  });
});
