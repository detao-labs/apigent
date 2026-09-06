# Agent Runtime — AI 对话运行时与工具系统（技术设计）

> **状态：** 部分实现——agent registry 与业务上下文工具位于 `packages/core/src/agent`；完整的对话/规划运行时为设计，尚未实现。

> **状态：V0 设计稿（2026-08-13），评审通过后实施；本文档不修改任何代码。**
> **关联：** 业务上下文生成接入本运行时（[business-context.md](./business-context.md)）；批量生成的任务调度与通知复用 [async-queue.md](./async-queue.md)；LLM 配置见 `packages/core/src/config`。

## 定位

统一前后端的 AI 对话与工具执行运行时，支撑两种模式：

- **交互模式（前端编辑）**：用户点击"AI 生成"→ agent 读取页面上下文、后端补齐数据、生成草稿、**填充前端表单**，用户确认后保存；
- **自动模式（批量落库）**：生成结果直接（或经前端确认后）写入数据库，进度与结果通过消息通知触达。

**技术选型（已确认）：**

| 能力 | 方案 |
| --- | --- |
| 流式对话 | Vercel AI SDK v7（`useChat` + `streamText` + `toUIMessageStream` + `createUIMessageStreamResponse`） |
| 工具分层 | server tools 在 API route 的 `streamText({ tools })` 执行；client tools 经 `onToolCall` + `addToolOutput` 在浏览器执行，协议由 AI SDK 处理 |
| 提示词模板 | 轻量字符串模板 + zod 结构化输出校验，**不引入 LangChain** |
| LLM 接入 | `@ai-sdk/openai-compatible`，映射现有 `llm.provider` / `llm.models` 配置 |
| 工具定义共享 | `packages/core` 的 zod schema 注册表，前后端各自包装执行器 |

---

## 1. 架构与数据流

```
前端 (Next.js)
  useChat({ transport, onToolCall: clientToolDispatch })
        │  streamText 协议（tool 结果自动回传）
        ▼
  POST /api/agent/run  (route handler)
        ├─ server tools  → 后端直接执行（DB / Service，session + RBAC 校验）
        └─ 流式响应       → 打字机效果 + tool 状态展示

共享层 packages/core：AgentTool 定义（name / description / inputSchema zod）
```

**执行流程（交互模式示例）：**

```
1. 用户触发"AI 生成"
2. agent 调 get_page_context (client) → 拿到 repoId / endpointId / 表单草稿
3. agent 调 get_endpoint_spec (server) → 后端补齐技术模型（前端只有摘要）
4. agent 调 generate_context (server) → 生成结构化草稿（不落库）
5. agent 调 apply_edit_draft (client) → 草稿填充前端表单，用户可见可撤销
6. 用户确认 → 走普通表单提交（PUT API，edited_by_human = true）
```

**自动模式**仅第 4 步后改为 `save_business_context`（server）：落库 + `context.ready` 通知；或先展示 preview 卡片，用户点"确认应用"再保存。

---

## 2. 工具定义与注册

### 2.1 共享定义（packages/core）

```ts
interface AgentTool<Input, Output> {
  name: string;                 // 机器可读，如 get_endpoint_spec
  description: string;          // 给 LLM 看的用途说明
  inputSchema: z.ZodType<Input>;
  scope: "server" | "client";
}
```

注册表：`registerAgentTool(tool)` / `listAgentTools()`。server 启动时注册 server 实现，前端 hook 挂载时注册 client 实现；两边只共享 name / description / inputSchema，执行器各写各的。

### 2.2 执行器

- **server**：在 `/api/agent/run` 的 `streamText({ tools })` 中提供 `execute`，复用 `packages/server` 服务；入口统一做 session + RBAC + repo 权限校验；
- **client**：在 `useChat({ tools })` 中提供 `execute`，通过 React state / store 读写页面状态与表单草稿；
- 两侧执行器均以 zod schema 校验入参，拒绝不合法调用。

### 2.3 安全边界

