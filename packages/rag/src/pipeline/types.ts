// ═══════════════════════════════════════════════════════════════════
// RAG Pipeline — 装配契约
// ═══════════════════════════════════════════════════════════════════
//
// 一句话：**管线只认识端口和名字，不认识任何具体实现。**
//
// 具体实现（pgvector / qwen / jieba / memory / hash …）由 `@apigent/server`
// 在启动期注册进 `RagStageRegistry`，再由配置里的 `provider` 字段选中（P0-6）。
// 因此 `src/pipeline/**` 里**不允许 import 任何 adapters** —— 这条约束由 P2-8
// 的 lint 规则钉住，也由「换掉注入即可改行为」这条验收反向验证。
//
// 为什么不是「构造好一堆实例再传进来」：那样 provider 的配置解析与实例化会散在
// 调用方，四个消费端点（平台 / agent / MCP / 评测）各写一遍，迟早不一致。
// 注册表把「名字 → 工厂」收成一处，`createRagService` 在构造期解析并 fail-fast。
// ═══════════════════════════════════════════════════════════════════

import type {
  Chunker,
  DenseIndex,
  Embedder,
  RagDocumentSource,
  RagService,
  RagTelemetry,
} from "../contracts";

/**
 * 可替换阶段的名字。
 *
 * 只列 P2-6 能装配的阶段；其余阶段（SparseIndex / Reranker / QueryRewriter /
 * Fusion / ContextExpander）随各自任务加入，避免出现「注册表里有、管线里没有」的
 * 死槽位。
 */
export type RagStageKind = "documentSource" | "embedder" | "denseIndex";

/** 工厂拿到的上下文：该 provider 自己的配置片段 + 共享依赖（DB 句柄、HTTP 客户端…） */
export interface RagStageFactoryContext {
  options: Record<string, unknown>;
  deps: RagStageDeps;
}

/**
 * 装配用依赖。
 *
 * 刻意是 `unknown` 的袋子而不是具体类型：`@apigent/rag` 不能依赖 `pg` 或
 * `drizzle`（见 docs/modules/rag-package.md §2.3），句柄的类型由**注册方**
 * （server 或第三方包）自己声明。
 */
export type RagStageDeps = Record<string, unknown>;

export type RagDocumentSourceFactory = (ctx: RagStageFactoryContext) => RagDocumentSource;
export type RagEmbedderFactory = (ctx: RagStageFactoryContext) => Embedder;
export type RagDenseIndexFactory = (ctx: RagStageFactoryContext) => DenseIndex;

/** 阶段 → 工厂类型。注册表按它分型，避免把 embedder 工厂注册进向量库槽位。 */
export interface RagStageFactoryMap {
  documentSource: RagDocumentSourceFactory;
  embedder: RagEmbedderFactory;
  denseIndex: RagDenseIndexFactory;
}

/**
 * 一个 `provider` 字段的取值。
 *
 * `name` 允许**内置枚举值**（`pgvector` / `qwen` …）或 **npm 包名**
 * （`@acme/apigent-rag-qdrant`）—— P0-6 定案。
 */
export interface RagProviderRef {
  name: string;
  /** 该 provider 的配置片段（来自 YAML 对应节点或 `apigent.config.ts` 内联值） */
  options?: Record<string, unknown>;
}

export interface RagProviderSelection {
  documentSource: RagProviderRef;
  embedder: RagProviderRef;
  denseIndex: RagProviderRef;
}

/**
 * 管线限额与开关 —— 来源是 `rag.*` 配置槽（四处同步，见 CLAUDE.md）。
 *
 * 它**不是** provider 配置：provider 自己的参数走 `RagProviderRef.options`。
 */
export interface RagPipelineConfig {
  /** 默认返回条数（`rag.retrieval.fineRankTopK`） */
  topK: number;
  /** 粗排候选数（`rag.retrieval.coarseRankTopK`）—— 精排 / 融合阶段的输入规模 */
  coarseRankTopK: number;
  /** 是否把查询原文写进 trace（`rag.telemetry.recordQueryText`） */
  recordQueryText: boolean;
}

export const DEFAULT_PIPELINE_CONFIG: RagPipelineConfig = {
  // 与 `DEFAULT_RAG_CONFIG.retrieval` 的 fineRankTopK / coarseRankTopK 保持一致 ——
  // 两处默认值不同会变成「没读配置时的行为与读了配置时不同」这种最难查的偏差。
  topK: 10,
  coarseRankTopK: 20,
  recordQueryText: true,
};

