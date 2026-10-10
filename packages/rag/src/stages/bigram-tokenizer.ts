// ═══════════════════════════════════════════════════════════════════
// Stages — cjkBigramTokenizer（备选稀疏 provider `pg-fts-bigram`）
// ═══════════════════════════════════════════════════════════════════
//
// 逃生通道：jieba 出问题（原生模块加载失败、词典行为变化、升级需要 REINDEX 而
// 运维暂时做不到）时，把 `rag.searchStore.provider` 换成 `pg-fts-bigram` 即可，
// 零数据库扩展、零原生依赖、无版本漂移 —— 切分规则是数学定义，改它才需要
// REINDEX，而它几乎不会改。
//
// ## 与 P0-3 任务原文的一处偏离（有意）
//
// 任务原文写的是「纯 SQL 的 CJK 2-gram 函数，版本化命名（如 `cjk_bigram_v1`）」。
// 实际实现放在**应用侧**，理由是 P3-2 之后检索文本已经由应用写入 `search_text`、
// `search_vector` 只是它的生成列：
//   1. 用 SQL 函数就得让 `search_text` 存原文，把「分词在应用侧」这条已经在
//      jieba 路径上成立的约定破掉 —— 同一个 provider 槽位不该有两种存储形态；
//   2. SQL 函数是 DDL 对象，改它要走迁移 + 手工 REINDEX；应用侧实现只改一个
//      版本串（`tokenizer_version`），与 jieba 的运维流程完全一致；
//   3. 函数体在应用侧才能被单测直接覆盖（SQL 函数只能靠连库测）。
// 代价是「文档侧与查询侧必须同函数」这条约束从数据库保证变成版本串保证 ——
// 与 jieba 路径承担的是同一个风险，没有额外引入新的失败模式。
//
// ## 规则
//
//   - CJK 连续段 → 相邻 2-gram（长度 1 的段保留单字，否则单字查询永远查不到）；
//   - ASCII 字母数字段 → 整词小写（英文标识符不该被 2-gram 切碎）；
//   - 其余字符（标点 / 空白 / 分隔符）→ 丢弃。
//
// 为何不做成「bigram + 整段」：整段（如「订单退款接口」）在查询里几乎不会
// 出现，白占索引体积；bigram 已经覆盖了「用户写的是文档子串」这一主要场景。
// ═══════════════════════════════════════════════════════════════════

import type { Tokenizer } from "../contracts";
import { normalizeIdentifiers, type CharClass, classifyChar } from "./identifiers";

/** 切分规则版本：改了就必须 REINDEX（见文件头）。 */
const BIGRAM_VERSION = "bigram@v1:norm=v1";

export function cjkBigramTokenizer(): Tokenizer {
  return {
    version: BIGRAM_VERSION,
    tokenize: cjkBigram,
    normalizeIdentifiers,
  };
}

function cjkBigram(text: string): string[] {
  const terms: string[] = [];
  const normalized = text.normalize("NFC").toLowerCase();

  let run = "";
  let runClass: CharClass | undefined;

  const flush = (): void => {
    if (run === "") return;
    if (runClass === "cjk") {
      if (run.length === 1) {
        terms.push(run);
      } else {
        for (let i = 0; i + 1 < run.length; i += 1) terms.push(run.slice(i, i + 2));
      }
    } else {
      terms.push(run);
    }
    run = "";
    runClass = undefined;
  };

  for (const char of normalized) {
    const kind = classifyChar(char);
    if (kind === "separator") {
      flush();
      continue;
    }
    if (runClass !== undefined && kind !== runClass) flush();
    runClass = kind;
    run += char;
  }
  flush();

  return terms;
}
