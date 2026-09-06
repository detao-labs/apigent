# Business Context — 业务上下文生成与编辑（技术设计）

> **状态：** 部分实现——上下文服务与 agent 工具位于 `packages/server/src/contexts` 与 `packages/core/src/agent/business-context-tools.ts`。

> **状态：V0 设计稿（2026-08-13），评审通过后实施；本文档不修改任何代码。**
> **关联：** Agent 行为规范见 [business-context.agent.md](./business-context.agent.md)；任务调度与通知复用 [async-queue.md](./async-queue.md)；交互式生成接入 [agent-runtime.md](./agent-runtime.md)；配置的 LLM 部分见 `packages/core/src/config`。

## 定位

把 OpenAPI 技术模型转化为**可被 AI Agent 消费的业务知识**，落库为 endpoint 级业务上下文，并向上聚合为 Repository 级能力快照：

- **endpoint 级（事实源）**：每个接口一份 `capability_name / intent / constraints / side_effects / usage_scenarios`，可由 LLM 生成、人工编辑；
- **repo 级（聚合快照）**：`repositories.capability_context`，由接口级结果规则聚合，供概览页与后续语义搜索/MCP 使用。

核心决策（已确认）：

| 决策点 | 结论 |
| --- | --- |
| 触发方式 | 自动触发**默认关闭**（`businessContext.autoGenerate: false`）；手动触发始终可用 |
| 版本复用 | 技术指纹相同（接口未变更）时复用上一版上下文，不重复调用 LLM |
| UI 形态 | **全局对话框**（URL 驱动 + 命令式 API），从概览/接口列表/详情/通知等入口携带参数打开；`repos/[id]/context` 保留为聚合管理列表 |

---

## 1. 领域模型与存储

### 1.1 `business_contexts` — endpoint 级事实源（已有表，需迁移补列）

现有字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | `ctx_` 前缀 |
| `endpoint_id` / `version_id` | text | 唯一索引 `(endpoint_id, version_id)` |
| `capability_name` | varchar | 能力名称，如"订单退款" |
| `intent` | text | 能力意图 |
| `constraints` | jsonb | 结构化约束数组 |
| `side_effects` | text | 副作用（**建议迁移为 jsonb 数组**，与 constraints/usage_scenarios 一致） |
| `usage_scenarios` | jsonb | 使用场景数组 |
| `generated_by` | varchar | ai / human / reused |
| `generated_at` / `updated_at` | timestamptz | 时间戳 |

迁移补列：

| 新字段 | 类型 | 说明 |
| --- | --- | --- |
| `confidence` | numeric | 自动推断置信度 0-1；人工编辑后置 1 |
| `needs_review` | boolean | 默认 false；`confidence < minConfidence` 时 true |
| `edited_by_human` | boolean | 人工编辑标记，默认 false |
| `edited_at` | timestamptz | 最近一次人工编辑时间 |
| `source_context_id` | text | 版本复用时指向上一版 context 行（快照溯源） |
| `fingerprint` | varchar | 生成时接口的技术指纹（见 §2），用于复用比对 |

### 1.2 `repo_tasks` — 统一任务表（import / context 共用）

生成任务不新建表，与导入共用 `repo_tasks`（`task_type = "context"`）；调度投递仍走 `impl_queue_jobs`。
类型专属字段放 `payload` / `result` jsonb，通用状态列共用：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | `task_` 前缀 |
| `job_id` | text | 关联 `impl_queue_jobs`，入队后回填 |
| `repo_id` / `version_id` | text | 针对哪个仓库、哪个版本生成 |
| `user_id` | text | 触发者（自动触发时为导入用户） |
| `task_type` | varchar | `import` / `context` / … |
| `status` | varchar | queued / running / succeeded / failed |
| `progress` | int | 0-100，按已处理接口数 |
| `payload` | jsonb | `{ trigger: auto\|manual, endpointIds?, force? }` |
| `result` | jsonb | 统计：`{ total, processed, reused, generated, failed }` |
| `depends_on` | text | 自动触发时指向导入任务 id |
| `error` | text | 不可恢复错误 |
| `attempts` | int | 重试次数 |
| `enqueued_at` / `started_at` / `finished_at` | timestamptz | 执行打点 |

索引：`(repo_id, status)`、`(user_id, created_at desc)`、`(task_type, status)`。

> 未来向量化 / 变更分析等版本级任务沿用同一张表：新增 `task_type` + payload/result 解析即可，不建新表（依赖用 `depends_on` 表达）。

### 1.3 `repositories.capability_context` — repo 级聚合快照

由生成任务结束时**规则聚合**（不额外调用 LLM）：

```json
{
  "summary": "订单系统提供支付、退款、对账等 12 项能力",
  "capabilities": ["支付", "退款", "对账"],
  "stats": {
    "endpointCount": 12,
    "generatedCount": 10,
    "reusedCount": 2,
    "needsReviewCount": 1,
    "failedCount": 0
  },
  "confidence": 0.78,
  "versionId": "ver_1iMVHtEuYH",
  "generatedAt": "2026-08-13T09:00:00.000Z",
  "source": "aggregate"
}
```

