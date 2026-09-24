import { describe, it, expect } from "vitest";
import type { ChunkStrategy } from "@apigent/core/config";
import type { RagDocument } from "../contracts";
import {
  chunkerForStrategy,
  fixedChunker,
  hierarchicalChunker,
  type ChunkStrategyName,
} from "./chunker";

// ───────────────────────────────────────────────────────────────────
// 与 core 的配置枚举不得漂移（F5：`rag.chunkStrategy` 与实现各写一份就迟早不一致）
// ───────────────────────────────────────────────────────────────────

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const _strategyMatchesCoreConfig: Equal<ChunkStrategyName, ChunkStrategy> = true;
void _strategyMatchesCoreConfig;

// ───────────────────────────────────────────────────────────────────
// 样本
// ───────────────────────────────────────────────────────────────────

function document(overrides: Partial<RagDocument> = {}): RagDocument {
  return {
    id: "endpoint:POST:/orders/{id}/refund",
    level: "endpoint",
    lang: "zh",
    organizationId: "org-1",
    text: "POST /orders/{id}/refund\nSummary:\n发起退款",
    fields: { method: "POST", path: "/orders/{id}/refund" },
    ...overrides,
  };
}

/** 造一个多 section 的超长文档（模拟带完整 JSON schema 的 L3）。 */
function longDocument(): RagDocument {
  const sections = Array.from({ length: 12 }, (_, i) => `Section${i}:\n${"x".repeat(180)}`).join(
    "\n",
  );

  return document({
    id: "schema:POST:/orders/{id}/refund:request",
    level: "schema",
    text: `Request schema: POST /orders/{id}/refund\n${sections}`,
  });
}

// ───────────────────────────────────────────────────────────────────
// 验收 ①：chunk_key 稳定 + 同输入幂等
// ───────────────────────────────────────────────────────────────────

describe("hierarchicalChunker — chunk_key 的稳定性", () => {
  it("未超限的文档：key 就是逻辑身份，part/parts 为 0/1", () => {
    const chunks = hierarchicalChunker().chunk([document()]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      chunkKey: "endpoint:POST:/orders/{id}/refund",
      part: 0,
      parts: 1,
    });
    expect(chunks[0]?.document.text).toBe(document().text);
  });

  it("同一输入重复跑，输出逐字相同（幂等 —— 对账式同步的前提）", () => {
    const input = [document(), longDocument(), document({ id: "tag:订单", level: "tag" })];
    const chunker = hierarchicalChunker();

    expect(chunker.chunk(input)).toEqual(chunker.chunk(input));
  });

  it("期望集合可以从文档 id 精确算出（key 不含隐藏状态）", () => {
    const input = [document(), longDocument()];
    const keys = hierarchicalChunker()
      .chunk(input)
      .map((chunk) => chunk.chunkKey);

    // 未切分的用 id，切分的用 id#n —— 没有第三种形态。
    expect(keys[0]).toBe(input[0]?.id);
    expect(keys.slice(1).every((key) => key.startsWith(`${input[1]?.id}#`))).toBe(true);
  });

  it("切分后 part 从 0 连续递增，parts 与块数一致", () => {
    const chunks = hierarchicalChunker({ maxChars: 400 }).chunk([longDocument()]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.part)).toEqual(chunks.map((_, i) => i));
    expect(chunks.every((chunk) => chunk.parts === chunks.length)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────
// 验收 ②：切分不丢内容、不切碎语义
// ───────────────────────────────────────────────────────────────────

describe("hierarchicalChunker — 切分规则", () => {
  it("每块都带上文档首行的标题（否则第二块起就没有主语）", () => {
    const chunks = hierarchicalChunker({ maxChars: 400 }).chunk([longDocument()]);

    for (const chunk of chunks) {
      expect(chunk.document.text.startsWith("Request schema: POST /orders/{id}/refund\n")).toBe(
        true,
      );
    }
  });

  it("不丢内容：所有 section 都出现在某一块里，且只出现一次", () => {
    const chunks = hierarchicalChunker({ maxChars: 400 }).chunk([longDocument()]);
    const joined = chunks.map((chunk) => chunk.document.text).join("\n");

    for (let i = 0; i < 12; i++) {
      const occurrences = joined.split(`Section${i}:`).length - 1;
      expect(occurrences, `Section${i} 出现 ${occurrences} 次`).toBe(1);
    }
  });

  it("不切碎 section：每块里的 section 都是完整的（不会只含半段）", () => {
    const chunks = hierarchicalChunker({ maxChars: 400 }).chunk([longDocument()]);

    for (const chunk of chunks) {
      for (const line of chunk.document.text.split("\n")) {
        // 正文行要么是标题/空行，要么是完整的 180 个 x（被硬切的话会短于 180）
        if (line.startsWith("x")) expect(line).toHaveLength(180);
      }
    }
  });

  it("单个 section 就超长（展开后的 JSON schema）→ 退化为长度切分，仍然不丢字符", () => {
    const json = JSON.stringify({ type: "object", properties: { big: "y".repeat(1200) } });
    const doc = document({
      id: "schema:POST:/x:request",
      level: "schema",
      text: `Request schema: POST /x\nBody schema:\n${json}`,
    });

    const chunks = hierarchicalChunker({ maxChars: 300 }).chunk([doc]);
    const title = "Request schema: POST /x";

    expect(chunks.length).toBeGreaterThan(1);
    // 去掉每块重复的标题行后拼回去，原始 JSON 必须一字不少（硬切也不许丢字符）。
    const withoutTitles = chunks
      .map((chunk) => chunk.document.text)
      .map((text) => (text.startsWith(`${title}\n`) ? text.slice(title.length + 1) : text))
      .join("");
    expect(withoutTitles).toContain(json);
  });

  it("空文档集合 → 空结果（不造空 chunk）", () => {
    expect(hierarchicalChunker().chunk([])).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────
// 基准实现与策略映射
// ───────────────────────────────────────────────────────────────────

describe("fixedChunker / chunkerForStrategy", () => {
  it("fixed 不看结构，按字符数硬切（对照组）", () => {
    const chunks = fixedChunker({ maxChars: 200 }).chunk([longDocument()]);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.document.text.length <= 200)).toBe(true);
    // 硬切的结果**不保证**每块都有标题 —— 这正是它作为对照组的差别。
    expect(chunks.some((chunk) => !chunk.document.text.includes("Section"))).toBe(true);
  });

  it("hierarchical 与 fixed 对同一份输入的切块数不同（说明结构确实起作用）", () => {
    const input = [longDocument()];
    const hierarchical = hierarchicalChunker({ maxChars: 400 }).chunk(input);
    const fixed = fixedChunker({ maxChars: 400 }).chunk(input);

    expect(hierarchical.map((chunk) => chunk.chunkKey)).not.toEqual(
      fixed.map((chunk) => chunk.chunkKey),
    );
  });

  it("chunkerForStrategy 覆盖枚举的每个取值（TS 穷尽 + 运行期有实现）", () => {
    for (const strategy of ["hierarchical", "fixed"] satisfies ChunkStrategyName[]) {
      expect(chunkerForStrategy(strategy, { maxChars: 100 })).toBeDefined();
    }
    expect(chunkerForStrategy("hierarchical", { maxChars: 100 }).chunk([document()])).toHaveLength(
      1,
    );
  });
});
