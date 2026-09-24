// ═══════════════════════════════════════════════════════════════════
// RAG Pipeline — provider 包加载 + 启动期自检（P0-6）
// ═══════════════════════════════════════════════════════════════════
//
// P0-6 定案：「`provider` 字段支持内置枚举值 **或 npm 包名**，改 YAML + 重启即
// 生效」。注册表（P2-6）负责「名字 → 工厂」，本文件负责**把包名变成注册项**，
// 并在启动期把配置声明的 provider 全部加载一遍 —— 让「重启后生效」有一个明确的
// 成功 / 失败信号，而不是等第一次检索才发现包名写错。
//
// 三条规则：
//
// 1. **只接受 npm 包名，不接受文件路径。** 配置文件常被复制、被工单传递，路径
//    会让它变成任意代码执行入口；包名要求该包**已安装为依赖**，门槛与可审计性
//    高得多，而「改一行配置 + 重启」的体验完全保留（P0-6）。
// 2. **导出形状要校验。** TS 类型运行时不可见，包可能导出默认导出、命名导出、
//    甚至导出一个对象。形状不对时错误信息必须说清「期望什么、实际有什么」。
// 3. **加载成功即注册。** 第二次解析同一个包名不再重复 import（模块缓存本身也
//    会去重，但注册后连 `has()` 判断都不用走加载路径）。
//
// ⚠️ 本文件**不放**「按配置实例化」的逻辑：`loadStageFactory()` 只解决「拿到
// 工厂」，实例化与 options 注入仍在 `createRagService()` 的装配期完成。
// 这样启动期自检可以只做「加载 + 形状校验」，不产生任何副作用（连不上 DB 也
// 不该让自检失败）。
// ═══════════════════════════════════════════════════════════════════

import { isNpmPackageName } from "@apigent/core/config";
import { RagConfigError, type RagService } from "../contracts";
import type {
  RagProviderSelection,
  RagServiceFactory,
  RagServiceFactoryContext,
  RagStageFactoryMap,
  RagStageKind,
  RagStageRegistry,
} from "./types";

/**
 * 每个阶段在 provider 包里**推荐**的导出名（`default` 导出同样接受）。
 *
 * 为什么同时接受 `default`：一个包只提供一个阶段实现时，`export default` 是最
 * 自然的写法；强制命名导出会让「只想换一个 embedder」的包作者多写一层包装。
 * 而多阶段包（一个包同时提供 embedder + reranker）必须用命名导出区分。
 */
export const STAGE_FACTORY_EXPORT_NAMES: Record<RagStageKind, string> = {
  documentSource: "createDocumentSource",
  embedder: "createEmbedder",
  denseIndex: "createDenseIndex",
};

/**
 * L0 包应当导出的名字（`default` 导出同样接受）。
 *
 * 与阶段工厂分开命名不是洁癖：同一个包里可以既有 L0 的 `createRagService`、又有
 * 若干阶段工厂，导出名不冲突，宿主也不会把两者弄混。
 */
export const RAG_SERVICE_FACTORY_EXPORT_NAME = "createRagService";

/** 注入点：测试用假加载器，生产用动态 `import()`。 */
export type RagStageModuleLoader = (specifier: string) => Promise<unknown>;

export interface LoadStageFactoryOptions {
  loadModule?: RagStageModuleLoader;
}

export interface PreloadedProvider {
  kind: RagStageKind;
  name: string;
  /** `registry` = 内置或已注册；`package` = 本次从 npm 包加载的 */
  source: "registry" | "package";
}

/**
 * 解析一个阶段的工厂：先查注册表，未命中再按 npm 包名加载。
 *
 * 加载成功会**注册进 `registry`**，所以同一个 registry 上重复调用是廉价的。
 */
