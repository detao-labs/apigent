import { describe, it, expect } from "vitest";
import type { RagLoggerPort } from "../contracts";
import { LoggerTelemetry } from "./logger";

interface LogLine {
  level: "debug" | "info" | "warn" | "error";
  event: string;
  context: Record<string, unknown>;
}

class RecordingLogger implements RagLoggerPort {
  readonly lines: LogLine[] = [];
  private push(level: LogLine["level"], event: string, context?: Record<string, unknown>) {
    this.lines.push({ level, event, context: context ?? {} });
  }
  info(event: string, context?: Record<string, unknown>) {
    this.push("info", event, context);
  }
  warn(event: string, context?: Record<string, unknown>) {
    this.push("warn", event, context);
  }
  debug(event: string, context?: Record<string, unknown>) {
    this.push("debug", event, context);
  }
  error(event: string, _error: unknown, context?: Record<string, unknown>) {
    this.push("error", event, context);
  }
}

describe("LoggerTelemetry", () => {
  it("emits `rag.query` at info when the root span ends", () => {
    const logger = new RecordingLogger();
    const span = new LoggerTelemetry(logger).startSpan("rag.query", { repositoryCount: 3 });
    span.end();

    expect(logger.lines).toHaveLength(1);
    const line = logger.lines[0];
    expect(line.event).toBe("rag.query");
    expect(line.level).toBe("info");
    expect(line.context).toMatchObject({ repositoryCount: 3, status: "ok" });
    expect(typeof line.context.durationMs).toBe("number");
  });

  it("emits `rag.stage` carrying the stage name for child spans", () => {
    const logger = new RecordingLogger();
    const span = new LoggerTelemetry(logger).startSpan("retrieve.dense", { resultCount: 50 });
    span.end();

    expect(logger.lines[0]).toMatchObject({
      event: "rag.stage",
      level: "info",
      context: { stage: "retrieve.dense", resultCount: 50 },
    });
  });

  it("honours stageLevel so stage noise can be demoted to debug", () => {
    const logger = new RecordingLogger();
    const telemetry = new LoggerTelemetry(logger, { stageLevel: "debug" });
    telemetry.startSpan("fusion").end();
    telemetry.startSpan("rag.query").end();

    expect(logger.lines.map((l) => l.level)).toEqual(["debug", "info"]);
  });

  it("includes attributes set after the span started", () => {
    const logger = new RecordingLogger();
    const span = new LoggerTelemetry(logger).startSpan("rerank");
    span.setAttribute("model", "qwen3-rerank");
    span.setAttribute("fallback", true);
    span.end("error");

    expect(logger.lines[0].context).toMatchObject({
      model: "qwen3-rerank",
      fallback: true,
      status: "error",
    });
  });

  it("emits `rag.degraded` at warn so it is greppable", () => {
    const logger = new RecordingLogger();
    new LoggerTelemetry(logger).recordDegradation("embedding_unavailable", {
      stage: "retrieve.dense",
    });

    expect(logger.lines[0]).toMatchObject({
      level: "warn",
      event: "rag.degraded",
      context: { reason: "embedding_unavailable", stage: "retrieve.dense" },
    });
  });

  it("emits metrics under the metric name at debug", () => {
    const logger = new RecordingLogger();
    new LoggerTelemetry(logger).recordMetric("rag.recall.empty_rate", 0.03);

    expect(logger.lines[0]).toMatchObject({
      level: "debug",
      event: "rag.recall.empty_rate",
      context: { metric: "rag.recall.empty_rate", value: 0.03 },
    });
  });

  it("is fail-open: a throwing logger never propagates", () => {
    const boom = new Error("logger exploded");
    const throwing: RagLoggerPort = {
      info: () => {
        throw boom;
      },
      warn: () => {
        throw boom;
      },
      debug: () => {
        throw boom;
      },
      error: () => {
        throw boom;
      },
    };
    const telemetry = new LoggerTelemetry(throwing);

    expect(() => {
      const span = telemetry.startSpan("rag.query");
      span.setAttribute("topK", 10);
      span.end();
      telemetry.recordMetric("rag.query.latency", 12);
      telemetry.recordDegradation("index_empty");
    }).not.toThrow();
  });
});
