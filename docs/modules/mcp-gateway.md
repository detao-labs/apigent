# MCP Gateway

> **状态：** 仅设计——尚未实现。只存在配置（`mcp.path`、`mcp_enabled`）与 `mcp` 通知分类；尚无 `/mcp` 端点或工具注册。**暴露粒度与 `repo:manage_mcp` 的形态仍待定**（见下方「暴露粒度」）。

> **类型：协议服务器**（非 Agent，非普通 Service——MCP 协议适配层）
> **版本：V1**（V0 聚焦 Platform Webapp，不挂载 MCP；本文档为设计稿）

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
  - repositoryId (string, optional): 限定仓库
  - organizationId (string, optional): 限定组织
  - projectId (string, optional): 限定项目（V1+；双层规则，仅返回用户有权限的 repo）
  - topK (number, optional): 返回数量，默认取 fineRankTopK
  - mode ("fast" | "deep", optional): fast 跳过查询改写
输出: { results: [{ api_id, path, method, summary, score, match_reason }] }
```

> **命名（2026-09-22 定案）**：工具名 `snake_case`、**参数名 `camelCase`**。见
> [CLAUDE.md](../../CLAUDE.md) → External Surface Naming 与该规则在 [rag-package.md](./rag-package.md) §6.1 的说明。
> MCP 规范只约束工具名（字符集 / 长度 / server 内唯一），对大小写风格中立、对参数名未作规定。

### Tool 2: `get_api_detail`

```
描述: 获取 API 完整知识卡片。包含 Schema、能力上下文、使用上下文、示例、关联 API。
输入:
  - apiId (string, required): API 标识
  - projectId (string, required): 使用上下文所属 Project（或默认取用户可访问的第一个项目）
  - includeExamples (boolean, optional): 默认 true
  - includeRelations (boolean, optional): 默认 true
输出: APIKnowledgeCard
```

### Tool 3: `get_project_context`

```
描述: 获取项目全局上下文。认证方式、领域概念、API 约定。
输入:
  - projectId (string, required)
输出: ProjectContext

（V1+ 提供，随 Project 实体实现）
```

## 暴露粒度（已定方向，未实现）

讨论"整仓 / 部分接口 / Project 哪个作为暴露单位"之前，先把两个维度分开：

| 维度     | 取值                                             | 状态                    |
| -------- | ------------------------------------------------ | ----------------------- |
| 能力类型 | **检索知识**（search / detail / context）        | ✅ 已定，即本设计的形态 |
|          | 调用接口（每个 OpenAPI operation 变成一个 tool） | ❌ 划到 V2+             |
| 暴露单位 | 仓库（repo 级开关 + 继承成员权限）               | ✅ 推荐起点             |
|          | 接口级过滤（黑名单 / 标签）                      | 第二步，按需            |
|          | Project（跨组织聚合 + usage context）            | 随 V1 Project 提供      |

**"调用接口"是另一种产品，不要混进来。** 把 OpenAPI operation 变成 agent 可调用的函数，要解决"用谁的凭据去调上游 API、副作用谁承担、幂等与审批"——那是凭据代理的独立课题，与检索型的安全面完全不同。

**仓库是 scope，不是 tool。** 工具集是固定的（`search_apis` / `get_api_detail`，将来加 `get_project_context`）；仓库只决定"能看到哪些内容"。理由是不必引入第二套授权模型：key 是**用户级**的，仓库内容权限已由 `repository_members` + 组织隐含角色决定，两者相乘就等于"MCP 的可见范围 = 这个人能访问的仓库"。于是 `repo:manage_mcp` 退化成一个**布尔开关 + 连接信息卡片**，只回答"这个仓库允不允许被 MCP 检索"。

**接口级过滤留到真有诉求时再做。** 它的价值主要是排除敏感接口（内部管理端点、写操作、含敏感示例的接口），形式大概率是标签 / operationId 黑名单。检索型下"藏一个接口"的收益有限——检索不到基本就够，整仓不可访问才是硬边界。

**Project 是第二个 scope 维度，不替代 repo。** 按既定的双层规则，Project 成员身份只决定"能不能看到这个项目"，内容访问仍走 repo 权限；Project 只作为收窄器，并承载 `get_project_context` 要读的 usage context。

### 两个必须现在就记下的隐患

1. ~~**key 是"用户全权"。**~~ **已解决（迁移 0004）。** 密钥现在带 `repository_ids` 白名单：签发与编辑时可以从"自己有权访问的仓库"里多选，空 = 不限制。可见范围 = 用户权限 ∩ 白名单，只能收窄不能放大，服务端会校验选择范围。剩下的限制是**没有角色上限**——无法把一把属于 `repo_admin` 的 key 降成只读；若将来需要"给 agent 的 key 只读"，那是在白名单之外再叠一层上限判定。详见 tech-design §3.10。
2. **写操作是独立课题（V2+）。** 检索型天然只读；一旦要暴露调用能力，凭据代理、副作用、幂等、审批都需要单独设计。

另外，MCP 调用本身要留痕：`last_used_at` + 调用计数是底线；若要进 `operation_logs`，事件名（如 `mcp.call`）现在加进 `OPERATION_TYPES` 很便宜。

### 状态

**`repo:manage_mcp` 推迟实现**——它的形态取决于上面的选择，现在做只会返工。建议顺序：先做 Secret Key 的签发 / 列表 / 吊销（用户可见、可验证、无前置依赖），等这里的方向落定后再做仓库开关与 Gateway。

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

| 场景             | 行为                                            |
| ---------------- | ----------------------------------------------- |
| 无效 API Key     | 返回 MCP 认证错误，不暴露内部信息               |
| 下游组件超时     | 返回 `timeout` 错误，附带建议（缩小查询范围等） |
| 并发调用同一工具 | 独立处理，无互相影响                            |
| 下游返回空结果   | 正常返回空列表，不报错                          |
