// ═══════════════════════════════════════════════════════════════════
// Phase 2 端到端 —— 一条命令跑通退出条件
// ═══════════════════════════════════════════════════════════════════
//
// 退出条件（docs/modules/rag-package-tasks.md）：
//   「写入若干 chunk → 中文查询 → 返回排序结果 + trace + 降级标记」，
//   全程零外部依赖（无 DB、无网络、无 API key）。
//
// 与 `service.test.ts` 的分工：那边按行为逐条钉契约，这里只验证**整链路**
// 能跑通、四件产物都在，并用一张迷你黄金集看排序质量。
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import type { Embedder, RagService } from "../contracts";
import {
  fixtureDocumentSource,
  FIXTURE_REPO_BILLING,
  FIXTURE_REPO_CHECKOUT,
} from "../testing/fixture-document-source";
import { hashEmbedder } from "../testing/hash-embedder";
import { memoryIndex } from "../testing/memory-index";
import { RecordingTelemetry } from "../testing/recording-telemetry";
import { createStageRegistry } from "./registry";
import { createRagService } from "./service";

const REPO = FIXTURE_REPO_CHECKOUT;
const HEAD = "commit-head";
const SCOPE = { repositoryIds: [REPO], commitIds: [HEAD] };

function offlineService(embedder: Embedder = hashEmbedder()): {
  service: RagService;
  telemetry: RecordingTelemetry;
} {
  const registry = createStageRegistry();
  registry.register("documentSource", "fixture", () => fixtureDocumentSource());
  registry.register("embedder", "hash", () => embedder);
  registry.register("denseIndex", "memory", () => memoryIndex());

  const telemetry = new RecordingTelemetry();
  const service = createRagService({
    registry,
    providers: {
      documentSource: { name: "fixture" },
      embedder: { name: "hash" },
      denseIndex: { name: "memory" },
    },
    telemetry,
    createTraceId: () => "e2e-trace",
  });
  return { service, telemetry };
}

describe("Phase 2 端到端（零外部依赖）", () => {
  it("写入 → 中文查询 → 排序结果 + trace（无降级）", async () => {
    const { service, telemetry } = offlineService();

    const report = await service.index({ repositoryId: REPO, commitId: HEAD });
    const result = await service.retrieve({ query: "发货", scope: SCOPE });

    // 1. 写入了若干 chunk
    expect(report.chunksWritten).toBe(6);
    // 2. 中文查询返回排序结果
    expect(result.results[0].path).toBe("/shipments/{id}");
    expect(result.results[0].score).toBeGreaterThan(result.results.at(-1)!.score);
    // 3. trace 完整
    expect(result.trace).toMatchObject({ traceId: "e2e-trace", llmCalls: 0 });
    expect(result.trace.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Object.keys(result.trace.stageMs)).toContain("retrieve.dense");
    // 4. 这条链路没有降级
    expect(result.degraded).toBeUndefined();
    expect(telemetry.degradedReasons()).toEqual([]);
  });

  it("向量化不可用时返回降级标记，而不是 500", async () => {
    const failing: Embedder = {
      identity: { model: "failing", dim: 1024 },
      embed: async () => {
        throw new Error("dashscope unreachable");
      },
    };
    const { service } = offlineService(failing);

    const result = await service.retrieve({ query: "发货", scope: SCOPE });

    expect(result.results).toEqual([]);
    expect(result.strategy).toBe("fallback");
    expect(result.degraded).toMatchObject({ reason: "embedding_unavailable" });
    // 降级也是「有结果可返回」：trace 仍然完整，调用方能解释为什么是空的
    expect(result.trace.traceId).toBe("e2e-trace");
  });

  it("迷你黄金集：三条中文查询的 top1 都是期望接口", async () => {
    const { service } = offlineService();
    await service.index({ repositoryId: REPO, commitId: HEAD });

    const golden: Array<{ query: string; expected: string }> = [
      { query: "发货", expected: "endpoint:GET:/shipments/{id}" },
      { query: "退款", expected: "endpoint:POST:/orders/{id}/refund" },
      { query: "优惠券核销", expected: "endpoint:POST:/coupons/{id}/redeem" },
    ];

    for (const { query, expected } of golden) {
      const result = await service.retrieve({ query, scope: SCOPE });
      const top3 = result.results.slice(0, 3).map((hit) => hit.chunkKey);
      expect(result.results[0]?.chunkKey, `query="${query}" 的 top3 是 ${JSON.stringify(top3)}`).toBe(
        expected,
      );
    }
  });

  it("英文查询命中同一接口的英文 chunk", async () => {
    const { service } = offlineService();
    await service.index({ repositoryId: REPO, commitId: HEAD });

    const result = await service.retrieve({ query: "refund order", scope: SCOPE });

    expect(result.results.map((hit) => hit.chunkKey)).toContain(
      "endpoint:POST:/orders/{id}/refund:en",
    );
  });

  it("scope 指向未索引的仓库时是空召回，不是降级", async () => {
    const { service, telemetry } = offlineService();
    await service.index({ repositoryId: REPO, commitId: HEAD });

    const result = await service.retrieve({
      query: "账单",
      scope: { repositoryIds: [FIXTURE_REPO_BILLING], commitIds: [HEAD] },
    });

    expect(result.results).toEqual([]);
    expect(result.totalCandidates).toBe(0);
    expect(result.degraded).toBeUndefined();
    expect(telemetry.metrics).toContainEqual(
      expect.objectContaining({ name: "rag.recall.empty_rate", value: 1 }),
    );
    expect(telemetry.metrics).toContainEqual(
      expect.objectContaining({ name: "rag.fallback_rate", value: 0 }),
    );
  });

  it("重复索引同一 commit 是幂等的（chunk_key 内容寻址）", async () => {
    const { service } = offlineService();

    await service.index({ repositoryId: REPO, commitId: HEAD });
    await service.index({ repositoryId: REPO, commitId: HEAD });

    const health = await service.health();
    expect(health.details).toMatchObject({ chunks: 6 });
  });

  it("任何 span 属性都不含 chunk 正文（脱敏不变量）", async () => {
    const { service, telemetry } = offlineService();
    await service.index({ repositoryId: REPO, commitId: HEAD });
    await service.retrieve({ query: "退款", scope: SCOPE });

    const attributeValues = telemetry.spans.flatMap((span) =>
      Object.values(span.attributes).map((value) => JSON.stringify(value)),
    );

    // fixture 里退款接口的正文片段 —— 它出现在文本里，但绝不能出现在观测数据里
    expect(attributeValues.some((value) => value.includes("退款到账时间"))).toBe(false);
  });
});
