// ═══════════════════════════════════════════════════════════════════
// 依赖约束守卫：RAG 源码里不得 import 追踪后端
// ═══════════════════════════════════════════════════════════════════
//
// 这是 P2-4 的验收项之一。用测试而不是靠人记 —— 一旦有人图方便直接引入，这里会红。
//
// 之所以禁止：可观测性基建还没落地（observability.provider 有 4 个枚举、0 个实现），
// 直连追踪后端会把「观测平台选型」变成 RAG 的发布阻塞项；而且评测需要
// RecordingTelemetry 这类简单替身，不需要真后端。见 rag-package.md §7.1。
//
// 实现说明：按**行**判断并跳过注释行。否则本文件与 contracts/telemetry.ts 里
// 「解释这条规则」的注释本身就会被判定为违规。

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** 守卫自己不参与检查 —— 它必须持有违规样本才能自检。 */
const selfPath = fileURLToPath(import.meta.url);

/** 模块说明符形态：紧跟引号的包名，跳过注释行。 */
const FORBIDDEN_SPECIFIER = /["']@opentelemetry/;

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

describe("dependency guard", () => {
  it("the guard itself works (not vacuously passing)", () => {
    // 扫描确实覆盖到了源码
    expect(walk(srcRoot).filter((f) => f.endsWith(".ts")).length).toBeGreaterThan(5);
    // 正则确实能命中真实违规写法
    expect(FORBIDDEN_SPECIFIER.test('import { trace } from "@opentelemetry/api";')).toBe(true);
    expect(FORBIDDEN_SPECIFIER.test("const { trace } = require('@opentelemetry/api');")).toBe(true);
    // 但注释行会被跳过（否则解释规则的注释自己就违规了）
    expect(isCommentLine('// 不要 import "@opentelemetry/api"')).toBe(true);
    expect(isCommentLine(' * 不要 import "@opentelemetry/api"')).toBe(true);
  });

  it("no RAG source file imports a tracing backend", () => {
    const offenders = walk(srcRoot)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => file !== selfPath)
      .filter((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .some((line) => !isCommentLine(line) && FORBIDDEN_SPECIFIER.test(line)),
      )
      .map((file) => relative(srcRoot, file));

    expect(offenders).toEqual([]);
  });
});
