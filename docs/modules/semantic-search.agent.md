# Semantic Search Agent

> **类型：AI Agent**（LLM 驱动，需要语义理解）

## 定位

检索层唯一的 LLM Agent。接收自然语言查询，理解意图后进行语义匹配，返回最相关的 API。区别于传统关键词搜索——它理解 "退款" 对应的是 `POST /orders/{id}/refund` 而非 `GET /health`。

## 输入

| 字段 | 类型 | 说明 |
|------|------|------|
| `query` | `string` | 自然语言查询："查找与退款相关的 API" |
| `project_id?` | `string` | 限定搜索范围 |
| `top_k?` | `number` | 返回数量，默认 5 |
| `filter?` | `SearchFilter` | 方法、tag、路径等筛选条件 |

## 输出

```typescript
interface SearchResult {
  query: string;
  results: ScoredAPI[];
  total_hits: number;
  search_strategy: 'semantic' | 'hybrid' | 'keyword';
  latency_ms: number;
}

interface ScoredAPI {
  api_id: string;
  path: string;
  method: string;
  summary: string;
  score: number;              // 相关性分数 0-1
  match_reason: string;       // 为什么匹配："业务意图匹配'退款'场景"
  highlights: {               // 匹配的关键片段
    field: string;
    snippet: string;
  }[];
}
```

## 核心能力

### 1. 混合搜索

不只用向量相似度，融合多路召回：

| 搜索通道 | 权重 | 适用场景 |
|---------|------|---------|
| 语义向量搜索 | 0.5 | 意图匹配（"退款" ↔ POST /orders/refund） |
| 关键词匹配 | 0.3 | 精确匹配（方法名、路径、参数名） |
| 业务标签匹配 | 0.2 | tag、intent 分类 |

最终分数 = 加权求和 → 重排序

### 2. 查询理解

- 意图识别：从查询中提取操作意图（CRUD、审批、查询...）
- 实体识别：提取业务实体（订单、用户、支付...）
- 约束识别：提取筛选条件（"7 天内"、"已支付"）

### 3. 搜索策略选择

- 短查询（≤5 词）→ 混合搜索
- 长查询（>5 词）→ 语义优先
- 包含 HTTP 方法关键词（"POST"、"GET"）→ 关键词权重提升
- 精确路径片段（"/orders/"）→ 直接路径匹配

## 行为规范

1. **有结果必有理由**：每个结果附带 `match_reason`
2. **零结果不沉默**：返回 `search_strategy: 'keyword'` 降级结果，附带搜索建议
3. **可调权重**：允许用户/外部 Agent 调整搜索权重偏好

## 依赖

- 上游：需要 Vector DB（存储 API embedding）
- 查询时查询：Business Context Agent 的 `intent` 字段、Knowledge Graph Agent 的关联数据
- 下游：Knowledge Retrieval Agent（用户选择结果后获取详情）

## 向量化策略

```
每个 API 的 embedding 由以下字段拼接生成：
  1. summary + description           (权重 0.4)
  2. business.intent                 (权重 0.3)  ← 核心区分度
  3. business.when_to_use            (权重 0.2)
  4. tags + path                     (权重 0.1)

模型：text-embedding-3-small (或同级别)
更新时机：API 创建/更新时触发重新 embedding
```

## 触发方式

- MCP Gateway Agent 调用 `search_apis` tool
- Web UI 搜索框输入
- 下游 Agent 程序化调用

## 边界情况

| 场景 | 行为 |
|------|------|
| 查询无结果 | 降级为关键词搜索，仍无结果返回空列表 + 搜索建议 |
| 跨项目搜索（未指定 project_id） | 返回用户有权限的所有项目结果，按 project 分组 |
| 中文查询 | 与英文查询共享同一向量空间（embedding 模型需支持多语言） |
| 查询包含拼写错误 | LLM 预处理阶段自动纠正，保留原始查询记录 |
