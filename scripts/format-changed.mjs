#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// Format changed files only
// ═══════════════════════════════════════════════════════════════════
//
// 全仓 `prettier --check .` 目前仍有上百个历史文件不合格，直接上 CI 会满堂红。
// 所以只检查**本次改动**的文件：新引入的格式问题一定挡住，历史欠账不追溯。
//
// 用法：
//   node scripts/format-changed.mjs            # 与 origin/main 比较（CI 默认）
//   node scripts/format-changed.mjs --base=HEAD~1
//   node scripts/format-changed.mjs --all      # 检查全仓（本地想清欠账时用）
// ═══════════════════════════════════════════════════════════════════

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const baseArg = args.find((a) => a.startsWith("--base="));
const checkAll = args.includes("--all");

/** prettier 能处理的扩展名（与仓库实际用到的类型一致）。 */
const EXTENSIONS = /\.(ts|tsx|js|mjs|cjs|json|md|ya?ml|css)$/;
/** 生成物 / 依赖 / 锁文件不检查。 */
const IGNORED = /^(node_modules|dist|\.next|coverage|pnpm-lock\.yaml)/;

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function resolveBase() {
  if (baseArg) return baseArg.slice("--base=".length);
  // CI 里优先用 PR 的目标分支；拿不到就退回上一个提交
  for (const candidate of ["origin/main", "main", "HEAD~1"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", candidate]);
      return candidate;
    } catch {
      // 试下一个
    }
  }
  return null;
}

function changedFiles() {
  const base = resolveBase();
  if (!base) {
    console.warn("[format:changed] no base ref found — falling back to a full check");
    return null;
  }
  // --diff-filter=d 去掉删除的文件；-z 处理含空格/中文的路径
  const out = git(["diff", "--name-only", "--diff-filter=d", `${base}...HEAD`]);
  const committed = out ? out.split("\n") : [];
  // 工作区里还没提交的改动（本地运行时有用）
  const dirty = git(["diff", "--name-only", "--diff-filter=d", "HEAD"]);
  // 未跟踪的新文件也要检查（git diff 不会列它们）
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  return [
    ...new Set([
      ...committed,
      ...(dirty ? dirty.split("\n") : []),
      ...(untracked ? untracked.split("\n") : []),
    ]),
  ];
}

const candidates = checkAll ? null : changedFiles();
const targets =
  candidates === null
    ? ["."]
    : candidates.filter(
        (f) =>
          f &&
          EXTENSIONS.test(f) &&
          !IGNORED.test(f) &&
          // 已删除的文件不能再传给 prettier：它会以 "No files matching the
          // pattern" 非零退出，让任何删文件的 PR 都变红
          existsSync(f),
      );

if (targets.length === 0) {
  console.log("[format:changed] no changed files to check");
  process.exit(0);
}

// 直接用仓库里的 prettier；裸 `node scripts/...` 时 PATH 里没有 node_modules/.bin
const localPrettier = join(process.cwd(), "node_modules", ".bin", "prettier");
const prettierBin = existsSync(localPrettier) ? localPrettier : "prettier";

console.log(`[format:changed] checking ${targets.length} file(s)`);
try {
  execFileSync(prettierBin, ["--check", ...targets], { stdio: "inherit" });
} catch (err) {
  if (err?.code === "ENOENT") {
    console.error("[format:changed] prettier not found — run `pnpm install` first");
  } else {
    console.error("\n[format:changed] run `pnpm format` (or `npx prettier --write <file>`) to fix");
  }
  process.exit(1);
}
