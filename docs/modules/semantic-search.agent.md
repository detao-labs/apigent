# Semantic Search Agent

> **类型：AI Agent**（LLM 驱动，需要语义理解）

## 定位

检索层唯一的 LLM Agent。接收自然语言查询，理解意图后进行多路混合召回和两阶段排序，返回最相关的 API。区别于传统关键词搜索——它理解 "退款" 对应的是 `POST /orders/{id}/refund` 而非 `GET /health`。

---

## 检索架构总览

```
User Query: "退款接口在哪里？"
    │
    ▼
┌──────────────────────────────────────────────────────┐
│ 1. Query Rewriting（规则判断 + LLM，≤1 次调用）        │
│    → rewritten query + sub_queries + entities         │
├──────────────────────────────────────────────────────┤
│ 2. Permission Pre-filter                             │
│    → accessible_repo_ids FROM RBAC                    │
│    → WHERE repo_id IN (...)                           │
├──────────────────────────────────────────────────────┤
│ 3. Multi-path Retrieval（并行，0 LLM 调用）            │
│    ├── Embedding (Dense)  → top-50                    │
│    ├── BM25 (Sparse)      → top-50                    │
│    └── Knowledge Graph    → top-20（V1+ 可选，开启后） │
├──────────────────────────────────────────────────────┤
│ 4. Coarse Rank: RRF Fusion → top-30（~50ms）          │
├──────────────────────────────────────────────────────┤
│ 5. Fine Rank: Cross-encoder → top-10（~200ms）        │
├──────────────────────────────────────────────────────┤
│ 6. Context Expansion                                 │
│    → hit endpoint chunk → expand business rules       │
│    → append tag summary for context                   │
└──────────────────────────────────────────────────────┘
                      │
                      ▼
              Ranked Results + Match Reasons
```

**LLM 调用次数：≤1**（仅 Query Rewriting，且可缓存）

---

## 输入

| 字段 | 类型 | 说明 |
|------|------|------|
| `query` | `string` | 自然语言查询："查找与退款相关的 API" |
| `repo_id?` | `string` | 限定搜索范围（Repo） |
| `org_id?` | `string` | 限定搜索范围（Organization 下所有 Repo） |
| `project_id?` | `string` | 限定为某 Project 内的 repo（V1+；双层规则：仅返回用户有权限的 repo） |
| `top_k?` | `number` | 返回数量，默认 10 |
| `filter?` | `SearchFilter` | HTTP 方法、tag、路径前缀等筛选条件 |
| `user_id` | `string` | 当前用户 ID（用于权限过滤） |
| `search_mode?` | `"fast" \| "deep"` | `fast`: 跳过 Query Rewriting（默认）；`deep`: 完整流程 |

## 输出

```typescript
interface SearchResult {
  query: string;
  rewritten_query?: string;       // 改写后的查询（如有）
  results: ScoredAPI[];
  total_hits: number;
  search_strategy: "hybrid" | "semantic" | "keyword" | "graph";  // "graph" 仅在 KG 启用后出现
  latency_ms: number;
  llm_calls: number;
}

interface ScoredAPI {
  api_id: string;
  repo_id: string;
  path: string;
  method: string;
  summary: string;
  score: number;                  // 最终排序分数 0-1
  coarse_score: number;           // RRF 粗排分数
  fine_score: number;             // Cross-encoder 精排分数
  match_reason: string;           // 为什么匹配："业务意图匹配'退款'场景"
  highlights: {                   // 匹配的关键片段
    field: string;                // "capability.intent" | "usage.when_to_use" | "description" | "path"
    snippet: string;
  }[];
}
```

---

# 1. Query Rewriting（查询改写）

## 1.1 改写决策树

在调用 LLM 之前，先用规则判断是否需要改写：

```
User Query
    │
    ▼
┌─────────────────────────────────────────┐
│ 规则判断（0 成本）                        │
│                                          │
│ ├── 包含精确 HTTP method + path？         │
│ │   → 不改写，直接检索                     │
│ │   e.g. "POST /orders/refund"            │
│ │                                         │
│ ├── < 5 词 且 无中文？                     │
│ │   → 不改写，直接检索                     │
│ │   e.g. "refund API"                      │
│ │                                         │
│ ├── search_mode = "fast"？                │
│ │   → 不改写                               │
│ │                                         │
│ └── 含中文 / 含模糊词 / 含缩写 / 复杂问题？  │
│     → 触发 LLM 改写                        │
└─────────────────────────────────────────┘
```

