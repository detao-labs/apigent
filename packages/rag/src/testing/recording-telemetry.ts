// ═══════════════════════════════════════════════════════════════════
// Testing — RecordingTelemetry（可断言的观测替身）
// ═══════════════════════════════════════════════════════════════════
//
// 为什么不用 OTLP exporter 做测试断言：解析导出协议既脆又慢，而评测与单测要的
// 是「是否降级、各阶段命中数、阶段耗时」这三件事（docs/modules/rag-package.md §7.2）。
// 记成数组、直接断言，比解析协议简单一个量级。
//
// 时钟可注入（`now`）：断言 `durationMs` 时不必容忍 `>=0` 这种空断言。
// ═══════════════════════════════════════════════════════════════════

import type {
  DegradationReason,
  RagSpan,
  RagSpanAttributes,
  RagSpanName,
  RagMetricName,
  RagTelemetry,
} from "../contracts";

export interface RecordedSpan {
  name: RagSpanName;
  /** 结束时的属性快照（含 `setAttribute` 后写入的键） */
  attributes: RagSpanAttributes;
  status: "ok" | "error" | "unended";
  startedAt: number;
  durationMs: number;
}

export interface RecordedMetric {
  name: RagMetricName;
  value: number;
  attributes: RagSpanAttributes;
}

export interface RecordedDegradation {
  reason: DegradationReason;
  attributes: RagSpanAttributes;
}

export interface RecordingTelemetryOptions {
  /** 注入时钟；默认 `Date.now`。给假时钟即可断言精确耗时。 */
  now?: () => number;
}

export class RecordingTelemetry implements RagTelemetry {
  private readonly now: () => number;
  private readonly recordedSpans: RecordedSpan[] = [];
  private readonly recordedMetrics: RecordedMetric[] = [];
  private readonly recordedDegradations: RecordedDegradation[] = [];

  constructor(options: RecordingTelemetryOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  get spans(): readonly RecordedSpan[] {
    return this.recordedSpans;
  }

  get metrics(): readonly RecordedMetric[] {
    return this.recordedMetrics;
  }

  get degradations(): readonly RecordedDegradation[] {
    return this.recordedDegradations;
  }

  startSpan(name: RagSpanName, attributes?: RagSpanAttributes): RagSpan {
    const startedAt = this.now();
    const attrs: RagSpanAttributes = { ...attributes };
    const record: RecordedSpan = {
      name,
      attributes: attrs,
      status: "unended",
      startedAt,
      durationMs: 0,
    };
    this.recordedSpans.push(record);

    return {
      setAttribute: (key, value) => {
        attrs[key] = value;
      },
      end: (status = "ok") => {
        record.status = status;
        record.durationMs = this.now() - startedAt;
      },
    };
  }

  recordMetric(name: RagMetricName, value: number, attributes?: RagSpanAttributes): void {
    this.recordedMetrics.push({ name, value, attributes: { ...attributes } });
  }

  recordDegradation(reason: DegradationReason, attributes?: RagSpanAttributes): void {
    this.recordedDegradations.push({ reason, attributes: { ...attributes } });
  }

  // 断言辅助 —— 让测试写「有什么」而不是「数组第 3 项是什么」。

  /** 按记录顺序返回 span 名。 */
  spanNames(): RagSpanName[] {
    return this.recordedSpans.map((span) => span.name);
  }

  spansNamed(name: RagSpanName): RecordedSpan[] {
    return this.recordedSpans.filter((span) => span.name === name);
  }

  /** 降级原因（按发生顺序）。评测里用于断言「这条查询不该降级」。 */
  degradedReasons(): DegradationReason[] {
    return this.recordedDegradations.map((entry) => entry.reason);
  }

  /**
   * 拼出 `RagTraceSummary.stageMs`：子阶段名 → 累计耗时。
   *
   * 同名 span 累加（如多次 expand）；根 span（rag.query / rag.index）排除在外，
   * 因为它们的时间包含全部子阶段，混进来会让总耗时重复计算。
   */
  stageMs(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const span of this.recordedSpans) {
      if (span.name === "rag.query" || span.name === "rag.index") continue;
      result[span.name] = (result[span.name] ?? 0) + span.durationMs;
    }
    return result;
  }

  reset(): void {
    this.recordedSpans.length = 0;
    this.recordedMetrics.length = 0;
    this.recordedDegradations.length = 0;
  }
}
