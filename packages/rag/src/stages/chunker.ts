// ═══════════════════════════════════════════════════════════════════
// RAG Stages — Chunker（hierarchical / fixed）
// ═══════════════════════════════════════════════════════════════════
//
// 文档源（P4-1）产出的是**语义单元**：一个仓库全局约定、一个 tag、一个接口、
// 一个 schema。它们大多数本来就该是一块；需要切的是**超长的那几个** ——
// 典型是带完整 JSON schema 的 L3（一个 model 展开后可能上万字符）。
//
// 为什么必须切而不是让它整块进去：embedding 模型有输入上限，超长输入会被**静默
// 截断**（截掉的部分永远召不回，而库里看起来「内容都在」）。这是最难发现的一类
// 检索退化，所以这里的原则是：
//
//   1. **不丢内容** —— 切出来的块拼回去能覆盖原文（`hierarchical` 只重复一行标题，
//      不删任何正文）；
//   2. **不切碎语义** —— 优先在段落边界（`Summary:` / `Parameters:` 这类 section
//      起始行）切；只有单个 section 本身就超长时才退到行、最后才退到硬切；
//   3. **每块自带标题** —— 切开的块各自带上首行（如 `POST /orders/{id}/refund`），
//      否则第二块开始就是没有主语的片段，召回与阅读都会退化。
//
// ## chunk_key 的规则（对账式同步的锚点）
//
//   - 未切分：`chunkKey === document.id`（P4-1 的 id 本身就是 `{level}:…` 的逻辑身份）；
//   - 切分后：`{document.id}#{part}`（0-based）。
//
// **语言的修订（P4-2 定案）**：P0-4 曾写 `{level}:{method}:{path}:{lang}`。既然
// 已定「不做翻译，一个单元一块」，`lang` 就不再是身份的一部分 —— 它是**内容属性**。
// 把它放进 key 会有两个实际代价：① 语言判定（P4-1 按内容判）在边界文本上可能翻转，
// 那会让 key 抖动 ⇒ 每轮跑都「删一个、插一个」；② 源文档换语言会留下一个孤儿 key。
// 现在语言变化只改 `content_hash` ⇒ 命中内容寻址、**原地更新**那一行。
// （将来若真的做翻译，key 必须重新带上语言后缀，否则同一逻辑单元会有两行同 key
// 不同 hash、检索时互相重复。）
import type { Chunker, RagChunk, RagDocument } from "../contracts";

export const DEFAULT_MAX_CHARS = 2000;

export function hierarchicalChunker(options: { maxChars?: number } = {}): Chunker {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  return {
    chunk(documents) {
      return documents.flatMap((document) => splitDocument(document, maxChars, splitAtSections));
    },
  };
}

/**
 * 基准实现：只按字符数硬切，完全不看结构。
 *
 * 保留它不是凑数 —— 它是评测（Phase 7）里 `hierarchical` 的**对照组**：只有拿一个
 * 「切得一样多但不讲结构」的基线比，才能说明结构感知到底带来了多少召回收益。
 * `rag.chunkStrategy: fixed` 选的就是它。
 */
export function fixedChunker(options: { maxChars?: number } = {}): Chunker {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

  return {
    chunk(documents) {
      return documents.flatMap((document) => splitDocument(document, maxChars, splitByLength));
    },
  };
}

/** 配置槽 `rag.chunkStrategy` 的取值 → 实现（单一映射点，避免两处各写一遍）。 */
export function chunkerForStrategy(
  strategy: ChunkStrategyName,
  options: { maxChars?: number } = {},
): Chunker {
  switch (strategy) {
    case "hierarchical":
      return hierarchicalChunker(options);
    case "fixed":
      return fixedChunker(options);
  }
}