## 1.2 LLM 改写

**System Prompt：**

```
你是一个 API 搜索查询改写专家。将用户关于 API 的自然语言问题改写为：

1. rewritten: 英文检索查询，提取核心技术关键词
2. sub_queries: 如果原始问题包含多个子意图，拆分为独立查询（最多 3 个）
3. entities: 提取技术实体（HTTP 方法名、路径片段、字段名、业务概念）

规则：
- 中英混合查询 → 统一翻译为英文检索关键词
- 缩写展开：sku → stock keeping unit
- 业务术语标准化："退款接口" → "refund API endpoint POST /orders/{id}/refund"
- 不要编造不存在的 API 路径
```

**示例：**

```
Input:  "退款接口在哪里？"
Output: {
  "rewritten": "refund endpoint POST /orders/{id}/refund",
  "sub_queries": ["refund API", "order cancellation"],
  "entities": ["refund", "order", "POST"]
}

Input:  "如何处理订单取消和退款，两者有什么区别？"
Output: {
  "rewritten": "order cancellation and refund API comparison",
  "sub_queries": [
    "cancel order API DELETE /orders/{id}",
    "refund API POST /orders/{id}/refund"
  ],
  "entities": ["cancel", "refund", "order", "DELETE", "POST"]
}

Input:  "POST /orders/refund"
Output: → 规则判断 → 不改写（已包含精确 method + path）
```

## 1.3 改写缓存

热门查询的改写结果缓存 1 小时，减少 LLM 调用：

```ts
// 缓存 key: md5(normalize(query))
// normalize: lowercase + trim + 去标点
const CACHE_TTL = 3600_000 // 1 小时
const cachedRewrite = await cache.get(`rewrite:${queryHash}`)
if (cachedRewrite) return cachedRewrite
```

---

# 2. Hybrid Retrieval（混合召回）

## 2.1 Embedding Search（Dense 语义检索）

语义匹配："退款" ↔ "订单取消并返款"，同义表达召回。

```
pgvector 查询：
  SELECT id, content, 1 - (embedding <=> $query_vector) AS score
  FROM chunks
  WHERE repo_id = ANY($accessible_repo_ids)    ← 权限前置过滤
  ORDER BY embedding <=> $query_vector
  LIMIT 50
```

**Embedding 模型：** `text-embedding-v4`（阿里云百炼，默认）  
**向量维度：** 1024  
**索引：** ivfflat（PG）或 Milvus 自管理索引  
**相似度：** Cosine

## 2.2 BM25 Search（Sparse 词汇检索）

精确匹配：方法名 (`POST`)、路径 (`/orders/refund`)、字段名 (`amount`)、参数名。

**为什么是 BM25 而非简单关键词匹配：**

| | 简单关键词 | BM25 |
|------|----------|------|
| TF 处理 | 词频线性累加，"order" 出现 100 次 = 100 分 | TF 饱和（`tf / (k1 + tf)`），重复 >3 次几乎不加分 |
| 文档长度 | 长文档天然优势 | 长度归一化，公平比较 |
| IDF | 无 | 全库词频统计，稀有词权重高 |
| API 场景 | `GET /health` 中 "GET" 高权重（错误） | "GET" IDF 低 → 权重自动降低（正确） |

**PostgreSQL 原生实现（无需额外组件）：**

```sql
-- 1. 预先创建 tsvector 列
ALTER TABLE chunks ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(method, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(path, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) STORED;

CREATE INDEX ON chunks USING GIN (search_vector);

-- 2. 检索时
SELECT id, content, ts_rank(search_vector, websearch_to_tsquery('english', :query)) AS bm25_score
FROM chunks
WHERE repo_id = ANY($accessible_repo_ids)
  AND search_vector @@ websearch_to_tsquery('english', :query)
ORDER BY bm25_score DESC
LIMIT 50;
```