export async function loadStageFactory<K extends RagStageKind>(
  registry: RagStageRegistry,
  kind: K,
  name: string,
  options: LoadStageFactoryOptions = {},
): Promise<RagStageFactoryMap[K]> {
  if (registry.has(kind, name)) return registry.resolve(kind, name);

  // 包名规则来自 `@apigent/core/config`，与 zod 校验**同源**：否则会出现
  // 「配置校验通过、加载时被拒」这种自相矛盾的启动失败。
  if (!isNpmPackageName(name)) {
    throw new RagConfigError(
      `rag: stage "${kind}" provider "${name}" is neither a registered implementation nor a ` +
        `valid npm package name. Registered: ${knownNames(registry, kind)}. ` +
        "File paths are not supported: config files get copied and passed around, which would " +
        "turn them into an arbitrary-code-execution entry point; a package name requires the " +
        "package to be installed as a dependency.",
    );
  }

  const loadModule = options.loadModule ?? ((specifier: string) => import(specifier));
  let loaded: unknown;
  try {
    loaded = await loadModule(name);
  } catch (error) {
    throw new RagConfigError(
      `rag: failed to load provider package "${name}" for stage "${kind}". Two possibilities: ` +
        `(1) "${name}" is a built-in enum whose implementation is not registered yet (built-ins ` +
        `land with their own tasks), or (2) it is an npm package that is not installed (run ` +
        `\`pnpm add\` first). Registered: ${knownNames(registry, kind)}. ` +
        `Underlying error: ${messageOf(error)}`,
      { cause: error },
    );
  }

  const factory = pickFactory(kind, name, loaded);
  registry.register(kind, name, factory);
  return factory;
}

/**
 * 启动期自检：把配置里声明的 provider **全部解析一遍**。
 *
 * 调用点应是进程启动（platform / worker / MCP 网关）。任何一项失败都在这里抛出
 * `RagConfigError`，进程启动失败并给出可读原因 —— 这就是 P0-6 要的那个信号。
 *
 * 返回值列出每个 provider 的来源（内置 / 包），供启动日志打印。
 */
export async function preloadStageProviders(
  registry: RagStageRegistry,
  providers: RagProviderSelection,
  options: LoadStageFactoryOptions = {},
): Promise<PreloadedProvider[]> {
  const kinds: RagStageKind[] = ["documentSource", "embedder", "denseIndex"];
  const result: PreloadedProvider[] = [];

  for (const kind of kinds) {
    const name = providers[kind].name;
    const source = registry.has(kind, name) ? "registry" : "package";
    await loadStageFactory(registry, kind, name, options);
    result.push({ kind, name, source });
  }

  return result;
}

// ───────────────────────────────────────────────────────────────────
// L0 —— 整体替换的加载与形状校验（P3-7）
// ───────────────────────────────────────────────────────────────────
//
// 与阶段加载器**同源规则、分开函数**：包名规则、错误风格、`default` 导出的接受
// 程度都一致（用户只需记一套），但 L0 多一步「调用工厂后校验返回的实例形状」——
// 阶段工厂的产物由管线自己使用，而 L0 包的产物直接就是 `RagService`，形状不对
// 会一路拖到第一次检索才炸。

/**
 * 加载一个 L0 包的工厂：`createRagService` 命名导出，或 `default` 导出。
 *
 * 只做「加载 + 导出形状校验」，**不调用**它 —— 与 `preloadStageProviders` 同一
 * 原则：启动期自检不该产生副作用（建连接池、拉模型都要等真正装配时）。
 */
export async function loadRagServiceFactory(
  packageName: string,
  options: LoadStageFactoryOptions = {},
): Promise<RagServiceFactory> {
  // 包名规则来自 `@apigent/core/config`，与 zod 校验同源（理由见文件头）。
  if (!isNpmPackageName(packageName)) {
    throw new RagConfigError(
      `rag: L0 provider "${packageName}" is not a valid npm package name. ` +
        "File paths are not supported: config files get copied and passed around, which would " +
        "turn them into an arbitrary-code-execution entry point; a package name requires the " +
        "package to be installed as a dependency.",
    );
  }

  const loadModule = options.loadModule ?? ((specifier: string) => import(specifier));
  let loaded: unknown;
  try {
    loaded = await loadModule(packageName);
  } catch (error) {
    throw new RagConfigError(
      `rag: failed to load L0 provider package "${packageName}". Two possibilities: ` +
        `(1) it is not installed (run \`pnpm add ${packageName}\`), or (2) its entry point throws ` +
        "on import. " +
        `Underlying error: ${messageOf(error)}`,
      { cause: error },
    );
  }

  if (loaded === null || (typeof loaded !== "object" && typeof loaded !== "function")) {
    throw new RagConfigError(`rag: L0 provider package "${packageName}" exported nothing`);
  }

  const module = loaded as Record<string, unknown>;
  const named = module[RAG_SERVICE_FACTORY_EXPORT_NAME];
  if (typeof named === "function") return named as RagServiceFactory;

  // `default` 导出也接受，理由同 STAGE_FACTORY_EXPORT_NAMES（只提供一个实现时
  // `export default` 是最自然的写法）。
  if (typeof module.default === "function") return module.default as RagServiceFactory;

  throw new RagConfigError(
    `rag: L0 provider package "${packageName}" has the wrong export shape: expected a named ` +
      `export \`${RAG_SERVICE_FACTORY_EXPORT_NAME}\` or a \`default\` factory function, ` +
      `but found [${exportedNames(module)}]`,
  );
}

