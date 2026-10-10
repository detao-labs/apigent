import { describe, it, expect } from "vitest";
import { cjkBigramTokenizer } from "./bigram-tokenizer";

describe("cjkBigramTokenizer（pg-fts-bigram 的切词口径）", () => {
  const tokenizer = cjkBigramTokenizer();

  it("CJK 连续段切成相邻 2-gram（查询侧的「子串」才有机会命中）", () => {
    expect(tokenizer.tokenize("订单退款接口")).toEqual(["订单", "单退", "退款", "款接", "接口"]);
  });

  it("ASCII 段整体成词，不被 2-gram 切碎（英文标识符要能精确匹配）", () => {
    expect(tokenizer.tokenize("POST /orders/{id}/refund")).toEqual([
      "post",
      "orders",
      "id",
      "refund",
    ]);
  });

  it("长度为 1 的 CJK 段保留单字（否则单字查询永远召回不到）", () => {
    expect(tokenizer.tokenize("券")).toEqual(["券"]);
  });

  it("中英混排按字符类别分段", () => {
    expect(tokenizer.tokenize("退款 refund 接口")).toEqual(["退款", "refund", "接口"]);
  });

  it("标点 / 空白 / 分隔符一律丢弃", () => {
    expect(tokenizer.tokenize("a,（b）！  ")).toEqual(["a", "b"]);
  });

  it("版本串进 tokenizer_version（改了切法就必须 REINDEX）", () => {
    expect(tokenizer.version).toBe("bigram@v1:norm=v1");
  });

  it("标识符归一化与 jieba provider 共用同一个实现（口径不许漂移）", () => {
    expect(tokenizer.normalizeIdentifiers("POST /orders/{id}/refund")).toEqual([
      "post",
      "orders",
      "id",
      "refund",
    ]);
  });
});
