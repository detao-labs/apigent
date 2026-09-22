// ═══════════════════════════════════════════════════════════════════
// Noop Telemetry — 默认实现
// ═══════════════════════════════════════════════════════════════════

import type {
  DegradationReason,
  RagSpan,
  RagSpanAttributes,
  RagSpanName,
  RagMetricName,
  RagTelemetry,
} from "../contracts";

/** 共享的空 span —— 无状态，可安全复用。 */
export const NOOP_SPAN: RagSpan = {
  setAttribute() {},
  end() {},
};

/**
 * 什么都不做。
 *
 * 它的存在让「没接观测」成为一个**显式选择**，而不是让管线到处判空 ——
 * 管线只认端口，默认注入 noop。
 */
export class NoopTelemetry implements RagTelemetry {
  startSpan(_name: RagSpanName, _attributes?: RagSpanAttributes): RagSpan {
    return NOOP_SPAN;
  }

  recordMetric(_name: RagMetricName, _value: number, _attributes?: RagSpanAttributes): void {}

  recordDegradation(_reason: DegradationReason, _attributes?: RagSpanAttributes): void {}
}

export const NOOP_TELEMETRY = new NoopTelemetry();