/**
 * 校验工厂返回的东西确实是 `RagService`。
 *
 * 三个方法（`index` / `retrieve` / `health`）是契约的全部（P0-5：没有 answer），
 * 所以这次检查也就是完整的接口检查。
 */
export function assertRagServiceShape(candidate: unknown, source: string): RagService {
  if (candidate === null || typeof candidate !== "object") {
    throw new RagConfigError(
      `rag: L0 provider "${source}" returned ${describeValue(candidate)}, expected an object ` +
        "implementing RagService (index / retrieve / health)",
    );
  }

  const service = candidate as Record<string, unknown>;
  const missing = (["index", "retrieve", "health"] as const).filter(
    (method) => typeof service[method] !== "function",
  );
  if (missing.length > 0) {
    throw new RagConfigError(
      `rag: L0 provider "${source}" returned an object without ${missing.join(", ")}; ` +
        "expected an object implementing RagService (index / retrieve / health)",
    );
  }

  return candidate as RagService;
}

/**
 * 装配一个 L0 包：加载工厂 → 调用 → 校验实例形状。
 *
 * 一次调用完成三件事，是为了让调用方**没有机会漏掉**形状校验 —— 拆开写的 API
 * 迟早有人只调 `loadRagServiceFactory` 然后直接用返回值。
 */
export async function createRagServiceFromPackage(
  provider: { package: string; options?: Record<string, unknown> },
  context: Omit<RagServiceFactoryContext, "options">,
  options: LoadStageFactoryOptions = {},
): Promise<RagService> {
  const factory = await loadRagServiceFactory(provider.package, options);
  const service = await factory({ ...context, options: provider.options ?? {} });
  return assertRagServiceShape(service, provider.package);
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "object" ? "an object" : `${typeof value} (${String(value)})`;
}

// ───────────────────────────────────────────────────────────────────
// 内部
// ───────────────────────────────────────────────────────────────────

function pickFactory<K extends RagStageKind>(
  kind: K,
  packageName: string,
  loaded: unknown,
): RagStageFactoryMap[K] {
  if (loaded === null || (typeof loaded !== "object" && typeof loaded !== "function")) {
    throw new RagConfigError(
      `rag: provider package "${packageName}" exported nothing (stage "${kind}")`,
    );
  }

  const module = loaded as Record<string, unknown>;
  const expected = STAGE_FACTORY_EXPORT_NAMES[kind];

  const named = module[expected];
  if (typeof named === "function") return named as RagStageFactoryMap[K];

  // default 导出也接受（见 STAGE_FACTORY_EXPORT_NAMES 的说明）。
  // 注意 ESM namespace 的 `default` 与 CJS interop 后的 `default` 都落在这里。
  const fallback = module.default;
  if (typeof fallback === "function") return fallback as RagStageFactoryMap[K];

  throw new RagConfigError(
    `rag: provider package "${packageName}" has the wrong export shape (stage "${kind}"): ` +
      `expected a named export \`${expected}\` or a \`default\` factory function, ` +
      `but found [${exportedNames(module)}]`,
  );
}

function exportedNames(module: Record<string, unknown>): string {
  const names = Object.keys(module);
  return names.length > 0 ? names.join(", ") : "none";
}

function knownNames(registry: RagStageRegistry, kind: RagStageKind): string {
  const names = registry.names(kind);
  return names.length > 0 ? names.join(", ") : "(none)";
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