聚合规则（V0）：`capabilities` 去重收集接口级 `capability_name`；`summary` 由能力名 + 统计拼接；置信度取接口级均值。人工可整体覆盖 `summary`（`source: manual`）。

---

## 2. 版本复用（技术指纹）

**目标：** 导入新版本时，未变更的接口不重复调用 LLM，直接复用上一版上下文（快照复制）。

**指纹输入**（归一化后 `JSON.stringify` → SHA-256）：

```
operationId（存在时）+ method + path
+ summary + description
+ parameters（ref 已解析）
+ requestSchema（ref 已展开）
+ 全部 response schema（按 statusCode + contentType 排序）
```

**匹配流程**（任务执行第一步，生成前）：

1. 以上一版 endpoints 建映射：`key = operationId ?? ${method} ${path}`；
2. 遍历当前版 endpoints：
   - key 相同 **且** fingerprint 相同 → **复用**：INSERT 新行（新 `ctx_` id、当前 endpoint/version），复制旧行内容，`generated_by = 'reused'`、`source_context_id = 旧行 id`；
   - key 相同 **但** fingerprint 不同 → 变更接口 → 待生成；
   - key 不存在 → 新增接口 → 待生成；
3. 上一版对应接口无 context（如首次导入或从未生成过）→ 不产生复用，归入待生成。

复用发生在**任务执行时**而非导入时：自动生成开启时，导入成功后创建任务；关闭时由手动触发创建任务，两者共用同一分析逻辑。

---

## 3. 生成执行

### 3.1 触发

- **自动**：`businessContext.autoGenerate: true` 时，OpenAPI 导入成功后自动创建 `repo_tasks`（`task_type=context`、`trigger: auto`、`depends_on` 指向导入任务），不阻塞导入；失败不影响导入结果，通过通知提示；
- **手动**：概览卡片"重新生成"、接口列表/详情操作、对话框内"生成/重新生成"，均可创建任务（`trigger: manual`）。

### 3.2 LLM 输出结构（结构化输出）

每批输入 `batchSize` 个接口（method / path / summary / description / parameters / requestSchema / responses），要求返回：

```json
{
  "endpoints": [
    {
      "endpoint_key": "POST /orders/{id}/refund",
      "capability_name": "订单退款",
      "intent": "处理已支付订单的退款申请，校验通过后创建退款单",
      "constraints": [
        { "type": "precondition", "rule": "订单状态必须为已支付" },
        { "type": "time_limit", "rule": "支付成功后 7 天内可申请" }
      ],
      "side_effects": ["创建退款单", "原路退回资金", "发送退款通知"],
      "usage_scenarios": ["用户在订单详情页发起退款"],
      "confidence": 0.82,
      "needs_review": false
    }
  ]
}
```

`constraints.type` 枚举：`precondition` / `time_limit` / `permission` / `format` / `business_rule` / `other`。

### 3.3 执行细节

- **分批**：`batchSize`（默认 5）个接口一个 prompt；**并发**：`concurrency`（默认 2）个批次并行；
- **跳过人工编辑**：默认跳过 `edited_by_human = true` 的接口（`skipHumanEdited: true`）；`force` 时覆盖并提示前端确认；
- **写入**：每接口结果 upsert `business_contexts`，随后 `progress = processed / total`；
- **部分失败**：接口级失败记入 `result.failed`，任务仍 `succeeded`（主体完成），通知文案含失败数，可重试失败接口；
- **全部完成**：规则聚合 `capability_context` → 发 `context.ready` 通知；
- **模型**：复用 `llm.provider` 与 `llm.models.business_context`（见 §4）。

---

## 4. 配置

```yaml
# apigent.config.yaml — 新增 businessContext 段
llm:
  provider: qwen          # 复用现有 LLM 配置
  models:
    business_context: qwen3.7-plus

businessContext:
  autoGenerate: false     # 默认关闭：导入后不自动生成，手动触发始终可用
  batchSize: 5            # 每批接口数
  concurrency: 2          # 并行批数
  minConfidence: 0.6      # 低于此值 needs_review = true
  language: auto          # auto（跟随 spec 描述语言）| zh | en
  skipHumanEdited: true   # 重新生成时跳过人工编辑过的接口
```

对应类型与 schema：`packages/core/src/config/types.ts` / `schema.ts` 新增 `BusinessContextConfig`，随配置文档与 example 同步更新。

---

