// ═══════════════════════════════════════════════════════════════════
// Stages — `rag.searchStore.provider` → Tokenizer（单一映射点）
// ═══════════════════════════════════════════════════════════════════
//
// 四个取值里 `none` 没有 tokenizer（稀疏路关闭），另三个共用同一条 pg-fts 读写
// 路径、只换切分口径。因此「配置值 → 切词实现」必须只有一处映射 —— 写入侧与
// 查询侧各解析一次配置是 P4-5 最容易埋的坑（一旦两边不同，表现为静默空召回）。
//
// 与 `chunkerForStrategy` 同样的形态：枚举字面量在本模块内声明，不 import
// `@apigent/core/config`（`/stages` 保持零配置依赖、可在任意宿主里单独用）；
// 与 core 枚举的一致性由 `search-store-tokenizer.test.ts` 的编译期断言钉住。
// ═══════════════════════════════════════════════════════════════════

import type { Tokenizer } from "../contracts";
import { cjkBigramTokenizer } from "./bigram-tokenizer";
import { jiebaTokenizer, type JiebaTokenizerOptions } from "./jieba-tokenizer";
import { identifierTokenizer } from "./simple-tokenizer";

/**
 * 内置稀疏分词方案（= `rag.searchStore.provider` 除去 `none` 与第三方包）。
 *
 * 与 `@apigent/core/config` 的 `SearchStoreConfig` 同形，漂移由测试钉住。
 */
export type SparseTokenizerName = "pg-fts-jieba" | "pg-fts-bigram" | "pg-fts-simple";

export const SPARSE_TOKENIZER_NAMES = [
  "pg-fts-jieba",
  "pg-fts-bigram",
  "pg-fts-simple",
] as const satisfies SparseTokenizerName[];

export interface SparseTokenizerOptions {
  /** 领域词典等 jieba 专属选项；其它 provider 忽略 */
  jieba?: JiebaTokenizerOptions;
}

/**
 * 按配置值构造切词器。
 *
 * 每次调用返回**新对象**（jieba 的原生词典是进程级单例，重复调用不重复加载），
 * 让装配方（server / 第三方包）自己决定实例的生命周期。
 */
export function tokenizerForSearchStore(
  name: SparseTokenizerName,
  options: SparseTokenizerOptions = {},
): Tokenizer {
  switch (name) {
    case "pg-fts-jieba":
      return jiebaTokenizer(options.jieba);
    case "pg-fts-bigram":
      return cjkBigramTokenizer();
    case "pg-fts-simple":
      return identifierTokenizer();
  }
}
