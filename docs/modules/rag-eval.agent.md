# RAG Evaluation Agent

> **状态：** 仅设计——尚未实现。

> **Type: AI Agent**（LLM 驱动，LLM-as-judge 打分）

## 定位

评估 Semantic Search Agent 的**检索质量**与可选的**端到端答案质量**。分两层：

1. **离线检索评测（确定性，无 LLM）**：黄金集 → 检索指标（hit@k / MRR / nDCG / 延迟 / 空召回率）。
2. **端到端答案评测（LLM-as-judge）**：用 judge 模型对答案的 correctness / groundedness / relevance 打分。

LLM 只出现在第 2 步；检索指标全靠确定性计算。

## 输入

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `golden_set` | `GoldenQuery[]` | 标注集：查询 → 预期 endpoint id 集合 |
| `judge` | `JudgeConfig` | judge 模型、温度、评分大纲（rubric） |
| `thresholds` | `RetrievalThresholds` | hit@3 / MRR / P95 / empty_rate 阈值 |

```ts
interface GoldenQuery {
  id: string;
  query: string;                // 自然语言，如 "退款接口在哪里"
  expected_api_ids: string[];   // 预期命中（可能多个）
  unanswerable?: boolean;       // 该查询不应命中任何 API
}
```

## 输出

```json
{
  "run_at": "2026-09-04T00:00:00Z",
  "retrieval": {
    "hit@3": 0.94, "mrr": 0.78, "ndcg@3": 0.88,
    "p95_latency_ms": 1800, "empty_rate": 0.03
  },
  "generation": {
    "correctness": 0.91, "groundedness": 0.93, "relevance": 0.9
  },
  "cost": { "tokens": 120000, "usd": 0.6 },
  "per_query": [ { "id": "q1", "hit@3": 1.0, "rank_top1": 1 } ]
}
```

## 核心能力

### 1. 检索评测（确定性）

- 加载黄金集 → 走 Semantic Search 检索路径 → 每次查询得有序结果。
- 计算 `hit@k`（预期中任一在 top-k 即命中）、`MRR = 1 / 首个命中的位次`、`nDCG`（考虑位次权重）。
- 统计 `P95 延迟`、`空召回/回退率`。

```
MRR  = mean( 1 / rank(first_hit) )
hit@k = |{ q : any(expected) in topK(q) }| / |golden|
```

### 2. LLM-as-judge（AI SDK + zod）

用 `generateObject` 输出结构化评分（temperature=0，保证可复现）：

```ts
const verdict = await generateObject({
  model: createAIModel("default"),
  temperature: 0,
  schema: z.object({
    correctness: z.number().min(0).max(1),
    groundedness: z.number().min(0).max(1), // 答案是否基于检索结果，不编造
    relevance: z.number().min(0).max(1),
    reasons: z.array(z.string()),
  }),
  prompt: judgePrompt(query, answer, retrieved, rubric),
});
```

**评分大纲（rubric）**：correctness 是否回答正确；groundedness 是否所有断言都来自召回内容；relevance 是否切题；分数 0–1 整数档。

### 3. 回归 / CI 门禁

- `pnpm rag:eval` 一键跑。
- CI 在改动检索/重排相关代码时触发；**阈值不达标即失败**：

```
hit@3 < 0.9 或 MRR < 0.7 或 P95 > 2000ms 或 empty_rate > 0.05  → CI fail
```

- 每轮产出报告并留基线，漂移时告警。

### 4. Active Eval（V1+）

定期对生产采样查询做在线评测，检测检索/重排漂移。

## 行为规范

1. **黄金集版本化**：不可变，变更走版本 bump，避免回归对比失真。
2. **judge 可配置、可复现**：temperature=0、模型固定，阈值放配置不放代码。
3. **报告作为产物**：输 JSON + Markdown，供 CI/看板消费。
4. **不确定即降置信**：judge 在阈值附近时二次打分，取平均。

## 依赖

- 上游：Semantic Search Agent、黄金集数据、judge LLM provider
- 下游：CI / 报告；可选接入 RAG Observability 看板
- 辅助：vitest（harness）、AI SDK（judge）

## 触发方式

- 手动：`pnpm rag:eval`
- CI：检索 / 重排相关代码变更时
- 定时：Active Eval（V1+）

## 边界情况

| 场景 | 行为 |
| --- | --- |
| 查询有多个正确答案 | 任一在 top-k 内即计命中 |
| judge 不确定 / 接近阈值 | 二次 judge，降低置信度 |
| `unanswerable` 查询 | 命中任一即判失败；不纳入 hit@k |
| LLM 不可用 | 跳过 LLM-judge，仍完成检索评测 |

## 配置设计（`apigent.config.yaml`）

```yaml
eval:
  dataset: ./data/rag-eval/golden.json
  retrieval:
    hit@3: 0.9
    mrr: 0.7
    p95_latency_ms: 2000
    empty_rate: 0.05
  judge:
    provider: qwen
    model: qwen3.7-plus
    temperature: 0
    rubric: ./data/rag-eval/rubric.md
```

## 待细化

- 黄金集规模（PRD 建议 20 条）与标注方、纳入方式（文件/DB）。
- V0 是否需要端到端答案评测，还是仅检索评测即可。
- 阈值最终值（hit@3 ≥0.9 / MRR ≥0.7 / P95 ≤2s / empty <5% 待确认）。
- Active Eval 的调度与采样策略。
