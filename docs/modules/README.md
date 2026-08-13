# Apigent Agent Architecture

> 🌐 Language: [English](./README.md) | [中文](./README.zh.md)

## 设计原则

**不是所有模块都是 Agent。** Apigent 的组件分为两类：

| 类别                 | 定义                            | 实现方式                    | 示例                             |
| -------------------- | ------------------------------- | --------------------------- | -------------------------------- |
| **Platform Service** | 确定性逻辑，不需要 LLM          | 普通代码（TypeScript 模块） | 解析 OpenAPI、存储图谱、聚合查询 |
| **AI Agent**         | 需要推理/理解/生成，由 LLM 驱动 | LLM + prompt + 工具调用     | 推断业务含义、理解搜索意图       |

只有当模块的核心任务**无法用确定性规则完成**时，才引入 Agent。解析器、存储层、数据聚合——这些用正常代码就能做好，加 LLM 只会变慢、变贵、变不可靠。

---

## 层级与粒度（Repository vs Project）

- **Organization（组织）**：顶层租户边界；Repository 归属 Organization
- **Repository（仓库）**：OpenAPI 技术资产与版本历史，是权限过滤的最小单元（`repo_id`）
- **Project（项目）**：独立业务实体，跨 Organization 聚合多个 Repository（多对多）；**使用上下文**（项目如何使用各 Repository 的能力）、项目成员与角色挂在 Project（`project_id`）。V0 仅定义模型，功能 V1+ 提供
- **能力上下文（V0）**：Repository 级，描述后端项目提供了哪些能力（意图、约束、副作用）——提供方视角，每个仓库一份
- 技术/权限层用 `repo_id`，业务/知识层用 `project_id`；双层规则：Project 成员只决定能否看到项目存在，仓库内容始终走 `repo:*` 权限

---

## 1. 架构全景

```
                      外部 Agent (Cursor / Claude / ...)
                                  |
                            MCP Protocol
                                  |
                    ┌─────────────┴─────────────┐
                    |       MCP Gateway          |  ← 协议服务器（非 Agent）
                    |   路由 / 鉴权 / 限流 / 会话  |
                    └─────────────┬─────────────┘
                                  |
              ┌───────────────────┼───────────────────┐
              |                   |                   |
    ┌─────────┴──────────┐  ┌────┴─────┐  ┌──────────┴──────────┐
    | Semantic Search    |  | Knowledge|  | Project Context     |
    | Agent (LLM)        |  | Retrieval|  | Service             |
    └────────────────────┘  | Service  |  └─────────────────────┘
                            └──────────┘
         ↑ AI Agent             ↑ Platform Service     ↑ Platform Service
                                  |
              ┌───────────────────┼───────────────────┐
              |                   |                   |
    ┌─────────┴──────────┐  ┌────┴─────┐  ┌──────────┴──────────┐
    | OpenAPI Parser     |  | Business |  | Knowledge Graph     |
    | Service            |  | Context  |  | Service (V1+ 可选)   |
    └────────────────────┘  | Agent    |  └─────────────────────┘
                            | (LLM)    |
                            └──────────┘
         ↑ Platform Service    ↑ AI Agent
                                  |
                            ┌─────┴─────┐
                            | PostgreSQL |
                            | + Vector DB|
                            └───────────┘
```

---

## 2. 组件清单

### Platform Service（确定性模块，普通代码）

| Service                                                 | 职责                                                                                                       | 为什么不需要 LLM                                       |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [OpenAPI Parser Service](./openapi-parser.md)           | 解析 OpenAPI JSON/YAML，生成结构化 API Model                                                               | 规范有明确的 JSON Schema，纯解析+验证逻辑              |
| [Knowledge Graph Service](./knowledge-graph.md)         | 构建 API 关联图谱（depends_on / follow_up 等）——**V1+ 可选增强，默认关闭**（`rag.knowledgeGraph.enabled`） | 基于 `$ref` 引用、路径模式、字段命名匹配——都是规则匹配 |
| [Knowledge Retrieval Service](./knowledge-retrieval.md) | 聚合多个来源的数据，返回完整 API 知识卡片                                                                  | SQL JOIN + 数据拼装，不涉及理解或推理                  |
| [Project Context Service](./project-context.md)         | 提取项目级约定（base_url、分页、认证）                                                                     | 从 OpenAPI 结构字段中提取，规则匹配，不需要推理        |
| [MCP Gateway](./mcp-gateway.md)                         | MCP 协议服务器：路由、鉴权、限流                                                                           | 协议适配和请求路由，纯工程逻辑                         |
| [Async Queue](./async-queue.md)                         | 异步任务调度（OpenAPI 导入等）+ 通用消息通知（分类/优先级）；`QueueProvider` 可配置（Postgres/BullMQ/SQS）   | 队列调度与状态机，确定性逻辑                           |

### AI Agent（LLM 驱动，真正需要推理）

| Agent                                                 | 版本 | 职责                                                                 | 为什么需要 LLM                                                        |
| ----------------------------------------------------- | ---- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Business Context Agent](./business-context.agent.md) | V0   | 推断**能力上下文**（repo 级，V0）与**使用上下文**（project 级，V1+）；技术设计见 [business-context.md](./business-context.md) | 自然语言描述 → 结构化业务知识，需要语义理解                           |
| [Semantic Search Agent](./semantic-search.agent.md)   | V0   | 理解自然语言查询意图，匹配最相关的 API                               | "查找退款相关的 API" → 需要理解"退款"对应哪些 API，语义而非关键词匹配 |
| Knowledge Assistant Agent                             | V1   | 对话式 API 知识问答                                                  | 多轮对话、模糊问题、需要推理                                          |
| API Generation Agent                                  | V1   | 从需求描述生成 API 设计                                              | 自然语言 → OpenAPI Schema                                             |
| Documentation Agent                                   | V1   | 生成/改进 API 文档                                                   | 需要理解 API 并生成人类可读的描述                                     |
| Change Analysis Agent                                 | V1   | 分析 API 变更影响                                                    | 需要推理变更的破坏性、影响范围                                        |