- server tool 等价于普通 API 的权限面：必须校验当前用户对目标 repo 的访问权；
- client tool 只做页面态读写，不做任何持久化；
- 工具白名单：`/api/agent/run` 只暴露注册表内的工具，不接受任意工具名。

---

## 3. API 契约

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/agent/run` | 流式对话入口：接收 `messages` + 工具列表（由注册表决定），返回 `toUIMessageStreamResponse()` |
| POST | `/api/agent/run/:threadId` | 多轮会话续传（V1，可先无状态） |

请求体沿用 AI SDK `useChat` 默认协议；client tool 结果由 AI SDK 协议自动回传，无需自定义格式。

---

## 4. 工具集（业务上下文场景，V0）

| 工具 | scope | 输入 | 输出 | 说明 |
| --- | --- | --- | --- | --- |
| `get_page_context` | client | — | 当前 URL、repoId、endpointId、locale、表单草稿 | 给 LLM 前端视图 |
| `get_endpoint_spec` | server | repoId、endpointId | 完整技术模型（参数 / requestSchema / responses） | 后端补齐数据 |
| `generate_context` | server | repoId、endpointId | 结构化上下文草稿（§3.2 输出结构），**不落库** | 调用 `llm.models.business_context` |
| `apply_edit_draft` | client | draft 字段 | 填充结果 | 写入受控表单 state，可撤销 |
| `save_business_context` | server | repoId、endpointId、context | 落库结果 | 复用 business-context 保存逻辑 + 通知 |

**模式映射：**

| 模式 | 工具调用链 | 落库时机 |
| --- | --- | --- |
| 交互（编辑） | get_page_context → get_endpoint_spec → generate_context → apply_edit_draft | 用户点保存（普通表单提交） |
| 自动（确认） | get_page_context → get_endpoint_spec → generate_context → save_business_context | 用户确认 preview 后 |
| 自动（批量） | 不走 agent 运行时，直接走 async-queue 批量任务（business-context.md §3） | 任务完成即落库 |

---

## 5. 与既有模块的关系

- **business-context**：对话框内"生成"走交互模式（client 编辑）；批量生成仍走 `context_tasks` + 队列；两套共用 `business_contexts` 表与保存逻辑；
- **MCP Gateway（V1+）**：`get_endpoint_spec`、`save_business_context` 等 server tools 未来可从同一注册表暴露给 MCP；client tools 只活在浏览器会话，不进 MCP；
- **async-queue**：批量、耗时任务不占住对话流，仍由队列 worker 执行；agent 运行时只负责交互式短任务。

---

## 6. 边界情况

| 场景 | 行为 |
| --- | --- |
| client tool 执行失败（页面跳转 / 组件卸载） | 错误作为 tool 结果回传，agent 重试或终止 |
| server tool 权限不足 | 返回 403 结果（不泄露细节），agent 提示无权限 |
| 流式中断 / 重连 | 前端展示重试；无状态阶段从当前消息重发 |
| 工具循环上限 | 单次会话最多 N 轮（默认 8），超限终止并提示 |
| 表单编辑冲突 | `apply_edit_draft` 覆盖前备份草稿，前端提供"撤销" |
| LLM 输出非结构化 | zod 校验失败 → 要求模型重试一次，仍失败则报错 |

---

## 7. 实施顺序

1. **依赖与 provider 适配**：新增 `ai` + `@ai-sdk/openai-compatible`；把现有 `llm.provider` / `models` 配置适配为 AI SDK provider 实例（`LLMProvider.generate/chat` 保留给非流式场景）；
2. **共享注册表**：`packages/core` 新增 AgentTool 类型 + 注册表；
3. **API route**：`/api/agent/run`（`streamText` + server tools + 权限校验）；
4. **前端运行时**：`useChat` hook 封装（流式 UI + tool 状态 + client tools）；
5. **业务上下文工具集接入**：§4 五个工具 + 对话框集成；
6. **i18n + 测试**：zh/en 文案；工具校验、权限、循环上限单测。
