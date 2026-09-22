// ═══════════════════════════════════════════════════════════════════
// Testing — hashEmbedder（确定性伪向量）
// ═══════════════════════════════════════════════════════════════════
//
// 解决的问题：CI 里没有 API key、也不该联网，但 hit@k / MRR / nDCG 这类
// **排序指标仍必须可跑**（docs/modules/rag-package.md §8.2）。换掉注入的
// embedder 就能跑完整链路，这正是 P0-6「所有阶段靠注入组装」的验证工具。
//
// 三条设计约束：
//   1. **确定性** —— 同一文本在任何进程 / 平台都得到同一向量（FNV-1a 哈希，
//      不用 `Math.random`、不依赖运行时哈希种子）。
//   2. **可排序** —— 不是噪声：共享词元越多，余弦相似度越高。否则 CI 里断言
//      「查询 A 命中文档 X」毫无意义。实现用 hashing trick（词袋哈希 + 符号位 +
//      sublinear TF）。
//   3. **零依赖** —— 不引入 jieba / fastembed 等原生模块。中文按「单字 + 相邻
//      二字组」切，英数按连续串切。
//
// ⚠️ **它不是分词器，也不是检索质量基线。** 真正的分词器是 P2-9 的应用侧
// jieba（`cutForSearch`）；这里的分法只服务于「让指标在离线环境可复现」。
// ═══════════════════════════════════════════════════════════════════

import type { Embedder, EmbeddingIdentity } from "../contracts";

/** 与 P0-2 定案一致 —— 固定 1024 维 */
const DEFAULT_DIM = 1024;
const DEFAULT_MODEL = "test:hash";

export interface HashEmbedderOptions {
  /** 向量维度，默认 1024（P0-2） */
  dim?: number;
  /** 模型身份字符串，默认 `test:hash` */
  model?: string;
}

/**
 * 确定性伪向量 embedder。
 *
 * 用法：`createRagService({ ..., embedder: hashEmbedder() })`。
 */
export function hashEmbedder(options: HashEmbedderOptions = {}): Embedder {
  const identity: EmbeddingIdentity = {
    model: options.model ?? DEFAULT_MODEL,
    dim: options.dim ?? DEFAULT_DIM,
  };

  return {
    identity,
    async embed(texts) {
      const vectors = texts.map((text) => hashVector(text, identity.dim));
      // 估算值：词元数而非真实 token 数。存在的意义是让「token 统计」这条
      // 数据通路在测试里也被走一遍（P4-3 换成真实用量）。
      const tokens = texts.reduce((sum, text) => sum + hashEmbedderTokens(text).length, 0);
      return { vectors, tokens };
    },
  };
}

/**
 * 替身用的切词规则 —— 导出只为让测试与排障能看清「什么算一个词元」。
 *
 *   「退款接口 POST /orders/{id}/refund」
 *     → ["退","退款","款","接","接口","口","post","orders","id","refund"]
 *
 * 英文标识符不做归一化（`POST` → `post` 只是小写化，没拆 camelCase / snake_case）
 * —— 标识符归一化是 P2-9 与 P4-5 的正式职责。
 */
export function hashEmbedderTokens(text: string): string[] {
  const tokens: string[] = [];
  const chars = [...text.normalize("NFC").toLowerCase()];
  let i = 0;

  while (i < chars.length) {
    const codepoint = chars[i].codePointAt(0) ?? 0;

    if (isCjk(codepoint)) {
      const run: string[] = [];
      while (i < chars.length && isCjk(chars[i].codePointAt(0) ?? 0)) {
        run.push(chars[i]);
        i += 1;
      }
      for (let k = 0; k < run.length; k += 1) {
        tokens.push(run[k]);
        if (k + 1 < run.length) tokens.push(run[k] + run[k + 1]);
      }
      continue;
    }

    if (isAsciiWord(codepoint)) {
      let run = "";
      while (i < chars.length && isAsciiWord(chars[i].codePointAt(0) ?? 0)) {
        run += chars[i];
        i += 1;
      }
      tokens.push(run);
      continue;
    }

    i += 1;
  }

  return tokens;
}

// ───────────────────────────────────────────────────────────────────
// 内部实现
// ───────────────────────────────────────────────────────────────────

function hashVector(text: string, dim: number): number[] {
  const vector = new Array<number>(dim).fill(0);

  const counts = new Map<string, number>();
  for (const token of hashEmbedderTokens(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  for (const [token, count] of counts) {
    const hash = fnv1a(token);
    const index = hash % dim;
    // 用哈希的另一位决定符号：没有符号位时所有贡献都为正，任意两段文本的
    // 相似度都会被拉高，排序区分度大幅下降。
    const sign = ((hash >>> 15) & 1) === 0 ? 1 : -1;
    vector[index] += sign * (1 + Math.log(count));
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  // 空文本（或全被过滤掉）得到零向量：与任何查询的余弦都是 0，不会被召回。
  if (norm === 0) return vector;

  for (let k = 0; k < dim; k += 1) vector[k] /= norm;
  return vector;
}

/** FNV-1a（32 位）—— 短字符串上分布够用，且跨平台结果确定。 */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function isAsciiWord(codepoint: number): boolean {
  return (
    (codepoint >= 0x61 && codepoint <= 0x7a) || // a-z（已小写化）
    (codepoint >= 0x30 && codepoint <= 0x39) // 0-9
  );
}

function isCjk(codepoint: number): boolean {
  return (
    (codepoint >= 0x3400 && codepoint <= 0x4dbf) || // CJK 扩展 A
    (codepoint >= 0x4e00 && codepoint <= 0x9fff) || // CJK 基本区
    (codepoint >= 0xf900 && codepoint <= 0xfaff) || // CJK 兼容表意文字
    (codepoint >= 0x3040 && codepoint <= 0x30ff) || // 平假名 / 片假名
    (codepoint >= 0xac00 && codepoint <= 0xd7af) // 谚文
  );
}
