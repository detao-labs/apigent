# RAG Observability

> **Type: Platform Service**（确定性逻辑，不需要 LLM）

## 定位

RAG 检索管线的可观测层。采集每次查询的**执行轨迹（trace）与指标（metric）**，通过 OpenTelemetry 导出到可配置后端。本身**不含 LLM、不参与检索**——只做埋点、聚合与导出，给「为什么返回这个结果、多耗了多少」提供证据。

目标：**每次检索可解释、性能可度量、成本可核算、失败可定位、回归可对比。**

## 采集对象：一次查询的 Trace 模型

```
root: rag.query                     {repoId, userId, mode, topK, traceId}
├── rewrite                        (LLM)        → functionId=rag.rewrite
│   └── rewrite.cache_hit          (bool)       → 是否命中改写缓存
├── retrieve.dense                 (VectorStore) → top-50 + embedding model + dim
├── retrieve.sparse                (BM25)        → top-50 + tsquery
├── retrieve.kg                    (V1+ 可选)
├── fusion.rrf                     (纯函数)      → top-30 + 各路分数
├── rerank                          (cross-encoder/API) → top-10 + 分数
├── expand.context                  (纯拼装)      → 追加 tag/summary
└── answer                          (LLM, 端到端可选) → functionId=rag.answer
```

每个 span 携带属性：各阶段分数、命中数量、耗时、模型、token、成本、空召回/fallback 标记。

## 指标（Metrics）

| 指标 | 类型 | 定义 | 目标（建议，待确认） |
| --- | --- | --- | --- |
| `rag.query.latency` | histogram | 端到端查询耗时 | p95 ≤ 2s |
| `rag.stage.latency` | histogram | 各阶段（改写/召回/融合/重排）耗时 | 定位瓶颈 |
| `rag.recall.empty_rate` | gauge | 空召回/回退占比 | < 5% |
| `rag.rewrite.llm_calls` | counter | 改写触发 LLM 次数 → 成本 | 期望 cache_hit 高 |
| `rag.rewrite.cache_hit` | counter | 改写缓存命中率 | ≥ 80%（深搜） |
| `rag.cost_per_query` | counter | token + 货币成本 | 预算内 |
| `rag.fallback_rate` | gauge | 检索失败走回退占比 | < 5% |

## Telemetry 接入（AI SDK + 手动 span）

AI SDK 会自动给 LLM / embedding / tool 调用打 span；**检索与融合等自定义阶段需手动埋点**。

```ts
// LLM 调用：交给 AI SDK 自动埋点
streamText({
  model: createAIModel("rag_answer"),
  experimental_telemetry: {
    isEnabled: true,
    functionId: "rag.answer",
    recordInputs: true,
    recordOutputs: false, // 避免把业务原文外泄
    metadata: { repoId: r.repoId, mode: r.mode },
  },
});

// 检索阶段：手动 span
import { trace } from "@opentelemetry/api";
await trace.getTracer("rag").startActiveSpan("retrieve.dense", async (span) => {
  span.setAttributes({ topK: 50, model: embedding.model });
  const hits = await vectorStore.search(qVec, { topK: 50 });
  span.setAttribute("result_count", hits.length);
  span.end();
});
```

## 导出器与后端

通过 OTel exporter 导出，后端在 `apigent.config.yaml` 里切（走现有「接口 + 配置可换」哲学）：

| provider | 优势 | 说明 |
| --- | --- | --- |
| `otel` | 通用，Linux 生态 | 自建 Collector → Tempo/Phoenix 等 |
| `langfuse` | 专做 LLM 追踪，看板友好 | 建议 V0 首选 |
| `phoenix` | OpenInference，RAG 评测推荐 | 若后续接评测看板 |
| `none` | 关闭/仅 console | 开发用 |

## 配置设计（`apigent.config.yaml`）

```yaml
observability:
  provider: otel          # none | otel | langfuse | phoenix
  enabled: true
  sampler: parentbased_always_on   # 生产可降采样，例如 parentbased_traceidratio
  samplerRatio: 1.0
  export:
    otel:
      endpoint: http://localhost:4318
      protocol: http/json          # http/json | grpc
```

> 密钥（ingest key、token）一律走 `.env`，不落在 YAML。

## 行为规范

1. **不阻塞主链路**：span/导出异步，fail-open——观测挂了不影响检索。
2. **成本可控**：采样率默认 dev 1.0 / prod 0.1（可配置）。
3. **脱敏**：默认不记录检索内容原文（`recordOutputs=false`），避免泄露 OpenAPI 业务文本。
4. **每查询一条 trace**：统一 `traceId`，可串起日志与指标。

## 依赖

- 上游：Semantic Search Agent、VectorStore / EmbeddingProvider / LLMProvider（AI SDK）
- 下游：OTel Collector / Langfuse / Phoenix；Web UI（可选 RAG trace 查看）
- 辅助：`@opentelemetry/api`、`@opentelemetry/sdk-*`、对应 exporter

## 触发方式

- 每次检索调用（`search_apis` / 平台端语义搜索）——每查询一条 trace，批处理导出。

## 边界情况

| 场景 | 行为 |
| --- | --- |
| 空召回 / 回退 | span 打 `fallback=true`，`empty_rate` / `fallback_rate` +1 |
| 改写失败 | 降级 `fast` 模式，span `status=ERROR` + fallback 标记 |
| LLM 不可用 | 观测仍可导出（fail-open），仅 LLM 相关 span 缺失 |
| 敏感内容 | 脱敏，`recordOutputs=false` |

## 待细化

- 采样上限与留存策略、单查询成本预算。
- 是否在 Web UI 呈现「为何返回该结果」的 trace 视图。
- 指标存储：是否引 Prometheus，还是仅依赖 tracing 平台聚合。