---

## 3. 组件数量对比

|                     | 之前（错误） | 之后（正确）                          |
| ------------------- | ------------ | ------------------------------------- |
| "Agent" 数量        | 7            | 2 (V0) + 4 (V1)                       |
| Platform Service    | 0            | 6（其中 Knowledge Graph 为 V1+ 可选） |
| MCP Gateway         | 归为 Agent   | 协议服务器                            |
| 需要 LLM 调用的组件 | 7（夸大）    | 2（精确）                             |

> V0 实际落地的 Platform Service 为 5 个（不含 Knowledge Graph）；KG 启用后作为第 6 个。

---

## 4. 核心协作流程

### 4.1 API 导入流程

```
用户上传 OpenAPI Spec
        |
        v
OpenAPI Parser Service       ← 确定性解析（无 LLM）
        |
        v
Business Context Agent       ← LLM 推断业务含义（唯一需要 AI 的步骤）
        |
        v
PostgreSQL + Vector DB       ← 持久化

（V1+ 可选：启用 Knowledge Graph 后，在持久化前构建关联图谱）
```

**LLM 调用次数：1 次**（仅 Business Context Agent），其余都是普通函数调用。

### 4.2 Agent 查询 API 流程

```
外部 Agent (Cursor/Claude)
        |
        v
MCP Gateway                  ← 协议路由（无 LLM）
        |
        ├── "search_apis"        → Semantic Search Agent (LLM)
        ├── "get_api_detail"     → Knowledge Retrieval Service (无 LLM)
        └── "get_project_context" → Project Context Service (无 LLM, V1+ 随 Project 提供)
```

**LLM 调用次数：仅 search_apis 触发 1 次**，其余查询走普通数据库。

### 4.3 退款场景完整调用链

```
User: "我需要实现订单退款功能"
        |
Cursor Agent (外部)
        |
MCP Request: search_apis("user refund order")
        |
Semantic Search Agent (LLM)     ← 1 次 LLM 调用
  - Embedding: "refund" + "order"
  - Top-3: [POST /orders/{id}/refund, GET /orders/{id}, POST /payments/refund]
        |
Cursor Agent (外部，选择最匹配的)
        |
MCP Request: get_api_detail("POST /orders/{id}/refund")
        |
Knowledge Retrieval Service (无 LLM) ← 纯 SQL 聚合
  - Schema: { order_id, amount, reason }
  - 业务规则: "仅可在支付后 7 天内申请"
  - 关联 API: [POST /payments/refund, GET /orders/{id}]
        |
Cursor Agent → 生成带业务规则校验的代码
```

**整个流程仅 1 次 LLM 调用**（search_apis 的语义匹配），其余全部是数据库查询和数据拼装。

---

## 5. V1+ Agent 规划

### 需要新增的 AI Agent

| Agent                   | 触发场景                                                | LLM 能力                         |
| ----------------------- | ------------------------------------------------------- | -------------------------------- |
| **Knowledge Assistant** | 开发者问 "这个项目有哪些支付相关 API？退款流程怎么走？" | 多轮对话、知识库 RAG             |
| **API Generation**      | "帮我设计一个优惠券系统的 API"                          | 自然语言 → Schema 生成           |
| **Documentation**       | API 变更后自动更新文档                                  | Schema + 业务规则 → 人类可读描述 |
| **Change Analysis**     | API 版本升级时分析影响                                  | Diff + 依赖图 → 影响范围推理     |

### 不需要 Agent 的 V1 功能

| 功能              | 实现方式                                    |
| ----------------- | ------------------------------------------- |
| OpenAPI 导入/导出 | OpenAPI Parser Service 扩展                 |
| Smart Mock 生成   | 规则引擎（Schema → 合理假数据），不需要 LLM |
| API 治理          | 规则校验（lint 规则匹配），不需要 LLM       |

---

## 6. MCP Tool 定义

```
Tool 1: search_apis        → Semantic Search Agent (LLM)
Tool 2: get_api_detail     → Knowledge Retrieval Service (无 LLM)
Tool 3: get_project_context → Project Context Service (无 LLM, V1+ 随 Project 提供)
```

---

## 7. 目录结构

文件命名约定：`.agent.md` 后缀 = AI Agent（LLM 驱动），其余为 Platform Service 或 Gateway。

```
docs/modules/
  README.md                        ← 本文件
  openapi-parser.md                ← OpenAPI Parser Service
  business-context.agent.md        ← Business Context Agent (LLM)
  business-context.md              ← Business Context 技术设计（任务/存储/API/UI）
  knowledge-graph.md               ← Knowledge Graph Service
  semantic-search.agent.md         ← Semantic Search Agent (LLM)
  knowledge-retrieval.md           ← Knowledge Retrieval Service
  project-context.md               ← Project Context Service
  mcp-gateway.md                   ← MCP Gateway
  async-queue.md                   ← Async Queue Service（异步任务 + 消息通知）
  agent-runtime.md                 ← Agent Runtime（AI SDK 流式对话 + client/server tools）
```
