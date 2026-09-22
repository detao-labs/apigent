// ═══════════════════════════════════════════════════════════════════
// Stages — 标识符归一化（与中文方案无关，无条件必做）
// ═══════════════════════════════════════════════════════════════════
//
// 规则（P0-3 定案的口径）：**小写 + 非字母数字（含分隔符）转空格 + 去重保序**。
//
//   `POST /orders/{id}/refund` → ["post", "orders", "id", "refund"]
//   `refundOrder`              → ["refundorder"]      ← 见下方「有意不做的事」
//
// 为什么必做：spike 实测「松散标识符」这一类查询（用户或 LLM 写
// `orders refund` 而不是 `POST /orders/{id}/refund`）在 FTS 里 **100% 空召回**，
// 因为整条 path 被切成一个 `file` token，只有字面全等才命中。根因不在中文，
// 而在分词口径 —— 所以 `pg-fts-jieba` / `-bigram` / `-simple` 三个 provider
// 共用本函数，谁都不能自己再写一遍。
//
// 有意不做的事：**不拆 camelCase / snake_case**（`refundOrder` 不会被拆成
// `refund` + `order`）。P0-3 的定案只写「小写 + 非字母数字转空格」。要加就得
// 改这里的口径 → `tokenizer_version` 变 → 必须 REINDEX，所以它是一个独立的
// 决策点，而不是顺手做的优化。
// ═══════════════════════════════════════════════════════════════════

/** 分隔符：字母、数字、CJK 之外的一切（`/` `{` `}` `-` `_` `:` `.` 空格…）。 */
const IDENTIFIER_SEPARATOR = /[^a-z0-9\u3400-\u4dbf\u4e00-\u9fff]+/u;

/**
 * 标识符归一化。CJK 保留（path 里可能有 `/订单/{id}`），并在结果内去重 ——
 * 标识符的权重来自它在 SQL 里的 setweight 区段，不靠词频。
 */
export function normalizeIdentifiers(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const part of text.normalize("NFC").toLowerCase().split(IDENTIFIER_SEPARATOR)) {
    if (part === "" || seen.has(part)) continue;
    seen.add(part);
    terms.push(part);
  }

  return terms;
}
