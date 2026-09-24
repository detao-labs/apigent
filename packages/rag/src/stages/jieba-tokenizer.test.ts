import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { RagConfigError } from "../contracts";
import { jiebaTokenizer, JIEBA_LIB_VERSION_FALLBACK } from "./jieba-tokenizer";

const tokenizer = jiebaTokenizer();

/** 查询词元与文档词元的交集 —— 「能不能搜到」在这套方案里就是这个。 */
function overlap(query: string, document: string): string[] {
  const docTerms = new Set(tokenizer.tokenize(document));
  return tokenizer.tokenize(query).filter((term) => docTerms.has(term));
}

describe("jiebaTokenizer — segmentation quality", () => {
  it("segments domain words correctly (余额 / 发货单 / 优惠券)", () => {
    expect(tokenizer.tokenize("账户余额")).toContain("余额");
    expect(tokenizer.tokenize("创建发货单")).toContain("发货单");
    expect(tokenizer.tokenize("使用优惠券")).toContain("优惠券");
  });

  it('recalls 发货单 from the query "发货" (why we use cutForSearch, not cut)', () => {
    expect(overlap("发货", "发货单查询接口：按发货单号查询物流轨迹")).not.toHaveLength(0);
  });

  it('recalls a refund description from the query "退款"', () => {
    expect(overlap("退款", "退款接口：对已支付的订单发起退款")).toContain("退款");
  });

  it("returns identical tokens for identical input (index and query must agree)", () => {
    const first = tokenizer.tokenize("退款接口 POST /orders/{id}/refund");
    const second = tokenizer.tokenize("退款接口 POST /orders/{id}/refund");

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("lowercases tokens and drops pure punctuation (keeps tsquery syntax safe)", () => {
    const terms = tokenizer.tokenize("Refund, POST /orders/{id}/refund。");

    expect(terms).toContain("refund");
    expect(terms).toContain("post");
    expect(terms.every((term) => /[a-z0-9\u3400-\u4dbf\u4e00-\u9fff]/u.test(term))).toBe(true);
    expect(terms.some((term) => term === "/" || term === "，")).toBe(false);
  });
});

describe("jiebaTokenizer — version string (the tokenizer_version value)", () => {
  it("carries library version, mode, dictionary and normalisation version", () => {
    const version = jiebaTokenizer().version;

    expect(version).toContain(`jieba-${JIEBA_LIB_VERSION_FALLBACK}`);
    expect(version).toContain("cutForSearch");
    expect(version).toContain("dict=builtin");
    expect(version).toContain("hmm=1");
    expect(version).toContain("norm=v1");
  });

  it("folds the hmm flag into the version (different modes are different tokenizers)", () => {
    expect(jiebaTokenizer({ hmm: false }).version).toContain("hmm=0");
  });

  it("keeps the fallback version constant in sync with the installed dependency", () => {
    const require = createRequire(import.meta.url);
    const pkg = require("@node-rs/jieba/package.json") as { version: string };

    expect(JIEBA_LIB_VERSION_FALLBACK).toBe(pkg.version);
  });
});

describe("jiebaTokenizer — identifier normalisation exposed via the port", () => {
  it("delegates to the shared normaliser", () => {
    expect(tokenizer.normalizeIdentifiers("POST /orders/{id}/refund")).toEqual([
      "post",
      "orders",
      "id",
      "refund",
    ]);
  });
});

describe("jiebaTokenizer — domain dictionary (process-level config)", () => {
  // 放在最后：词典是**进程级**的，加载后会一直影响同一个进程里的后续用例。
  it("loads a domain dictionary and refuses a second, different one", () => {
    const domain = jiebaTokenizer({
      dictionary: { id: "domain-v1", content: "闪兑码 100 nz\n" },
    });

    expect(domain.tokenize("闪兑码")).toContain("闪兑码");
    expect(domain.version).toContain("dict=domain-v1");

    // 第二个词典被拒绝 —— loadDict 是增量合并，静默合并会让切分结果不可复现
    expect(() =>
      jiebaTokenizer({ dictionary: { id: "domain-v2", content: "另一个词 100 nz\n" } }),
    ).toThrow(RagConfigError);
  });
});