**权重设计（`setweight`）：**

| 字段 | 权重 | 说明 |
|------|------|------|
| `method` | A (1.0) | HTTP 方法，最高精度 |
| `path` | A (1.0) | URL 路径，最高精度 |
| `summary` | B (0.4) | 接口概述，次高 |
| `content` | C (0.2) | 完整内容和业务描述 |

## 2.3 Knowledge Graph Traversal（结构召回）

**V1+ 可选路径**：由配置 `rag.knowledgeGraph.enabled` 控制（默认关闭）。启用后利用 Knowledge Graph 中的 API 关联关系扩展召回：

```
匹配 API → 沿关系图扩展：
  ├── depends_on  API（前置依赖）
  ├── follow_up   API（后续调用）
  ├── related     API（相关 API）
  └── 同一 workflow 的其他 API
```

当一个 API 被 Embedding/BM25 命中时，它的 1 跳邻居也获得 bonus 分。这解决了"用户想找退款流程，但直接搜到的只是取消订单"的结构性问题。

---

# 3. Chunk 优化

## 3.1 分层 Chunk 策略

不可按固定 token 长度硬切——API 文档有天然语义边界。正确做法是分层 chunk：

```
Repository (repo-level)
  │
  ├── Chunk L0: Project Context（全局约定、认证方式、分页格式）
  │     ≈ 300 tokens
  │     metadata: { level: "project", repo_id, org_id }
  │
  ├── Tag Group（tag="订单管理"）
  │   ├── Chunk L1: Tag Summary（该 tag 下接口的业务概述）
  │   │     ≈ 200 tokens
  │   │     metadata: { level: "tag", tag: "订单管理" }
  │   │
  │   ├── API Endpoint（POST /orders/refund）
  │   │   ├── Chunk L2: Endpoint Full ★ 检索主单元
  │   │   │     ≈ 800-1500 tokens
  │   │   │     metadata: { level: "endpoint", repo_id, method, path, tag }
  │   │   │     包含: method + path + summary + description
  │   │   │          + 全部参数（名称+类型+必填+业务含义）
  │   │   │          + 响应字段（名称+类型+业务含义）
  │   │   │          + 能力上下文（repo）+ 使用上下文（project，V1+）
  │   │   │
  │   │   ├── Chunk L3a: Request Schema
  │   │   │     ≈ 300 tokens
  │   │   │     metadata: { level: "schema", parent_id: L2, direction: "request" }
  │   │   │
  │   │   ├── Chunk L3b: Response Schema
  │   │   │     ≈ 300 tokens
  │   │   │     metadata: { level: "schema", parent_id: L2, direction: "response" }
  │   │   │
  │   │   └── Chunk L3c: Business Rules ★ 精排后扩展
  │   │         ≈ 200 tokens
  │   │         metadata: { level: "rules", parent_id: L2 }
  │   │         包含: 业务约束 + 使用规则 + 注意事项 + examples
  │   │
  │   └── API Endpoint（GET /orders/{id}）
  │       └── ... (同上)
  │
  └── Workflow Chunk L1: "退款流程"（V1+，随 Knowledge Graph 启用）
        ≈ 1000 tokens
        metadata: { level: "workflow" }
        包含: [POST /orders/refund → POST /payments/refund → GET /orders/{id}]
              调用顺序 + 数据流转
```

## 3.2 检索与扩展策略

```
阶段 1 — 召回：以 L2 (Endpoint Full) 作为检索主单元
  → Embedding + BM25 都在 L2 级别搜索
  → L2 包含完整语义，不会出现 schema 被截断的问题

阶段 2 — 上下文扩展（精排后）：
  ┌── L2 命中且 score > 0.7
  │   ├── 加载 L3c (Business Rules) —— 提供业务约束细节
  │   ├── 加载 parent L1 (Tag Summary) —— 提供业务域上下文
  │   └── 如果是 workflow 问题 → 加载 Workflow Chunk L1
  │
  └── 多个 L2 命中同一 tag
      └── 加载 L1 Tag Summary 一次，供所有同 tag 结果共享
```

## 3.3 Chunk Metadata

