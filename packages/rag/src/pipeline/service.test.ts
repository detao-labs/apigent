import { describe, it, expect } from "vitest";
import {
  RagConfigError,
  RagDependencyError,
  RagIngestError,
  type DenseIndex,
  type Embedder,
  type RagDocumentSource,
  type RagService,
  type RagSpan,
  type RagSpanAttributes,
  type RagSpanName,
  type RagMetricName,
  type DegradationReason,
  type RagTelemetry,
  type RagDocument,
} from "../contracts";
import {
  fixtureDocumentSource,
  FIXTURE_REPO_CHECKOUT,
  FIXTURE_REPO_LEGACY,
} from "../testing/fixture-document-source";
import { hashEmbedder } from "../testing/hash-embedder";
import { memoryIndex } from "../testing/memory-index";
import { RecordingTelemetry } from "../testing/recording-telemetry";
import { createStageRegistry } from "./registry";
import { createRagService } from "./service";
import type { RagPipelineConfig, RagProviderSelection } from "./types";

const REPO = FIXTURE_REPO_CHECKOUT;
const HEAD = "commit-head";
const SCOPE = { repositoryIds: [REPO], commitIds: [HEAD] };

interface Harness {
  service: RagService;
  telemetry: RecordingTelemetry;
  embedder: Embedder;
  denseIndex: DenseIndex;
}

function buildService(
  options: {
    documentSource?: RagDocumentSource;
    embedder?: Embedder;
    denseIndex?: DenseIndex;
    telemetry?: RagTelemetry;
    clock?: () => number;
    config?: Partial<RagPipelineConfig>;
    providers?: Partial<RagProviderSelection>;
  } = {},
): Harness {
  const registry = createStageRegistry();
  const documentSource = options.documentSource ?? fixtureDocumentSource();
  const embedder = options.embedder ?? hashEmbedder();
  const denseIndex = options.denseIndex ?? memoryIndex();
  const telemetry = new RecordingTelemetry();

  registry.register("documentSource", "fixture", () => documentSource);
  registry.register("embedder", "hash", () => embedder);
  registry.register("denseIndex", "memory", () => denseIndex);

  const service = createRagService({
    registry,
    providers: {
      documentSource: { name: "fixture" },
      embedder: { name: "hash" },
      denseIndex: { name: "memory" },
      ...options.providers,
    },
    config: options.config,
    telemetry: options.telemetry ?? telemetry,
    clock: options.clock,
    createTraceId: () => "trace-fixed",
  });

  return { service, telemetry, embedder, denseIndex };
}

/** 递增假时钟：每次读取推进固定步长，让耗时断言是精确值。 */
function tickingClock(stepMs: number): () => number {
  let current = 1_000;
  return () => {
    const value = current;
    current += stepMs;
    return value;
  };
}

describe("createRagService — 装配期自检", () => {
  it("fails at construction when a configured provider is not registered", () => {
    const registry = createStageRegistry();
    registry.register("documentSource", "fixture", () => fixtureDocumentSource());

    expect(() =>
      createRagService({
        registry,
        providers: {
          documentSource: { name: "fixture" },
          embedder: { name: "@acme/typo-package" },
          denseIndex: { name: "memory" },
        },
      }),
    ).toThrow(RagConfigError);
  });

  it("passes each provider its own options slice and the shared deps", () => {
    const registry = createStageRegistry();
    const seen: Array<{ options: Record<string, unknown>; deps: Record<string, unknown> }> = [];

    registry.register("documentSource", "fixture", (ctx) => {
      seen.push({ options: ctx.options, deps: ctx.deps });
      return fixtureDocumentSource();
    });
    registry.register("embedder", "hash", (ctx) => {
      seen.push({ options: ctx.options, deps: ctx.deps });
      return hashEmbedder();
    });
    registry.register("denseIndex", "memory", (ctx) => {
      seen.push({ options: ctx.options, deps: ctx.deps });
      return memoryIndex();
    });

    createRagService({
      registry,
      providers: {
        documentSource: { name: "fixture" },
        embedder: { name: "hash", options: { dim: 64 } },
        denseIndex: { name: "memory" },
      },
      deps: { sql: "fake-handle" },
    });

    expect(seen).toHaveLength(3);
    expect(seen[0].deps).toEqual({ sql: "fake-handle" });
    expect(seen[1].options).toEqual({ dim: 64 });
  });
});

describe("createRagService — 换掉注入即改行为（P2-6 验收）", () => {
  it("changes indexed content when the document source is swapped", async () => {
    const documents: RagDocument[] = [
      {
        id: "endpoint:GET:/ping",
        level: "endpoint",
        lang: "en",
        text: "Ping endpoint that reports liveness.",
        fields: { method: "GET", path: "/ping" },
      },
    ];
    const { service } = buildService({
      documentSource: fixtureDocumentSource({ documentsByRepository: { [REPO]: documents } }),
    });

    await service.index({ repositoryId: REPO, commitId: HEAD });
    const result = await service.retrieve({ query: "liveness ping", scope: SCOPE });

    expect(result.results.map((hit) => hit.path)).toEqual(["/ping"]);
  });

  it("changes results when the dense index is swapped, without touching the pipeline", async () => {
    const silentIndex: DenseIndex = {
      upsert: async () => {},
      search: async () => [],
      unlink: async () => 0,
      dropRepository: async () => 0,
      size: async () => 0,
    };
    const { service } = buildService({ denseIndex: silentIndex });

    await service.index({ repositoryId: REPO, commitId: HEAD });
    const result = await service.retrieve({ query: "退款", scope: SCOPE });

    expect(result.results).toEqual([]);
    expect(result.totalCandidates).toBe(0);
  });
});

