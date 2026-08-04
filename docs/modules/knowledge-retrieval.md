# Knowledge Retrieval Service

> **类型：Platform Service**（确定性逻辑，不需要 LLM）

## 定位

知识检索层核心模块。根据 API ID 聚合多方数据源，返回完整 API 知识卡片。本质是 SQL JOIN + 数据拼装，不涉及语言理解。

**知识卡片 = Repository 技术模型 + 能力上下文（repo 级）+ 使用上下文（project 级）。** API 属于某个 Repository（`repo_id`），能力上下文每个仓库一份；使用上下文挂在 Project（`project_id`）上、按 `(project, repo)` 各存一份——同一 API 在不同 Project 中的使用部分可不同。

## 输入

| 字段 | 类型 | 说明 |
|------|------|------|
| `api_id` | `string` | API 唯一标识 |
| `project_id` | `string` | 使用上下文所属 Project（必填，或默认取用户可访问的第一个项目） |
| `include_examples?` | `boolean` | 是否包含请求/响应示例，默认 true |
| `include_relations?` | `boolean` | 是否包含关联 API，默认 true |

## 输出

```typescript
interface APIKnowledgeCard {
  api_id: string;
  repo_id: string;
  project_id: string;
  
  // 基础信息
  method: string;
  path: string;
  summary: string;
  
  // 技术 Schema（来自 OpenAPI Parser）
  schema: {
    parameters: Parameter[];
    request_body?: SchemaDef;
    responses: Record<string, SchemaDef>;
    security: SecurityRequirement[];
  };
  
  // 能力上下文（来自 Business Context Agent，repo 级，V0）
  capability: {
    intent: string;
    constraints: BusinessRule[];
    side_effects: string[];
  };

  // 使用上下文（来自 Business Context Agent，project 级，V1+）
  usage?: {
    when_to_use: string[];
    when_not_to_use: string[];
    usage_policy: string[];
  };
  
  // 示例（来自 Business Context Agent）
  examples?: {
    request: Example[];
    response: Example[];
    errors: Example[];
  };
  
  // 关联 API（来自 Knowledge Graph Service，V1+ 可选）
  relations?: {
    depends_on: string[];       // 前置依赖 API
    follow_up: string[];        // 后继 API
    alternative: string[];      // 可替代 API
    related: string[];          // 相关 API
    workflow?: string;          // 所属工作流
  };
  
  // 版本信息
  version: {
    current: string;
    history: VersionEntry[];
  };
}
```

## 核心能力

### 1. 知识拼装

本 Service 本身不产生知识，而是从各上游组件聚合：

```
Knowledge Retrieval Service
        │
        ├── OpenAPI Parser Service      → schema（repo 级）
        ├── Business Context Agent      → business + examples（project 级）
        └── Knowledge Graph Service     → relations（V1+ 可选，启用后）
```

### 2. 按需裁剪

根据调用方需求选择性返回：
- 外部 Agent 调用：返回完整知识卡片
- 列表展示：仅返回 `method + path + summary + intent`
- 变更分析：仅返回 `schema + version`

### 3. 缓存策略

- 知识卡片缓存 5 分钟
- API 变更时主动失效对应缓存
- 热点 API（高频查询）预热缓存

## 行为规范

1. **一次请求，一次返回**：不发送多次事件，聚合后单次返回
2. **降级返回**：任一下游组件不可用时，缺失字段标记 `unavailable`
3. **延迟可控**：p50 < 50ms, p99 < 200ms

## 依赖

- 上游：OpenAPI Parser Service、Business Context Agent、Knowledge Graph Service（V1+ 可选）
- 下游：MCP Gateway、Web UI

## 触发方式

- MCP Gateway 调用 `get_api_detail` tool（含 `project_id`）
- Web UI API 详情页面
- Change Analysis Agent (V1) 获取变更基线

## 边界情况

| 场景 | 行为 |
|------|------|
| API ID 不存在 | 返回 `404`，附带最相似 API 的搜索建议 |
| 使用上下文尚未构建 | `usage` 字段返回 `undefined`，`needs_enrichment: true` |
| 关联 API 中部分已被删除 | `relations` 中过滤掉已删除 API，添加 `stale_refs` 提示 |