```ts
interface ChunkMetadata {
  level: "project" | "tag" | "workflow" | "endpoint" | "schema" | "rules"
  repo_id: string              // 用于权限过滤
  org_id: string               // 冗余，加速 org 级查询
  method?: string
  path?: string
  tag?: string
  parent_chunk_id?: string     // L3 → L2 的关联
  workflow_id?: string
  version: string              // OpenAPI version
  language: "zh" | "en"        // 中英双 chunk，分别 embedding
}
```

## 3.4 中英双 Chunk 策略

同一个 API 的中文和英文描述生成两个独立 chunk + 独立 embedding：

```
POST /orders/refund
  ├── chunk_zh: "订单退款接口。退款仅可在支付后 7 天内申请..."
  │     embedding: text-embedding-v4("订单退款接口...")
  └── chunk_en: "Order refund endpoint. Refund can only be requested within 7 days..."
        embedding: text-embedding-v4("Order refund endpoint...")
```

检索时两个 chunk 都参与召回，共享同一个 `parent_chunk_id`。中文查询自动命中中文 chunk，英文查询命中英文 chunk，但去重时合并为同一个 API 结果。

---

# 4. Permission-Aware Retrieval（权限感知检索）

## 4.1 为什么必须检索前过滤

```
❌ 检索后过滤（错误做法）：
   向量搜索 → top-50 chunks → 过滤掉无权限的 → 只剩 5 条
   问题：相关但无权限的 chunk 挤占了有权限 chunk 的位置
         worst case: top-50 全是无权限结果 → 用户得到 0 条

✅ 检索前过滤（正确做法）：
   查用户 effective permissions → accessible_repo_ids
   → 向量搜索 (WHERE repo_id IN (...)) → top-30 chunks
   → 精排 → top-10
```

## 4.2 实现

```ts
async function retrieveWithPermission(
  userId: string,
  queryVector: number[],
  topK: number,
): Promise<ChunkResult[]> {
  // 1. 查用户有权访问的仓库列表
  const accessibleRepos = await getAccessibleRepoIds(userId)
  // → SELECT org_id, role FROM org_members WHERE user_id = $1
  // → SELECT repo_id, role FROM repo_permissions WHERE user_id = $1
  // → 合并 Organization 继承权限 + Repo 覆盖权限
  // → 返回 repo_id 集合

  if (accessibleRepos.length === 0) return []

  // 2. 带权限过滤的向量检索
  const results = await vectorStore.search(queryVector, {
    topK: topK * 3,  // 多召回，给 RRF + 精排留余量
    filter: {
      repo_id: { $in: accessibleRepos },   // ← 权限在此过滤
    },
  })

  return results
}
```

## 4.3 权限过滤的 Granularity

| 搜索入口 | 过滤维度 | 说明 |
|---------|---------|------|
| **平台全局搜索** | `WHERE repo_id IN (user_accessible_repos)` | 用户有权限的所有 repo |
| **Organization 内搜索** | `WHERE org_id = :org_id AND repo_id IN (...)` | 限定 organization + 权限双重过滤 |
| **单 Repo 搜索** | `WHERE repo_id = :repo_id` + RBAC check | 先检查用户对该 repo 的权限，无权限直接拒绝 |
| **Project 内搜索（V1+）** | `WHERE repo_id IN (project_repos ∩ user_accessible_repos)` | 双层规则：项目过滤 + 仓库权限 |
| **MCP search_apis** | `WHERE repo_id IN (key_scoped_repos)` + RBAC | Secret Key scopes 限定 + 用户权限 |

## 4.4 额外安全措施

| 措施 | 说明 |
|------|------|
| **审计日志** | 记录每次搜索：`(user_id, query, repo_filter, timestamp, latency_ms)` |
| **Rate Limiting** | 每用户每分钟最多 30 次搜索；MCP 调用按 Key 限流 |
| **敏感字段 Mask** | LLM 回答 Prompt 中不注入完整 Schema 值，只注入名称 + 类型 + 描述 |
| **Chunk 级 org_id 冗余** | repo 迁移 organization 后，chunk 的 org_id 保持不变（snapshot 语义避免数据泄露） |

---

# 5. Coarse & Fine Ranking（粗排与精排）

## 5.1 两阶段排序架构

