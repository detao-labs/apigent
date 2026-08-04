# Knowledge Graph Service

> **类型：Platform Service**（确定性逻辑，不需要 LLM）
>
> **状态：V1+ 可选增强，默认关闭**（配置开关 `rag.knowledgeGraph.enabled`）。V0 不构建图谱。

## 定位

构建和管理 API 之间的关联关系图谱。基于 `$ref` 引用、路径模式、字段命名匹配等确定性规则，将孤立的 API 端点连接成有向图。

**粒度分两层：**

- **Repository 技术层**：`$ref` 引用、同路径、参数依赖等纯技术关联
- **Project 业务层**：`follow_up` / `depends_on` / `alternative` 等工作流与业务关系（由 Business Context Agent 的业务知识构建）

一个 Project 的图谱聚合其关联的多个 Repository（可跨 Organization）。

## 输入

| 字段 | 类型 | 说明 |
|------|------|------|
| `apis` | `EnrichedAPI[]` | 带业务上下文的 API 列表 |
| `repo_id` | `string` | Repository ID（技术层边） |
| `project_id` | `string` | Project ID（业务层边） |

## 输出

```typescript
interface APIRelationGraph {
  repo_id: string;
  project_id?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  
  // 自动发现的工作流
  discovered_workflows: Workflow[];
  
  // 统计
  stats: {
    total_nodes: number;
    total_edges: number;
    isolated_nodes: string[];  // 无关联的 API
  };
}

interface GraphEdge {
  source: string;        // 源 API ID
  target: string;        // 目标 API ID
  type: RelationType;
  confidence: number;    // 关联置信度
  evidence: string;      // 推断依据
}

type RelationType = 'depends_on' | 'follow_up' | 'alternative' | 'related';

interface Workflow {
  name: string;
  description: string;
  steps: string[];        // API ID 序列
  trigger: string;        // 触发入口
}
```

## 核心能力

### 1. 关联自动发现

| 信号 | 推断的关系 |
|------|-----------|
| Schema 字段引用 `$ref: '#/components/schemas/Order'` | `depends_on` (GET /orders/{id}) |
| 参数 `order_id` 存在于 path 中 | `depends_on` (创建订单的 API) |
| path 前缀相同 `/orders/...` | `related` |
| 同一 tag 下不同 method+相同 path | `alternative` (GET vs POST) |
| description 中提到 "after X, call Y" | `follow_up` |
| response 返回 `id` 字段，另一个 API path 包含 `{id}` | `follow_up` |

### 2. 工作流发现

自动识别调用链：

```
Create Order → Payment → Order Confirmation
  POST           POST         POST
  /orders       /payments    /orders/{id}/confirm
```

识别逻辑：
1. 找到所有 `follow_up` / `depends_on` 边
2. 检测链式结构（末端无出边 = 终点，无入边 = 起点）
3. 分组为命名工作流，默认命名为起点 API 的 tag

### 3. 手动关系编辑

- 允许人工添加/删除/修改边
- 人工关系优先级高于自动发现
- 人工修正记录为训练数据

## 行为规范

1. **可解释**：每条边附带 `evidence` 字段，解释推断依据
2. **保守连接**：`confidence < 0.5` 的边标记为"待确认"，不参与工作流发现
3. **增量更新**：新增/删除 API 时局部更新图谱，不重建全图

## 依赖

- 上游：OpenAPI Parser Service（技术层边）、Business Context Agent（业务层边）
- 下游：Knowledge Retrieval Service、Semantic Search Agent（启用后作为召回路径）

## 触发方式

- （启用后）API 导入完成后自动触发
- API 变更时增量更新
- 手动触发全量重建

## 边界情况

| 场景 | 行为 |
|------|------|
| 孤立 API（无关联） | 记录到 `isolated_nodes`，不影响其他 API |
| 循环依赖 | 检测并标记 `cyclic`，不阻断工作流分析 |
| 超大图（>1000 节点） | 默认只展示直接关联，需展开查看完整图 |
| API 被删除 | 移除对应节点，重连受影响边（orphan 边标记为 `broken`） |
