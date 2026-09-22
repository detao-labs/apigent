// ═══════════════════════════════════════════════════════════════════
// Fail-open Telemetry — 包一层，保证观测永不冒泡
// ═══════════════════════════════════════════════════════════════════
//
// 端口契约要求实现 fail-open，但不能指望每个第三方实现都做到。`createRagService()`
// 会用这个装饰器包住注入的 telemetry，于是「观测挂了不影响检索」由**一处**保证，
// 而不是散落在每个阶段里判空、每个后端里 try/catch。
// ═══════════════════════════════════════════════════════════════════

import type {
  DegradationReason,
  RagSpan,
  RagSpanAttributes,
  RagSpanName,
  RagMetricName,
  RagTelemetry,
} from "../contracts";
import { NOOP_SPAN } from "./noop";

/** 把任意 telemetry 包成 fail-open 版本。 */
export function failOpenTelemetry(inner: RagTelemetry): RagTelemetry {
  return {
    startSpan(name: RagSpanName, attributes?: RagSpanAttributes): RagSpan {
      let span: RagSpan;
      try {
        span = inner.startSpan(name, attributes);
      } catch {
        return NOOP_SPAN;
      }
      return {
        setAttribute(key, value) {
          try {
            span.setAttribute(key, value);
          } catch {
            // 吞掉
          }
        },
        end(status) {
          try {
            span.end(status);
          } catch {
            // 吞掉
          }
        },
      };
    },

    recordMetric(name: RagMetricName, value: number, attributes?: RagSpanAttributes): void {
      try {
        inner.recordMetric(name, value, attributes);
      } catch {
        // 吞掉
      }
    },

    recordDegradation(reason: DegradationReason, attributes?: RagSpanAttributes): void {
      try {
        inner.recordDegradation(reason, attributes);
      } catch {
        // 吞掉
      }
    },
  };
}
