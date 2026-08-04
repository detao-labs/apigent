# MCP Gateway

> **类型：协议服务器**（非 Agent，非普通 Service——MCP 协议适配层）

## 定位

Apigent 对外服务的唯一入口。实现 MCP (Model Context Protocol) Server，将平台内部的 Service 和 Agent 暴露给外部 AI Agent（Cursor、Claude 等）。本质是协议适配 + 路由 + 鉴权，不做 AI 推理。

## 架构

```
外部 Agent (Cursor / Claude / 自定义)
        |
   MCP Protocol (Streamable HTTP)
        |
MCP Gateway
        |
   Tool Router
        |
   ┌────┼────┬──────────────┐
   |    |    |              |
search  get  get_project   (未来 tools...)
apis   api  context
```

## 对外暴露的 MCP Tools

### Tool 1: `search_apis`

```
描述: 语义搜索 API。用自然语言描述意图，返回匹配的 API 列表。
输入:
  - query (string, required): 搜索意图描述
  - repo_id (string, optional): 限定仓库
  - project_id (string, optional): 限定项目（V1+；双层规则，仅返回用户有权限的 repo）
  - top_k (number, optional): 返回数量，默认 10
输出: { results: [{ api_id, path, method, summary, score, match_reason }] }
```

### Tool 2: `get_api_detail`

```
描述: 获取 API 完整知识卡片。包含 Schema、能力上下文、使用上下文、示例、关联 API。
输入:
  - api_id (string, required): API 标识
  - project_id (string, required): 使用上下文所属 Project（或默认取用户可访问的第一个项目）
  - include_examples (boolean, optional): 默认 true
  - include_relations (boolean, optional): 默认 true
输出: APIKnowledgeCard
```

### Tool 3: `get_project_context`

```
描述: 获取项目全局上下文。认证方式、领域概念、API 约定。
输入:
  - project_id (string, required)
输出: ProjectContext

（V1+ 提供，随 Project 实体实现）
```

## 核心能力

### 1. 协议适配

- 支持 MCP `initialize` → `tools/list` → `tools/call` 完整生命周期
- 传输层：Streamable HTTP（`@modelcontextprotocol/sdk`）——普通请求-响应，无 SSE / 长连接
- 错误处理：MCP 标准错误码映射

### 2. Tool 路由

- 接收 `tools/call` 请求 → 解析 tool name + arguments → 路由到对应下游组件
- 参数校验：在 Gateway 层进行 schema 校验，拦截无效请求
- 超时控制：下游 Agent 超时返回 MCP 错误而非挂起

### 3. 会话管理

- Streamable HTTP 无持久连接：按 API Key 维护逻辑会话（可选，V1+）
- 会话上下文：记录已查询过的 API，辅助理解后续查询
- 会话超时：30 分钟无活动自动失效

### 4. 限流与安全

- 每个 API Key rate limit：60 次/分钟
- API key 认证：外部 Agent 使用用户级 SecretKey（`apigent_sk_...`），按 `scopes` 控制工具访问，仓库内容仍走 `repo:*` 权限
- 审计日志：记录所有 MCP 调用

## 行为规范

1. **透明转发**：不修改下游组件返回的数据
2. **延迟敏感**：`search_apis`（fast 模式）p50 < 200ms、p99 < 500ms；deep 模式 p50 < 800ms、p99 < 1500ms；`get_api_detail` p50 < 100ms
3. **优雅降级**：下游 Agent 不可用时返回标准错误，不崩溃

## 依赖

- 下游：Semantic Search Agent、Knowledge Retrieval Service、Project Context Service（V1+，随 Project 提供）
- 外部依赖：无（完全自包含）

## 部署

```
开发/生产均使用 Streamable HTTP：
  开发: 本地启动 Hono 服务（端口 3002，路径 /mcp）
  生产: 通过反向代理暴露 HTTPS 端点（如 https://apigent.dev/mcp）
```

### 本地 MCP 配置示例

```json
{
  "mcpServers": {
    "apigent": {
      "type": "http",
      "url": "https://apigent.dev/mcp",
      "headers": {
        "Authorization": "Bearer <apigent_sk_your-key>"
      }
    }
  }
}
```

## 触发方式

- 外部 Agent 发起 MCP `tools/call` 请求
- 连接建立时自动注册（`initialize` → `tools/list`）

## 边界情况

| 场景 | 行为 |
|------|------|
| 无效 API Key | 返回 MCP 认证错误，不暴露内部信息 |
| 下游组件超时 | 返回 `timeout` 错误，附带建议（缩小查询范围等） |
| 并发调用同一工具 | 独立处理，无互相影响 |
| 下游返回空结果 | 正常返回空列表，不报错 |