/**
 * `rag.chunkStrategy` 的取值。
 *
 * 与 `@apigent/core/config` 的 `ChunkStrategy` 同形 —— 这里不 import 它，是为了让
 * `@apigent/rag/stages` 保持「零配置依赖」（它要能在浏览器外的任何宿主里单独用）。
 * 漂移由 `chunker.test.ts` 的编译期断言钉住（`satisfies` 双向检查）。
 */
export type ChunkStrategyName = "hierarchical" | "fixed";

// ───────────────────────────────────────────────────────────────────
// 切分
// ───────────────────────────────────────────────────────────────────

/** 把一个文档切成若干块；未超限时原样返回一块。 */
function splitDocument(
  document: RagDocument,
  maxChars: number,
  split: (text: string, maxChars: number) => string[],
): RagChunk[] {
  const pieces =
    document.text.length <= maxChars ? [document.text] : split(document.text, maxChars);

  return pieces.map((text, part) => ({
    chunkKey: pieces.length === 1 ? document.id : `${document.id}#${part}`,
    document: text === document.text ? document : { ...document, text },
    part,
    parts: pieces.length,
  }));
}

/**
 * 结构感知切分：首行是标题，其余按 section 起始行（`Summary:`、`Parameters:` …）
 * 分组；每组尽量装满，装不下就另起一块。每块都带上标题行。
 */
function splitAtSections(text: string, maxChars: number): string[] {
  const [head, ...rest] = text.split("\n");
  const header = head ?? "";
  // 每块都要重复一次标题，所以真正可用的预算是「上限 − 标题 − 换行」。
  const budget = Math.max(1, maxChars - header.length - 1);

  const parts: string[] = [];
  let packed: string[] = [];

  const flush = (): void => {
    if (packed.length === 0) return;
    parts.push([header, ...packed].join("\n"));
    packed = [];
  };

  for (const section of groupSections(rest)) {
    if (section.length > budget) {
      // 单个 section 就超预算：按行装，只有「单行本身就超预算」时才硬切那一行。
      flush();
      parts.push(...splitOversizedSection(header, section, budget));
      continue;
    }

    const size = packed.reduce((sum, item) => sum + item.length + 1, 0);
    if (packed.length > 0 && size + section.length > budget) flush();
    packed.push(section);
  }

  flush();
  return parts;
}

/** 按 section 起始行分组。第一行（若有）总是新 section 的开头。 */
function groupSections(lines: string[]): string[] {
  const sections: string[] = [];
  for (const line of lines) {
    if (sections.length === 0 || isSectionStart(line)) sections.push(line);
    else sections[sections.length - 1] += `\n${line}`;
  }
  return sections;
}

/**
 * 超预算 section 的切法：优先按行装箱（行是语义边界，半行没有意义），单行还超预算
 * 才硬切 —— 硬切时**只有第一片带标题**：往行的中间插标题会把内容本身改坏（比如把
 * 一段 JSON 从中间截断再塞进一行标题）。
 */
function splitOversizedSection(header: string, section: string, budget: number): string[] {
  const parts: string[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    if (buffer.length === 0) return;
    parts.push([header, ...buffer].join("\n"));
    buffer = [];
  };

  for (const line of section.split("\n")) {
    if (line.length <= budget) {
      const size = buffer.reduce((sum, item) => sum + item.length + 1, 0);
      if (buffer.length > 0 && size + line.length > budget) flush();
      buffer.push(line);
      continue;
    }

    flush();
    splitByLength(line, budget).forEach((slice, index) => {
      parts.push(index === 0 ? `${header}\n${slice}` : slice);
    });
  }

  flush();
  return parts;
}

function isSectionStart(line: string): boolean {
  return /^[A-Za-z][A-Za-z0-9 /-]*:$/.test(line);
}

/** 兜底切分：不认结构，按字符数硬切（行内也会被切开，但不丢字符）。 */
function splitByLength(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const parts: string[] = [];
  for (let offset = 0; offset < text.length; offset += maxChars) {
    parts.push(text.slice(offset, offset + maxChars));
  }
  return parts;
}