export interface RagServiceOptions {
  /** 启动期注册好实现的名字表 */
  registry: RagStageRegistry;
  /** 每个阶段选哪个 provider。解析失败即启动失败（P0-6 的 fail-fast 信号） */
  providers: RagProviderSelection;
  config?: Partial<RagPipelineConfig>;
  /**
   * 注入的观测端口。缺省 `NoopTelemetry`。
   *
   * 内部一律经 `failOpenTelemetry()` 包装：观测挂了不影响检索，且这条保证只写在
   * **一处**，不散落到每个阶段。
   */
  telemetry?: RagTelemetry;
  /**
   * 分块实现（P4-2）。**必填**：宿主按配置注入
   * `chunkerForStrategy(config.rag.chunkStrategy)`。
   *
   * 为什么不给「缺省 = 不分块」的兜底：那等于让分块在忘记注入时**静默消失**，
   * 超长文档会被 embedding 静默截断 —— 正是 P4-2 要消灭的失败模式。
   *
   * 为什么不进注册表：`rag.chunkStrategy` 是一个枚举（没有 `package` / `options`
   * 的位置），硬塞进 provider 机制只会造出第二种配置形态。
   */
  chunker: Chunker;
  /** 注入时钟（测试断言精确耗时 / 阶段耗时） */
  clock?: () => number;
  /**
   * traceId 生成器。
   *
   * server 侧应注入成读日志上下文的 `traceId`（P1-3），让日志与 trace 同源；
   * 缺省用 `randomUUID()`，保证单独跑评测时也有一条可关联的 ID。
   */
  createTraceId?: () => string;
  /** 装配用依赖（传给工厂） */
  deps?: RagStageDeps;
}

// ───────────────────────────────────────────────────────────────────
// L0 —— 整体替换（P0-6 / P3-7）
// ───────────────────────────────────────────────────────────────────
//
// 「换掉整条管线」与「换某一个阶段」是两件事，接口也分开：L0 的包**不认识**阶段
// 注册表与 provider 选择（那些是内置管线自己的装配细节），它只需要自己的配置 +
// 宿主注入的依赖与观测端口。
//
// 与阶段工厂（`RagStageFactoryContext`）保持同一形态：`options` + `deps` 两个键，
// 这样包作者只需要记一套心智模型。

/**
 * L0 工厂上下文 —— 第三方包实现整条 `RagService` 时拿到的入参。
 */
export interface RagServiceFactoryContext {
  /** 该包自己的配置（YAML `rag.provider.options`）：宿主只透传，形状由包自己校验 */
  options: Record<string, unknown>;
  /** 共享依赖（DB 句柄、HTTP 客户端…），与阶段工厂同一个袋子 */
  deps: RagStageDeps;
  /** 观测端口；缺省由宿主给 noop，包不得假设它一定存在 */
  telemetry?: RagTelemetry;
  /** 注入时钟（测试与评测需要可复现的耗时） */
  clock?: () => number;
  /** traceId 生成器；宿主应注入读日志上下文的实现，让日志与 trace 同源（P1-3） */
  createTraceId?: () => string;
}

/**
 * L0 工厂：一个包导出它（`createRagService` 命名导出或 `default`），宿主在启动期
 * 调用一次拿到整条管线的实例。
 *
 * 允许返回 Promise：包可能需要建连接池、加载模型。
 */
export type RagServiceFactory = (ctx: RagServiceFactoryContext) => RagService | Promise<RagService>;

/**
 * 阶段注册表。
 *
 * 契约（与 core 容器的 provider 注册保持一致）：
 *   1. 未注册的名字解析时 **fail-fast**，错误信息里列出已注册名字；
 *   2. 注册的键就是配置里 `provider` 字段的取值；
 *   3. 同名重复注册**以后注册者为准**（内置先注册，外部包可覆盖）。
 */
export interface RagStageRegistry {
  register<K extends RagStageKind>(kind: K, name: string, factory: RagStageFactoryMap[K]): void;
  /** 解析工厂；未注册则抛 `RagConfigError`（含已注册名单） */
  resolve<K extends RagStageKind>(kind: K, name: string): RagStageFactoryMap[K];
  has(kind: RagStageKind, name: string): boolean;
  /** 已注册的名字（按注册顺序）—— 用于错误信息与启动期自检输出 */
  names(kind: RagStageKind): string[];
}
