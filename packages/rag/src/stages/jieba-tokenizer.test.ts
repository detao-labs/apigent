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

describe("jiebaTokenizer — 切分质量", () => {
  it("切分领域词正确（余额 / 发货单 / 优惠券）", () => {
    expect(tokenizer.tokenize("账户余额")).toContain("余额");
    expect(tokenizer.tokenize("创建发货单")).toContain("发货单");
    expect(tokenizer.tokenize("使用优惠券")).toContain("优惠券");
  });

  it("「发货」能命中「发货单」（这就是 cutForSearch 而不是 cut 的原因）", () => {
    expect(overlap("发货", "发货单查询接口：按发货单号查询物流轨迹")).not.toHaveLength(0);
  });

  it("「退款」能命中含退款语义的接口描述", () => {
    expect(overlap("退款", "退款接口：对已支付的订单发起退款")).toContain("退款");
  });

  it("同输入重复调用结果稳定（索引与查询必须一致）", () => {
    const first = tokenizer.tokenize("退款接口 POST /orders/{id}/refund");
    const second = tokenizer.tokenize("退款接口 POST /orders/{id}/refund");

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("统一小写并丢掉纯标点词元（查询侧拼 tsquery 时不会破坏语法）", () => {
    const terms = tokenizer.tokenize("Refund, POST /orders/{id}/refund。");

    expect(terms).toContain("refund");
    expect(terms).toContain("post");
    expect(terms.every((term) => /[a-z0-9\u3400-\u4dbf\u4e00-\u9fff]/u.test(term))).toBe(true);
    expect(terms.some((term) => term === "/" || term === "，")).toBe(false);
  });
});

describe("jiebaTokenizer — 版本串（tokenizer_version 的取值）", () => {
  it("carries library version, mode, dictionary and normalisation version", () => {
    const version = jiebaTokenizer().version;

    expect(version).toContain(`jieba-${JIEBA_LIB_VERSION_FALLBACK}`);
    expect(version).toContain("cutForSearch");
    expect(version).toContain("dict=builtin");
    expect(version).toContain("hmm=1");
    expect(version).toContain("norm=v1");
  });

  it("hmm 开关进版本串（不同模式必须视为不同分词器）", () => {
    expect(jiebaTokenizer({ hmm: false }).version).toContain("hmm=0");
  });

  it("兜底版本常量与已安装的依赖版本一致（防止它悄悄过期）", () => {
    const require = createRequire(import.meta.url);
    const pkg = require("@node-rs/jieba/package.json") as { version: string };

    expect(JIEBA_LIB_VERSION_FALLBACK).toBe(pkg.version);
  });
});

describe("jiebaTokenizer — 标识符归一化经由端口暴露", () => {
  it("delegates to the shared normaliser", () => {
    expect(tokenizer.normalizeIdentifiers("POST /orders/{id}/refund")).toEqual([
      "post",
      "orders",
      "id",
      "refund",
    ]);
  });
});

describe("jiebaTokenizer — 领域词典（进程级配置）", () => {
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
