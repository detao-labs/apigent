// ═══════════════════════════════════════════════════════════════════
// Apigent Config — 第三方 provider 包名规则（P0-6 定案）
// ═══════════════════════════════════════════════════════════════════
//
// 一个 provider 可以是**内置枚举值**，也可以是**一个 npm 包**（由包提供实现）。
// 后者写成显式判别：`{ provider: package, package: "@acme/x", options: {...} }`。
//
// 包名规则放在 core 而不是各消费方各写一遍：配置校验（zod）与运行时加载器
// （`@apigent/rag` 的 `loadStageFactory`）必须**对「什么算合法包名」有完全一致
// 的判断**，否则会出现「配置校验通过、加载时被拒」这种自相矛盾的启动失败。
// ═══════════════════════════════════════════════════════════════════

/**
 * npm 包名（可带 scope）。
 *
 * **故意不匹配** `./x`、`../x`、`/abs/x`、`C:\x`、`file:/x` 这类路径，也不匹配
 * 含空格或大写的可疑串。理由（P0-6）：配置文件常被复制、被工单传递，允许路径
 * 等于把配置变成**任意代码执行入口**；包名要求该包已安装为依赖，门槛与可审计性
 * 高得多，而「改一行配置 + 重启」的体验完全保留。
 */
export const NPM_PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9-._]*\/)?[a-z0-9][a-z0-9-._]*$/;

export function isNpmPackageName(value: string): boolean {
  return NPM_PACKAGE_NAME_PATTERN.test(value);
}

/**
 * 校验失败时的统一文案 —— zod 与手工校验共用，避免两处说法不一致。
 *
 * 写成英文：它会随错误信息进入日志（运行时输出统一英文，注释与文档保持中文）。
 */
export const NPM_PACKAGE_NAME_HINT =
  "expected an npm package name (optionally scoped, e.g. @acme/apigent-rag-qdrant); " +
  "file paths are not accepted because config files get copied and passed around, " +
  "which would turn them into an arbitrary-code-execution entry point (P0-6)";
