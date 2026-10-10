import { describe, it, expect } from "vitest";
import type { SearchStoreConfig } from "@apigent/core/config";
import {
  SPARSE_TOKENIZER_NAMES,
  tokenizerForSearchStore,
  type SparseTokenizerName,
} from "./search-store-tokenizer";

// ───────────────────────────────────────────────────────────────────
// 与 core 的配置枚举不得漂移：`rag.searchStore.provider` 多一个值、少一个值，
// 这里必须编译失败（P3-3 的枚举与 P4-5 的实现各写一份就迟早不一致）。
// ───────────────────────────────────────────────────────────────────

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type BuiltinFtsProvider = Extract<
  SearchStoreConfig,
  { provider: "pg-fts-jieba" | "pg-fts-bigram" | "pg-fts-simple" }
>["provider"];

const _providersMatchCoreConfig: Equal<SparseTokenizerName, BuiltinFtsProvider> = true;
void _providersMatchCoreConfig;

describe("tokenizerForSearchStore（配置值 → 切词实现的单一映射点）", () => {
  it("三个内置 provider 各得到不同的切词口径（版本串不同 = 换 provider 必须 REINDEX）", () => {
    const versions = SPARSE_TOKENIZER_NAMES.map((name) => tokenizerForSearchStore(name).version);

    expect(new Set(versions).size).toBe(3);
    expect(tokenizerForSearchStore("pg-fts-jieba").version).toContain("cutForSearch");
    expect(tokenizerForSearchStore("pg-fts-bigram").version).toBe("bigram@v1:norm=v1");
    expect(tokenizerForSearchStore("pg-fts-simple").version).toBe("identifiers@v1:norm=v1");
  });

  it("同一 provider 的索引侧与查询侧是同一口径（同一实现的两个实例）", () => {
    const a = tokenizerForSearchStore("pg-fts-bigram");
    const b = tokenizerForSearchStore("pg-fts-bigram");

    expect(a.tokenize("订单退款")).toEqual(b.tokenize("订单退款"));
    expect(a.version).toBe(b.version);
  });

  it("枚举的每个取值都有实现（TS 穷尽 + 运行期不返回 undefined）", () => {
    for (const name of SPARSE_TOKENIZER_NAMES satisfies SparseTokenizerName[]) {
      expect(tokenizerForSearchStore(name)).toBeDefined();
    }
  });
});