describe("createRagService — 摄取", () => {
  it("writes the fixture corpus and reports counts with a deterministic duration", async () => {
    const { service, denseIndex } = buildService({ clock: tickingClock(5) });

    const report = await service.index({ repositoryId: REPO, commitId: HEAD });

    expect(report.chunksWritten).toBe(6);
    // content_hash 复用与对账式删除是 P4-6；在那之前这两个计数如实为 0
    expect(report.chunksSkipped).toBe(0);
    expect(report.chunksDeleted).toBe(0);
    expect(report.tokens).toBeGreaterThan(0);
    expect(report.durationMs).toBe(15);
    await expect(denseIndex.size()).resolves.toBe(6);
  });

  it("leaves chunks unlinked when no commitId is given (fail-closed)", async () => {
    const { service } = buildService();

    await service.index({ repositoryId: REPO });
    const narrowed = await service.retrieve({ query: "退款", scope: SCOPE });
    const unnarrowed = await service.retrieve({
      query: "退款",
      scope: { repositoryIds: [REPO] },
    });

    expect(narrowed.results).toEqual([]);
    expect(unnarrowed.results.length).toBeGreaterThan(0);
  });

  it("wraps a document-source failure into RagIngestError", async () => {
    const { service } = buildService({
      documentSource: fixtureDocumentSource({ error: new Error("source down") }),
    });

    await expect(service.index({ repositoryId: REPO, commitId: HEAD })).rejects.toBeInstanceOf(
      RagIngestError,
    );
    await expect(service.index({ repositoryId: REPO, commitId: HEAD })).rejects.toThrow(
      /source down/,
    );
  });

  it("fail-fasts when the embedder returns a different number of vectors than documents", async () => {
    const brokenEmbedder: Embedder = {
      identity: { model: "broken", dim: 4 },
      embed: async (texts) => ({ vectors: texts.slice(0, 1).map(() => [1, 0, 0, 0]) }),
    };
    const { service } = buildService({ embedder: brokenEmbedder });

    await expect(service.index({ repositoryId: REPO, commitId: HEAD })).rejects.toThrow(
      RagIngestError,
    );
  });
});

