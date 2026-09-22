// ═══════════════════════════════════════════════════════════════════
// 依赖约束守卫：依赖方向 + 客户端边界（P2-8）
// ═══════════════════════════════════════════════════════════════════
//
// 与 eslint.config.mjs 里 `no-restricted-imports` 的分工：
//   - lint 负责「写下的那一刻就报错」，覆盖 `@apigent/server` / 测试替身 / 适配器；
//   - 本文件负责 lint 表达不了的结构约束 —— **顶层 barrel 的导出形态**。
//     `export type * from "./contracts"` 与 `export * from "./contracts"` 在 lint
//     眼里是一样的，但前者客户端可以安全 import type、后者会把 node:crypto 打进
//     浏览器包。这是一行之差、后果不小的差别，所以用测试钉住。
//
// 实现沿用 no-otel.test.ts 的方式：按**行**匹配并跳过注释行，否则解释规则的
// 注释本身会被判定为违规。
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** 本文件就在 `src/` 下，所以 dirname 即 src 根。 */
const srcRoot = dirname(fileURLToPath(import.meta.url));
const indexPath = join(srcRoot, "index.ts");

/** 生产代码禁止的依赖方向（与 eslint 规则同一套判断，双保险）。 */
const FORBIDDEN_SPECIFIERS = [/["']@apigent\/server/, /["'][^"']*\/testing\//];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function isTestFile(file: string): boolean {
  return file.endsWith(".test.ts");
}

describe("client boundary", () => {
  it("the guard works (not vacuously passing)", () => {
    expect(walk(srcRoot).filter((file) => file.endsWith(".ts")).length).toBeGreaterThan(8);
    expect(FORBIDDEN_SPECIFIERS[0].test('import { x } from "@apigent/server/ai";')).toBe(true);
    expect(FORBIDDEN_SPECIFIERS[0].test('import { x } from "@apigent/core/ai";')).toBe(false);
    expect(
      FORBIDDEN_SPECIFIERS[1].test('import { hashEmbedder } from "../testing/hash-embedder";'),
    ).toBe(true);
    expect(isCommentLine('// 不要 import "@apigent/server"')).toBe(true);
  });

  it("no production file imports @apigent/server or a test double", () => {
    const offenders = walk(srcRoot)
      .filter((file) => file.endsWith(".ts") && !isTestFile(file))
      .filter((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .some((line) => !isCommentLine(line) && FORBIDDEN_SPECIFIERS.some((re) => re.test(line))),
      )
      .map((file) => relative(srcRoot, file));

    expect(offenders).toEqual([]);
  });
});

describe("顶层 barrel 的导出形态", () => {
  const indexSource = readFileSync(indexPath, "utf8");
  const codeLines = indexSource
    .split("\n")
    .filter((line) => !isCommentLine(line) && line.trim() !== "");

  it("re-exports contracts as types only", () => {
    // 值必须走 @apigent/rag/contracts：顶层 `export *` 会让客户端拿到值，
    // 从而把管线（node:crypto …）打进浏览器包。
    expect(codeLines).toContain('export type * from "./contracts";');
  });

  it("re-exports no values from contracts", () => {
    expect(codeLines.some((line) => /^export\s+\*\s+from\s+"\.\/contracts"/.test(line))).toBe(
      false,
    );
    expect(codeLines.some((line) => /^export\s*\{.*\}\s*from\s+"\.\/contracts"/.test(line))).toBe(
      false,
    );
  });

  it("never exposes test doubles", () => {
    expect(indexSource.includes('"./testing"')).toBe(false);
  });
});
