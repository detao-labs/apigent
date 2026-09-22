import { describe, it, expect } from "vitest";
import type {
  DegradationReason,
  RagSpan,
  RagSpanAttributes,
  RagSpanName,
  RagMetricName,
  RagTelemetry,
} from "../contracts";
import { failOpenTelemetry } from "./fail-open";
import { NOOP_SPAN } from "./noop";

/** 每个方法都抛错的 telemetry —— 模拟写得不好的第三方实现。 */
function throwingTelemetry(error: Error): RagTelemetry {
  return {
    startSpan(): RagSpan {
      throw error;
    },
    recordMetric(): void {
      throw error;
    },
    recordDegradation(): void {
      throw error;
    },
  };
}

describe("failOpenTelemetry", () => {
  it("absorbs a telemetry whose startSpan throws", () => {
    const telemetry = failOpenTelemetry(throwingTelemetry(new Error("boom")));
    expect(() => {
      const span = telemetry.startSpan("rag.query");
      span.setAttribute("topK", 10);
      span.end();
    }).not.toThrow();
  });

  it("absorbs throwing recordMetric / recordDegradation", () => {
    const telemetry = failOpenTelemetry(throwingTelemetry(new Error("boom")));
    expect(() => {
      telemetry.recordMetric("rag.query.latency", 1);
      telemetry.recordDegradation("index_empty");
    }).not.toThrow();
  });

  it("returns a usable noop span when the inner telemetry fails", () => {
    const telemetry = failOpenTelemetry(throwingTelemetry(new Error("boom")));
    expect(telemetry.startSpan("rag.query")).toBe(NOOP_SPAN);
  });

  it("absorbs a span whose setAttribute / end throw", () => {
    const telemetry = failOpenTelemetry({
      startSpan(): RagSpan {
        return {
          setAttribute() {
            throw new Error("attr boom");
          },
          end() {
            throw new Error("end boom");
          },
        };
      },
      recordMetric() {},
      recordDegradation() {},
    });

    expect(() => {
      const span = telemetry.startSpan("rag.query");
      span.setAttribute("topK", 1);
      span.end("error");
    }).not.toThrow();
  });

  it("passes calls through when the inner telemetry works", () => {
    const seen: string[] = [];
    const telemetry = failOpenTelemetry({
      startSpan(name: RagSpanName, attributes?: RagSpanAttributes): RagSpan {
        seen.push(`start:${name}:${attributes?.topK ?? "-"}`);
        return {
          setAttribute(key, value) {
            seen.push(`attr:${key}=${String(value)}`);
          },
          end(status) {
            seen.push(`end:${status ?? "ok"}`);
          },
        };
      },
      recordMetric(name: RagMetricName, value: number) {
        seen.push(`metric:${name}=${value}`);
      },
      recordDegradation(reason: DegradationReason) {
        seen.push(`degraded:${reason}`);
      },
    });

    const span = telemetry.startSpan("rag.query", { topK: 5 });
    span.setAttribute("empty", true);
    span.end();
    telemetry.recordMetric("rag.fallback_rate", 0.1);
    telemetry.recordDegradation("rerank_failed");

    expect(seen).toEqual([
      "start:rag.query:5",
      "attr:empty=true",
      "end:ok",
      "metric:rag.fallback_rate=0.1",
      "degraded:rerank_failed",
    ]);
  });
});