describe("createRagService — 检索", () => {
  it("recalls the Chinese keyword, fills the trace and records metrics", async () => {
    const { service, telemetry } = buildService({ clock: tickingClock(3) });
    await service.index({ repositoryId: REPO, commitId: HEAD });
    telemetry.reset();

    const result = await service.retrieve({ query: "发货", scope: SCOPE });

    expect(result.results[0].path).toBe("/shipments/{id}");
    expect(result.strategy).toBe("dense");
    expect(result.degraded).toBeUndefined();
    expect(result.trace.traceId).toBe("trace-fixed");
    expect(result.trace.llmCalls).toBe(0);
    expect(result.trace.stageMs["retrieve.dense"]).toBeGreaterThan(0);
    expect(telemetry.spanNames()).toContain("rag.query");
    expect(telemetry.spanNames()).toContain("retrieve.dense");
    expect(telemetry.metrics.map((metric) => metric.name)).toEqual([
      "rag.query.latency",
      "rag.recall.empty_rate",
      "rag.fallback_rate",
    ]);
  });

  it("maps cosine into the documented 0-1 score range", async () => {
    const { service } = buildService();
    await service.index({ repositoryId: REPO, commitId: HEAD });

    const result = await service.retrieve({ query: "refund order", scope: SCOPE });

    for (const hit of result.results) {
      expect(hit.score).toBeGreaterThanOrEqual(0);
      expect(hit.score).toBeLessThanOrEqual(1);
      expect(hit.coarseScore).toBeGreaterThanOrEqual(-1);
      expect(hit.coarseScore).toBeLessThanOrEqual(1);
    }
  });

  it("returns an empty result for an empty scope without calling the embedder", async () => {
    let embedCalls = 0;
    const countingEmbedder: Embedder = {
      identity: { model: "counting", dim: 8 },
      embed: async (texts) => {
        embedCalls += 1;
        return { vectors: texts.map(() => new Array<number>(8).fill(0)) };
      },
    };
    const { service, telemetry } = buildService({ embedder: countingEmbedder });

    const result = await service.retrieve({ query: "退款", scope: { repositoryIds: [] } });

    expect(result.results).toEqual([]);
    expect(result.degraded).toBeUndefined();
    expect(embedCalls).toBe(0);
    expect(telemetry.spanNames()).not.toContain("retrieve.dense");
  });

  it("degrades to an empty result when the embedder fails", async () => {
    const failingEmbedder: Embedder = {
      identity: { model: "failing", dim: 8 },
      embed: async () => {
        throw new Error("embedding service unreachable");
      },
    };
    const { service, telemetry } = buildService({ embedder: failingEmbedder });

    const result = await service.retrieve({ query: "退款", scope: SCOPE });

    expect(result.results).toEqual([]);
    expect(result.strategy).toBe("fallback");
    expect(result.degraded?.reason).toBe("embedding_unavailable");
    expect(result.degraded?.detail).toContain("unreachable");
    expect(telemetry.degradedReasons()).toEqual(["embedding_unavailable"]);
    expect(telemetry.spansNamed("retrieve.dense")[0].status).toBe("error");
  });

  it("throws RagDependencyError when the index fails（Phase 2 只有稠密一路，无处可退）", async () => {
    const failingIndex: DenseIndex = {
      upsert: async () => {},
      search: async () => {
        throw new Error("vector store down");
      },
      unlink: async () => 0,
      dropRepository: async () => 0,
      size: async () => 0,
    };
    const { service } = buildService({ denseIndex: failingIndex });

    await expect(service.retrieve({ query: "退款", scope: SCOPE })).rejects.toBeInstanceOf(
      RagDependencyError,
    );
  });

  it("keeps the query text out of span attributes when recording is disabled", async () => {
    const { service, telemetry } = buildService({ config: { recordQueryText: false } });

    await service.retrieve({ query: "退款", scope: SCOPE });

    expect(telemetry.spansNamed("rag.query")[0].attributes.query).toBeUndefined();

    const enabled = buildService();
    await enabled.service.retrieve({ query: "退款", scope: SCOPE });
    expect(enabled.telemetry.spansNamed("rag.query")[0].attributes.query).toBe("退款");
  });

  it("limits results by topK while keeping the coarse candidate count", async () => {
    const { service } = buildService({ config: { topK: 2, coarseRankTopK: 30 } });
    await service.index({ repositoryId: REPO, commitId: HEAD });

    const result = await service.retrieve({ query: "订单 接口", scope: SCOPE });

    expect(result.results).toHaveLength(2);
    expect(result.totalCandidates).toBeGreaterThanOrEqual(2);
  });

  it("survives a telemetry implementation that throws on every call (fail-open)", async () => {
    const hostile: RagTelemetry = {
      startSpan(): RagSpan {
        throw new Error("telemetry down");
      },
      recordMetric(_name: RagMetricName, _value: number, _attributes?: RagSpanAttributes): void {
        throw new Error("telemetry down");
      },
      recordDegradation(_reason: DegradationReason, _attributes?: RagSpanAttributes): void {
        throw new Error("telemetry down");
      },
    };
    const { service } = buildService({ telemetry: hostile });
    await service.index({ repositoryId: REPO, commitId: HEAD });

    const result = await service.retrieve({ query: "退款", scope: SCOPE });

    expect(result.results.length).toBeGreaterThan(0);
  });

  it("does not leak another organization's data through scope", async () => {
    const { service } = buildService();
    await service.index({ repositoryId: REPO, commitId: HEAD });
    await service.index({ repositoryId: FIXTURE_REPO_LEGACY, commitId: HEAD });

    const result = await service.retrieve({
      query: "退款",
      scope: { repositoryIds: [REPO], commitIds: [HEAD] },
    });

    expect(result.results.every((hit) => hit.repositoryId === REPO)).toBe(true);
  });
});

describe("createRagService — 健康检查", () => {
  it("reports degraded on an empty index and ok once content exists", async () => {
    const { service } = buildService();

    await expect(service.health()).resolves.toMatchObject({ status: "degraded" });

    await service.index({ repositoryId: REPO, commitId: HEAD });

    const health = await service.health();
    expect(health.status).toBe("ok");
    expect(health.details).toMatchObject({ chunks: 6, embedder: "test:hash", embeddingDim: 1024 });
  });

  it("reports unavailable instead of throwing when the index is unreachable", async () => {
    const failingIndex: DenseIndex = {
      upsert: async () => {},
      search: async () => [],
      unlink: async () => 0,
      dropRepository: async () => 0,
      size: async () => {
        throw new Error("connection refused");
      },
    };
    const { service } = buildService({ denseIndex: failingIndex });

    const health = await service.health();

    expect(health.status).toBe("unavailable");
    expect(health.details).toMatchObject({ error: "connection refused" });
  });
});

describe("createRagService — span 名", () => {
  it("only emits span names declared in the telemetry contract", async () => {
    const allowed = new Set<RagSpanName>([
      "rag.query",
      "rag.index",
      "index.embed",
      "retrieve.dense",
      "rerank",
      "expand",
    ]);
    const { service, telemetry } = buildService();

    await service.index({ repositoryId: REPO, commitId: HEAD });
    await service.retrieve({ query: "退款", scope: SCOPE });

    expect(telemetry.spanNames().every((name) => allowed.has(name))).toBe(true);
  });
});
