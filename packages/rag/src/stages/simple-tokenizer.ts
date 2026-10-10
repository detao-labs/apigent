// ═══════════════════════════════════════════════════════════════════
// Stages — identifierTokenizer（`pg-fts-simple`）
// ═══════════════════════════════════════════════════════════════════
//
// P0-3 的候选 A：**稀疏只服务标识符与英文词，中文语义召回完全交给稠密**。
//
// 它存在的意义不是「另一个可选方案」，而是给部署一个**明确的降级面**：
//   - 中文语料为主、且不想要任何中文稀疏噪音（bigram 的噪音主要在 rank 2/3）；
//   - 或者排障时要回答「中文召回到底是 dense 给的还是 sparse 给的」——
//     切到本 provider 再跑一遍即可，不需要改代码。
//
// 切分口径 = `normalizeIdentifiers`：小写 + 非字母数字转空格 + 去重保序。
// 连续 CJK 会保留为**一个整词**（`订单退款接口`）—— 这是 `to_tsvector('simple')`
// 对中文的天然行为，也正是候选 A 的已知短板（spike §3）。短板的补偿是稠密路。
// ═══════════════════════════════════════════════════════════════════

import type { Tokenizer } from "../contracts";
import { normalizeIdentifiers } from "./identifiers";

/** 口径版本：改了归一化就必须 REINDEX。 */
const SIMPLE_VERSION = "identifiers@v1:norm=v1";

export function identifierTokenizer(): Tokenizer {
  return {
    version: SIMPLE_VERSION,
    // 「切词」与「标识符归一化」在本 provider 里是同一件事：没有中文切分，
    // 也不做大小写以外的形态变化。两个方法返回同一口径是**有意的**，
    // 不是复制粘贴——它们描述的是同一个变换。
    tokenize: normalizeIdentifiers,
    normalizeIdentifiers,
  };
}