## 5. API 契约

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/repos/:repoId/contexts/generate` | 手动触发；body `{ endpointIds?: string[], force?: boolean }`，空数组 = 全仓库；返回 202 `{ task }` |
| GET | `/api/repos/:repoId/context-tasks/latest` | 最近任务（前端轮询，2s） |
| GET | `/api/repos/:repoId/context-tasks/:taskId` | 任务状态/进度/统计 |
| POST | `/api/repos/:repoId/context-tasks/:taskId/retry` | 重试失败接口（或全量，`force` 覆盖人工编辑） |
| GET | `/api/repos/:repoId/contexts?status=&endpointId=` | endpoint context 列表（含接口信息 + 状态徽章所需字段） |
| GET | `/api/repos/:repoId/contexts/:endpointId` | 单接口详情（技术信息 + context） |
| PUT | `/api/repos/:repoId/contexts/:endpointId` | 保存人工编辑，`edited_by_human = true`、`confidence = 1`、`needs_review = false` |
| POST | `/api/repos/:repoId/contexts/:endpointId/generate` | 单接口生成（复用同一任务机制） |

复用导入的**重复任务保护**：同仓库存在 running/queued 的 context 任务时返回 409。

---

## 6. 全局对话框与 UI

### 6.1 URL 驱动 + 命令式 API

- 全局对话框容器挂在 authed layout；命令式入口 `openBusinessContext({ repoId, endpointId? })`；
- 打开时同步写入 URL：`?dialog=business-context&repo=repo_xxx[&endpoint=api_yyy]`（`router.replace`，不产生历史记录）；关闭时清除参数；
- 页面加载时读 searchParams 恢复对话框（刷新不丢、可分享深链、浏览器前进后退可用）。

### 6.2 对话框内容

- 头部：`POST /orders/{id}/refund` + repo 名 + 版本 + 状态徽章（未生成 / 生成中 / 已生成 / 待审阅 / 失败）；
- 主体：`capability_name` / `intent` / `constraints`（结构化行，可增删）/ `side_effects` / `usage_scenarios`，全部可编辑；
- 信息栏：confidence、generated_by（ai / human / reused）、edited_at；
- 底部：保存 / 重新生成（覆盖人工编辑前二次确认）/ 关闭；
- 未生成空态：展示"生成"按钮触发单接口任务；生成中展示进度。

### 6.3 入口（携带参数打开）

| 入口 | 参数 |
| --- | --- |
| repo overview 能力卡片 | repo 级聚合视图，可切换接口 |
| 接口列表每行（操作菜单） | 直接定位 endpoint |
| endpoint 详情面板操作按钮 | 直接定位 endpoint |
| 通知（`context.ready` / `context.failed`）点击 | 定位 repo（含失败任务时定位任务） |
| context 管理页行点击 | 直接定位 endpoint |

### 6.4 context 管理页（保留 `repos/[id]/context`）

聚合列表（按 tag/module 分组，与接口列表一致），每行展示状态徽章与能力名；点击行打开全局对话框编辑。适合接口较多的仓库，对话框内不做长列表浏览。

---

## 7. 通知

复用通用通知（category `context`，已有）：

| type | priority | payload | 文案 |
| --- | --- | --- | --- |
| `context.ready` | medium | `{ repoId, versionId, generatedCount, reusedCount, failedCount }` | 业务上下文生成完成（含失败数时提示部分失败） |
| `context.failed` | high | `{ repoId, taskId, error }` | 生成失败，可重试 |

---

## 8. 边界情况

| 场景 | 行为 |
| --- | --- |
| 无 operationId | key 用 `method + path` |
| spec 无 description | 仅基于 path/schema 推断，confidence 低 → needs_review |
| 非中英文描述 | 按 `language` 配置处理，默认跟随 spec 语言 |
| 接口删除 | 旧版 context 随版本快照保留，当前聚合不含 |
| LLM 超时 / JSON 解析失败 | 该接口标记失败，任务可重试（只重试失败接口） |
| 人工编辑后重新生成 | 默认跳过；`force` 覆盖（前端二次确认） |
| 首次导入（无上一版） | 无复用，全量生成 |
| 自动生成失败 | 不阻塞导入；发 `context.failed`，可从仓库页重试 |
| 同一接口多版本 | 快照语义：每版一行，复用行可溯源（source_context_id） |

---

## 9. 实施顺序

1. **配置**：`businessContext.*` 类型 + schema + loader + example（纯数据，无依赖）；
2. **LLM client 抽象**：`packages/core` 新增 `LLMProvider` 接口 + openai-compatible 实现（覆盖 qwen/gemini/ollama），结构化 JSON 输出——当前只有配置类型，**这是所有 AI 功能的前置依赖**；
3. **迁移**：`repo_tasks` 统一任务表 + `business_contexts` 补列 + `side_effects` 改 jsonb（已并入 0001）；
4. **server**：context 服务（创建/查询/重试、指纹复用分析、聚合快照）+ worker（分批 LLM 执行）；
5. **API 路由**（§5）；接入通知（§7）；
6. **UI**：全局对话框 + 各入口 + context 管理页改造；
7. **i18n + 测试**：zh/en 文案；指纹复用、聚合、executor 单测。