```
三路召回结果（共 100-120 candidates）
    │
    ▼
┌──────────────────────────────────────────┐
│ 阶段 1 — Coarse Rank (RRF Fusion)         │
│                                           │
│ Embedding rank ─┐                         │
│ BM25 rank ──────┼─→ RRF → top-30          │
│ KG bonus ───────┘（V1+ 启用后）            │
│                                           │
│ 延迟: ~50ms   LLM 调用: 0                 │
└──────────────────┬───────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────┐
│ 阶段 2 — Fine Rank (Cross-encoder)        │
│                                           │
│ 30 candidates × (query, chunk) pairs      │
│     → qwen3-rerank                        │
│     → 逐对打分                             │
│     → top-10                              │
│                                           │
│ 延迟: ~200ms   LLM 调用: 0                │
└──────────────────┬───────────────────────┘
                   │
                   ▼
              Top-10 Results
```

## 5.2 RRF（Reciprocal Rank Fusion）粗排

不关心原始分数是什么量纲——只看排名。三路排名的倒数之和作为融合分数。

```ts
function coarseRank(
  embeddingResults: ScoredChunk[],
  bm25Results: ScoredChunk[],
  kgResults: ScoredChunk[],
  k = 60,
  topN = 30,
): ScoredChunk[] {
  // 分别按各自分数排名
  const embRank  = rankBy(embeddingResults, r => r.score)
  const bm25Rank = rankBy(bm25Results, r => r.score)
  const kgRank   = rankBy(kgResults, r => r.score)

  // RRF 融合
  const fused = new Map<string, number>()
  for (const [id, rank] of embRank)  fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank))
  for (const [id, rank] of bm25Rank) fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank))
  for (const [id, rank] of kgRank)   fused.set(id, (fused.get(id) ?? 0) + 1 / (k + rank))

  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([id, score]) => ({
      ...findChunk(id),
      coarseScore: score,
    }))
}
```

**为什么 RRF 优于加权求和：**

| | 加权求和 | RRF |
|------|---------|-----|
| 需要调参 | 需要调 3 个权重（embedding/bm25/kg） | 只需 k（通常 60，不敏感） |
| 量纲问题 | embedding [0,1], bm25 [0,∞), kg bonus [0,1] — 必须归一化 | 只关心排名，无关量纲 |
| 某路极端值 | 一路极高可压制其他路 | 排名融合，不会被单一高分绑架 |

## 5.3 Cross-encoder 精排

粗排后 top-30 进入精排。Cross-encoder 将 (query, document) 作为 pair 输入，输出精确的语义相关性分数。

```
Bi-encoder（Embedding）:
  query → [vec]  doc → [vec]  → cosine(vec_q, vec_d)
  快但粗糙：query 和 doc 独立编码，无交互

Cross-encoder（Reranker）:
  [query, doc] → Transformer → score
  准但慢：query 和 doc 联合编码，cross-attention 捕捉细粒度匹配
```

**推荐方案 V1：qwen3-rerank（阿里云百炼 API）**

| 特性 | 说明 |
|------|------|
| 多语言 | 支持 100+ 语言，中英 query-doc pair 均可 |
| 免运维 | 百炼托管 API，无需自部署 GPU |
| 容量 | 单次最多 500 个候选文档；query/文档各最长 4000 tokens |
| 替代方案 | 本地 BGE-Reranker-v2-m3（自部署）、Cohere Rerank API |

```ts
async function fineRank(
  query: string,
  candidates: ChunkResult[],
  topN = 10,
): Promise<ChunkResult[]> {
  // 构建 (query, chunk.content) pairs
  const pairs = candidates.map(c => ({
    query,
    document: c.content.slice(0, 512),  // cross-encoder 最大输入通常 512 tokens
  }))

  // 批量打分
  const scores = await reranker.score(pairs)

  // 排序 + 截断
  return scores
    .map((s, i) => ({ ...candidates[i], fineScore: s.score }))
    .sort((a, b) => b.fineScore - a.fineScore)
    .slice(0, topN)
}
```

## 5.4 LLM Judge（V2 可选）

