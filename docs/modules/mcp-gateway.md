# MCP Gateway

> **类型：协议服务器**（非 Agent，非普通 Service——MCP 协议适配层）

## 定位

Apigent 对外服务的唯一入口。实现 MCP (Model Context Protocol) Server，将平台内部的 Service 和 Agent 暴露给外部 AI Agent（Cursor、Claude 等）。本质是协议适配 + 路由 + 鉴权，不做 AI 推理。

## 架构

```
外部 Agent (Cursor / Claude / 自定义)
        |
   MCP Protocol (JSON-RPC over stdio/SSE)
        |
MCP Gateway Agent
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
  - project_id (string, optional): 限定项目
  - top_k (number, optional): 返回数量，默认 5
输出: { results: [{ api_id, path, method, summary, score, match_reason }] }
```

### Tool 2: `get_api_detail`

```
描述: 获取 API 完整知识卡片。包含 Schema、业务规则、示例、关联 API。
输入:
  - api_id (string, required): API 标识
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
```

## 核心能力

### 1. 协议适配

- 支持 MCP `initialize` → `tools/list` → `tools/call` 完整生命周期
- 传输层：stdio（本地 Agent）和 SSE（远程 Agent/Web）
- 错误处理：MCP 标准错误码映射

### 2. Tool 路由

- 接收 `tools/call` 请求 → 解析 tool name + arguments → 路由到对应下游 Agent
- 参数校验：在 Gateway 层进行 schema 校验，拦截无效请求
- 超时控制：下游 Agent 超时返回 MCP 错误而非挂起

### 3. 会话管理

- 每个外部 Agent 连接维护独立会话
- 会话上下文：记录已查询过的 API，辅助理解后续查询
- 会话超时：30 分钟无活动自动断开

### 4. 限流与安全

- 每个会话 rate limit：60 次/分钟
- API key 认证：外部 Agent 需持有项目 API key
- 审计日志：记录所有 MCP 调用

## 行为规范

1. **透明转发**：不修改下游 Agent 返回的数据
2. **延迟敏感**：search_apis p50 < 200ms, get_api_detail p50 < 100ms
3. **优雅降级**：下游 Agent 不可用时返回标准错误，不崩溃

## 依赖

- 下游：Semantic Search Agent、Knowledge Retrieval Agent、Project Context Agent
- 外部依赖：无（完全自包含）

## 部署

```
开发: stdio 模式，本地 MCP config 直接指向
生产: SSE 模式，通过反向代理暴露 HTTPS 端点
```

### 本地 MCP 配置示例

```json
{
  "mcpServers": {
    "apigent": {
      "command": "npx",
      "args": ["@apigent/mcp-server"],
      "env": {
        "APIGENT_API_KEY": "<your-api-key>",
        "APIGENT_BASE_URL": "https://apigent.dev"
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
| 下游 Agent 超时 | 返回 `timeout` 错误，附带建议（缩小查询范围等） |
| 并发调用同一工具 | 独立处理，无互相影响 |
| 下游返回空结果 | 正常返回空列表，不报错 |
