// ═══════════════════════════════════════════════════════════════════
// RAG Contracts — Telemetry 端口
// ═══════════════════════════════════════════════════════════════════
//
// **端口化是刻意的**：RAG 源码里不允许出现 `import ... from "@opentelemetry/*"`。
// 三条理由（详见 docs/modules/rag-package.md §7.1）：
//   1. 可观测性基建尚未落地（`observability.provider` 有 4 个枚举、0 个实现）。
//      直连 OTel 会把「可观测平台选型」变成 RAG 的发布阻塞项。
//   2. 评测需要断言「是否降级、各阶段命中数」，RecordingTelemetry 比解析 OTLP 简单。
//   3. fail-open 的边界清晰。
//
// 端口类型放 contracts 而非实现模块：它是 **RagService 与其宿主之间的契约**
// （宿主注入 telemetry），且零重依赖，客户端可安全引用。
// ═══════════════════════════════════════════════════════════════════

import type { DegradationReason } from "./types";

/**
 * span 名称。根 span 带 `rag.` 前缀，子 span 沿用短名（嵌套靠 parent 关系，
 * 不靠名字），与 docs/modules/rag-observability.md 的命名对齐。
 */
export const RAG_SPAN_NAMES = [
  /** 检索根 span */
  "rag.query",
  /** 摄取根 span */
  "rag.index",
  // ── 检索子阶段 ──
  "rewrite",
  "retrieve.dense",
  "retrieve.sparse",
  "retrieve.kg",
  "fusion",
  "rerank",
  "expand",
  // ── 摄取子阶段 ──
  "index.tokenize",
  "index.embed",
] as const;
export type RagSpanName = (typeof RAG_SPAN_NAMES)[number];

/** 指标名。与 docs/modules/rag-observability.md §指标 对齐。 */
export const RAG_METRIC_NAMES = [
  "rag.query.latency",
  "rag.stage.latency",
  "rag.recall.empty_rate",
  "rag.fallback_rate",
  "rag.rewrite.cache_hit",
  "rag.cost_per_query",
] as const;
export type RagMetricName = (typeof RAG_METRIC_NAMES)[number];

export type RagAttributeValue = string | number | boolean;

/**
 * span / 事件的属性。
 *
 * 下面是**约定字段**（编辑器可补全）；同时允许各阶段追加自己的键，后端必须容忍
 * 未知键。注意**不要写仓库 id / 组织 id 本身** —— 只写规模（`repositoryCount`），
 * 避免把租户信息送进第三方 trace 平台。
 */
export interface RagSpanAttributes {
  /** scope 收窄后的仓库数量（不是仓库 id 列表） */
  repositoryCount?: number;
  /** 检索模式 */
  mode?: string;
  /** 请求的返回数量 */
  topK?: number;
  /** 该阶段命中数量 */
  resultCount?: number;
  /** 是否空召回 */
  empty?: boolean;
  /** 是否走了降级路径 */
  fallback?: boolean;
  /** 该阶段用到的模型（embedding / rerank / LLM） */
  model?: string;
  /** 分词器版本（P0-3 定案要求进索引元数据，也进 trace） */
  tokenizerVersion?: string;
  /**
   * 查询原文。
   *
   * **由调用方决定要不要写**（对应 `rag.telemetry.recordQueryText`）—— 脱敏在
   * 写入侧收口，后端不承担脱敏责任，也就不需要每个后端各实现一遍策略。
   * 同理，**chunk 正文永不写入**：任何后端都不该拿到业务文档内容。
   */
  query?: string;
  /** 子阶段名（仅 `rag.stage` 事件用） */
  stage?: string;
  /** 耗时（ms） */
  durationMs?: number;
  [key: string]: RagAttributeValue | undefined;
}

export interface RagSpan {
  setAttribute(key: string, value: RagAttributeValue): void;
  end(status?: "ok" | "error"): void;
}

/**
 * RAG 的可观测端口。
 *
 * **实现必须 fail-open**：观测挂了不能影响检索。`createRagService()` 会用
 * `failOpenTelemetry()` 包一层，保证第三方实现抛错也不会冒泡到调用方。
 */
export interface RagTelemetry {
  startSpan(name: RagSpanName, attributes?: RagSpanAttributes): RagSpan;
  recordMetric(name: RagMetricName, value: number, attributes?: RagSpanAttributes): void;
  /**
   * 记录一次降级。
   *
   * 降级做成一等事件（而不是普通属性），是因为它必须**可 grep**：
   * 排查「为什么这次检索结果很差」时，`rag.degraded` 是最快的入口。
   */
  recordDegradation(reason: DegradationReason, attributes?: RagSpanAttributes): void;
}

/**
 * 日志端口 —— `LoggerTelemetry` 的依赖。
 *
 * 与 `packages/server/src/logging` 的 `logInfo/logWarn/logDebug/logError`
 * 签名一致，因此 server 侧只需写一个几行的适配器即可接上（rag 不能反向依赖
 * server，见 docs/modules/rag-package.md §2.3）。
 */
export interface RagLoggerPort {
  info(event: string, context?: Record<string, unknown>): void;
  warn(event: string, context?: Record<string, unknown>): void;
  debug(event: string, context?: Record<string, unknown>): void;
  error(event: string, error: unknown, context?: Record<string, unknown>): void;
}