V1 不引入 LLM 做排序。V2 中仅当 top-1 和 top-2 精排分数非常接近（差距 < 0.05）时，由 LLM 做最终裁决：

```
System: "Is this API really relevant to the user's query? Answer yes or no."
Input:  Query + API chunk content
Output: { relevant: true/false, reason: "..." }
```

| 排序阶段 | 候选量 | 延迟 | 成本/查询 |
|---------|--------|------|----------|
| RRF 粗排 | 100+ → 30 | ~50ms | 0 |
| Cross-encoder 精排 | 30 → 10 | ~200ms | 0（本地）或极低（API） |
| LLM Judge（V2 可选） | 10 → 5 | ~500ms | ~$0.01 |

---

# 6. 向量化策略

```
每个 L2 Endpoint Chunk 的 embedding 由以下字段拼接：
  1. method + path                  (权重: 天然高——setweight 'A')
  2. summary + description          (权重: embedding 语义主体)
  3. capability.intent              (权重: 核心区分度——"退款" vs "取消")
  4. usage.when_to_use              (权重: 使用场景补充，V1+ 使用上下文)
  5. tags                           (权重: 分类信号)

模型：text-embedding-v4 (维度 1024) 或 BGE-M3 (维度 1024, 中英双语)
更新时机：
  - API 创建/更新时触发重新 embedding（通过 BullMQ 异步任务）
  - 同一 API 的中文和英文描述分别生成独立 embedding
```

---

# 7. 搜索策略选择（自动）

| 用户输入特征 | 策略选择 | 说明 |
|------------|---------|------|
| 精确 method + path | `keyword` 优先，embedding 辅助 | BM25 权重提升至 0.5 |
| 短查询 (≤5 词，英文) | `hybrid`（embedding + BM25） | 默认策略 |
| 长查询 (>5 词) | `semantic` 优先 | LLM 改写 → embedding 主导 |
| 中文查询 | 触发 query rewriting → `hybrid` | 改写为英文检索词 |
| 含 workflow/流程关键词 | `hybrid` + KG bonus 翻倍（V1+，KG 启用后） | "退款流程"、"调用顺序" |
| 模糊问题 | `deep` mode → 完整 pipeline | LLM 改写 + 子查询多路召回 |

---

## 行为规范

1. **有结果必有理由**：每个结果附带 `match_reason` + `highlights`
2. **零结果不沉默**：降级为 BM25 关键词搜索，仍无结果返回空列表 + 搜索建议 + "尝试用英文搜索"提示
3. **权限无感知**：对外透明——用户不知道有 repo 被过滤掉了
4. **延迟可控**：`fast` 模式 p50 < 200ms, p99 < 500ms；`deep` 模式 p50 < 800ms, p99 < 1500ms

---

## 依赖

- **上游**：Vector Store（pgvector/Milvus/Qdrant）、PostgreSQL `tsvector`（BM25）
- **查询时查询**：Business Context Agent 的能力上下文（`capability.intent`）与使用上下文（V1+）；Knowledge Graph Service 的关联数据（V1+ 可选，启用后）
- **权限层**：RBAC `getAccessibleRepoIds(userId)`
- **下游**：Knowledge Retrieval Service（用户选择结果后获取完整详情）

---

## 触发方式

- MCP `search_apis` tool（外部 Agent）
- Platform Webapp 搜索框（开发者）
- Knowledge Assistant Agent（V1 RAG Q&A 的检索步骤）

---

## 边界情况

| 场景 | 行为 |
|------|------|
| 查询无结果 | 降级 BM25 → 仍无结果返回空列表 + 搜索建议 + "尝试用英文搜索" |
| 用户无任何仓库权限 | 返回空列表，不暴露 repo 存在信息 |
| 跨 Organization 搜索 | 返回用户有权限的所有 repo 结果，按 repo 分组 |
| 中英混合查询 | LLM 改写统一翻译为英文检索词，中英双 chunk 同时召回 |
| 查询包含拼写错误 | LLM 改写阶段自动纠正，保留原始查询记录 |
| 目标 repo 无 embedding 数据 | 降级为纯 BM25 关键词搜索 |
| BM25 索引尚未构建 | PostgreSQL `tsvector` Generated Column 自动同步，不存在窗口期 |
