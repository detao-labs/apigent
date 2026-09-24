import { describe, it, expect } from "vitest";
import { failOpenTelemetry } from "../telemetry";
import { RecordingTelemetry } from "./recording-telemetry";

/** 假时钟：每次读取推进固定步长，让耗时断言是精确值而非「>= 0」。 */
function tickingClock(stepMs: number): () => number {
  let current = 1_000;
  return () => {
    const value = current;
    current += stepMs;
    return value;
  };
}

describe("RecordingTelemetry", () => {
  it("records span name, attributes and duration from the injected clock", () => {
    const telemetry = new RecordingTelemetry({ now: tickingClock(7) });

    const span = telemetry.startSpan("retrieve.dense", { repositoryCount: 2 });
    span.setAttribute("resultCount", 12);
    span.end();

    expect(telemetry.spanNames()).toEqual(["retrieve.dense"]);
    const [recorded] = telemetry.spans;
    expect(recorded.status).toBe("ok");
    expect(recorded.durationMs).toBe(7);
    expect(recorded.attributes).toMatchObject({ repositoryCount: 2, resultCount: 12 });
  });

  it("keeps the span marked as unended until end() is called", () => {
    const telemetry = new RecordingTelemetry();

    telemetry.startSpan("fusion");

    expect(telemetry.spans[0].status).toBe("unended");
    expect(telemetry.spans[0].durationMs).toBe(0);
  });

  it("records an error status when the stage fails", () => {
    const telemetry = new RecordingTelemetry();

    telemetry.startSpan("rerank").end("error");

    expect(telemetry.spans[0].status).toBe("error");
  });

  it("records metrics and degradations for assertions", () => {
    const telemetry = new RecordingTelemetry();

    telemetry.recordMetric("rag.query.latency", 42, { mode: "fast" });
    telemetry.recordDegradation("rerank_failed", { model: "qwen3-rerank" });

    expect(telemetry.metrics).toEqual([
      { name: "rag.query.latency", value: 42, attributes: { mode: "fast" } },
    ]);
    expect(telemetry.degradedReasons()).toEqual(["rerank_failed"]);
    expect(telemetry.degradations[0].attributes).toEqual({ model: "qwen3-rerank" });
  });

  it("aggregates stageMs, summing repeats and excluding the root spans", () => {
    const telemetry = new RecordingTelemetry({ now: tickingClock(5) });

    telemetry.startSpan("rag.query").end();
    telemetry.startSpan("retrieve.dense").end();
    telemetry.startSpan("expand").end();
    telemetry.startSpan("expand").end();

    expect(telemetry.stageMs()).toEqual({ "retrieve.dense": 5, expand: 10 });
  });

  it("copies attributes so a later mutation of the caller's object is invisible", () => {
    const telemetry = new RecordingTelemetry();
    const attributes = { mode: "fast" };

    telemetry.recordMetric("rag.query.latency", 1, attributes);
    attributes.mode = "deep";

    expect(telemetry.metrics[0].attributes).toEqual({ mode: "fast" });
  });

  it("reset() clears everything between queries", () => {
    const telemetry = new RecordingTelemetry();
    telemetry.startSpan("rag.query").end();
    telemetry.recordMetric("rag.query.latency", 1);
    telemetry.recordDegradation("index_empty");

    telemetry.reset();

    expect(telemetry.spans).toEqual([]);
    expect(telemetry.metrics).toEqual([]);
    expect(telemetry.degradations).toEqual([]);
  });

  it("still records when wrapped by failOpenTelemetry (the createRagService wiring)", () => {
    const inner = new RecordingTelemetry();
    const telemetry = failOpenTelemetry(inner);

    const span = telemetry.startSpan("rag.query", { mode: "fast" });
    span.end();
    telemetry.recordDegradation("index_empty");

    expect(inner.spanNames()).toEqual(["rag.query"]);
    expect(inner.degradedReasons()).toEqual(["index_empty"]);
  });
});
