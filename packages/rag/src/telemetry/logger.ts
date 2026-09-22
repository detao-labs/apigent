// ═══════════════════════════════════════════════════════════════════
// Logger Telemetry — 把 span / 指标 / 降级落到结构化日志
// ═══════════════════════════════════════════════════════════════════
//
// 这是 `observability.provider: none` 时的实现，也是**默认的生产可用形态**：
// 只依赖一个日志端口，不需要 OTel 依赖。于是 RAG 上线第一天就可观测
// （能 grep、能算空召回率与降级率），等 OTel 阶段落地再加一个 adapter 即可，
// 检索代码一行不动。
//
// 事件名（与 docs/modules/rag-observability.md 对齐）：
//   - `rag.query`    根 span 结束时 —— 查询级字段
//   - `rag.stage`    子 span 结束时 —— 阶段名 + 命中数 + 耗时
//   - `rag.degraded` 降级发生时 —— reason 可 grep
//   - 指标走事件名 = 指标名（如 `rag.recall.empty_rate`）
//
// 日志端口由外部注入，而不是直接 import `packages/server/src/logging`：
// 依赖方向不允许 rag → server（见 docs/modules/rag-package.md §2.3）；
// server 侧用一个几行的适配器把 `logInfo/logWarn/...` 接上即可。
// ═══════════════════════════════════════════════════════════════════

import type {
  DegradationReason,
  RagLoggerPort,
  RagSpan,
  RagSpanAttributes,
  RagSpanName,
  RagMetricName,
  RagTelemetry,
} from "../contracts";

export interface LoggerTelemetryOptions {
  /**
   * `rag.stage` 事件的日志级别。
   *
   * 默认 `info`（按 rag-observability.md 的示例）。一次检索会产出 8 个左右的
   * 阶段事件，量大时可降到 `debug`，靠 `observability.logLevel` 过滤掉。
   */
  stageLevel?: "debug" | "info";
}

export class LoggerTelemetry implements RagTelemetry {
  private readonly stageLevel: "debug" | "info";

  constructor(
    private readonly logger: RagLoggerPort,
    options: LoggerTelemetryOptions = {},
  ) {
    this.stageLevel = options.stageLevel ?? "info";
  }

  startSpan(name: RagSpanName, attributes?: RagSpanAttributes): RagSpan {
    const startedAt = Date.now();
    const attrs: RagSpanAttributes = { ...attributes };

    return {
      setAttribute: (key, value) => {
        attrs[key] = value;
      },
      end: (status = "ok") => {
        const durationMs = Date.now() - startedAt;
        if (name === "rag.query") {
          this.emit("info", "rag.query", { ...attrs, durationMs, status });
        } else {
          this.emit(this.stageLevel, "rag.stage", {
            stage: name,
            ...attrs,
            durationMs,
            status,
          });
        }
      },
    };
  }

  recordMetric(name: RagMetricName, value: number, attributes?: RagSpanAttributes): void {
    this.emit("debug", name, { metric: name, value, ...attributes });
  }

  recordDegradation(reason: DegradationReason, attributes?: RagSpanAttributes): void {
    this.emit("warn", "rag.degraded", { reason, ...attributes });
  }

  /** 观测不得影响主链路：日志端口抛错一律吞掉。 */
  private emit(
    level: "debug" | "info" | "warn" | "error",
    event: string,
    context: Record<string, unknown>,
  ): void {
    try {
      this.logger[level](event, context);
    } catch {
      // fail-open：观测失败不冒泡
    }
  }
}
