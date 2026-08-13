# Async Queue & Notifications — 异步队列与消息通知

> **类型：Platform Service**（确定性逻辑；队列调度本身不需要 LLM）

## 定位

为长耗时操作（OpenAPI 导入、Business Context LLM 推理、批处理）提供统一的**异步任务**能力：

- HTTP 请求提交后立即返回 `taskId`，不阻塞；
- 任务由 Worker 后台执行，进度/结果可查询；
- 结果通过**站内消息通知**触达用户；
- 队列实现可配置（Postgres / Redis / RabbitMQ / SQS），业务代码零改动。

**分层原则：** 队列只负责**调度与投递**；任务业务状态（进度、结果、错误）由业务任务表（如 `repo_tasks`）持久化。`QueueProvider` 本身不做状态查询。

---

## 1. QueueProvider 接口

```ts
// packages/core/src/types/queue-provider.ts

export interface QueueJob {
  id?: string;
  name: string;
  data: unknown;
}

export interface QueueProvider {
  /** 入队一个任务，返回 job id */
  enqueue(queue: string, job: QueueJob): Promise<string>;

  /** 注册队列处理器 */
  process(queue: string, handler: (job: QueueJob) => Promise<void>): Promise<void>;

  /** 优雅关闭 */
  shutdown(): Promise<void>;
}
```

**实现清单：**

| Provider | 说明 | 适用场景 |
| --- | --- | --- |
| `PgQueueProvider` | Postgres 队列（V0 默认） | 本地开发 / 单实例，零新基础设施 |
| `BullmqQueueProvider` | BullMQ + Redis | 生产多实例 / 大流量 |
| `RabbitmqQueueProvider` / `SqsQueueProvider` | 复用已有基础设施 | 已有 RabbitMQ / AWS SQS |
| `InMemoryQueueProvider` | 进程内队列（不持久化） | 单元测试 |

---

## 2. PgQueueProvider（V0 默认实现）

复用现有 PostgreSQL，本地开发无需 Redis，任务可跨进程重启恢复。

### 2.1 表 `impl_queue_jobs`

> **命名约定**：`impl_` 前缀标记"某个具体实现方案（Implementation）专属的表"。`impl_queue_jobs` 是 Postgres 作为队列的临时方案表——将来切换到 BullMQ/Redis 后可整体废弃；业务任务表（`repo_tasks` / `notifications`）不加此前缀。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | job id（`job_` 前缀短 ID） |
| `queue_name` | varchar | 队列名（如 `openapi.import`） |
| `name` | varchar | 任务名 |
| `data` | jsonb | 任务 payload（业务数据先持久化，如 Spec 落盘路径） |
| `status` | queued / running / completed / failed | 状态 |
| `attempts` | int | 执行次数 |
| `error` | text | 失败原因 |
| `available_at` | timestamptz | 最早可执行时间（预留延迟） |
| `started_at` / `finished_at` | timestamptz | 执行打点 |
| `created_at` / `updated_at` | timestamptz | 时间戳 |

索引：`(status, available_at)`。

### 2.2 执行语义

- **入队**：`INSERT` 一行 `queued`（`enqueue` 返回 id）；任务 payload 由业务层先落库/落盘；
- **消费**：Worker 在事务内 `SELECT ... FOR UPDATE SKIP LOCKED` 抢占 `queued` 行 → 置 `running`（`attempts + 1`）→ 执行 handler → `completed` / `failed`；多实例不会重复消费同一任务；
- **失败**：`status = failed` + `error` 记录原因；重试由业务层基于已持久化的 payload 重新入队；
- **Worker 生命周期**：开发环境由 Next.js `instrumentation.ts` 启动进程内 Worker（轮询间隔默认 1s）；生产可拆独立进程；
- **重启恢复**：启动时把遗留 `running` 标记为 `failed(interrupted)`，避免僵尸任务；不自动重跑（防止重复快照）。

### 2.3 代码位置与 DI

- 实现：`packages/server/src/queue/`（依赖 `packages/server` 的 DB 访问）；
- 接入：Core Container 提供 `registerQueueFactory(name, factory)`，`packages/server` 导出 `registerQueueProviders(container)` 注册 `postgres → PgQueueProvider`；
- 应用启动时（`instrumentation.ts`）调用注册，业务代码只依赖 `QueueProvider` 接口。

---

## 3. 配置

```yaml
# apigent.config.yaml
queue:
  # "postgres"（V0 默认，复用现有 PG）| "bullmq" | "rabbitmq" | "sqs" | "memory"（测试）
  provider: postgres
```

| 场景 | 配置 | 说明 |
| --- | --- | --- |
| 本地开发 / 单实例（V0 默认） | `queue.provider: postgres` | 复用现有 PG，无新基础设施 |
| 生产多实例 / 大流量 | `queue.provider: bullmq` | BullMQ + Redis |
| 已有 RabbitMQ / SQS | `queue.provider: rabbitmq \| sqs` | 对应适配器 |
| 单元测试 | `queue.provider: memory` | `InMemoryQueueProvider` |

切换实现只改配置 + 注册对应工厂；业务任务表始终是事实源，UI 与业务代码零改动。

---

## 4. 消息通知（通用设计）

通知是独立于队列的**通用能力**：任何模块（导入、业务上下文、密钥、MCP、系统）都能写一条通知，不绑定具体业务。三个可读性字段支撑前端分组、排序与过滤：

- **`category`（业务分类）**：导入 / 业务上下文 / 密钥 / MCP / 系统，前端按此分组；
- **`priority`（优先级）**：high / medium / low，前端排序与视觉强调（失败、安全类为 high）；
- **`type`（事件类型）**：机器可读的事件名，决定 i18n 文案与跳转路由。

### 4.1 `notifications` 表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | 通知 ID（`noti_` 前缀短 ID） |
| `user_id` | text FK | 接收人 |
| `category` | varchar | 业务分类：`import` / `context` / `key` / `mcp` / `system`（前端分组与过滤） |
| `type` | varchar | 事件类型（机器可读）：`import.succeeded`、`import.failed`、`context.ready`… |
| `priority` | varchar | `high` / `medium` / `low`（排序 + 视觉强调） |
| `title_key` | varchar | i18n key（如 `notifications.import.succeeded`），**不存渲染后文案** |
| `title_params` | jsonb | i18n 插值参数（`{ repoName, version }`） |
| `payload` | jsonb | 跳转与上下文：`{ href, repoId, versionId, taskId }` |
| `metadata` | jsonb | 扩展元数据（`orgId`、`sourceTaskId` 等） |
| `read_at` | timestamptz null | 已读时间 |
| `expires_at` | timestamptz null | 过期时间（可选，防止通知无限堆积） |
| `created_at` | timestamptz | 创建时间 |

索引：`(user_id, read_at)` 未读角标；`(user_id, category, created_at)` 分组列表。

### 4.2 类型注册表（示例）

| category | type | priority | 触发场景 |
| --- | --- | --- | --- |
| `import` | `import.succeeded` | medium | OpenAPI 导入成功（跳转新版本） |
| `import` | `import.failed` | high | OpenAPI 导入失败（可重试） |
| `context` | `context.ready` | medium | 业务上下文生成完成 |
| `context` | `context.failed` | high | 业务上下文生成失败 |
| `key` | `key.created` | low | 新密钥创建 |
| `key` | `key.expiring` | high | 密钥即将过期 |
| `mcp` | `mcp.disabled` | high | MCP 被关闭（Agent 将不可访问） |
| `system` | `system.announcement` | low | 平台公告 |

新类型只需注册 i18n key + 跳转路由，通知服务与前端无需改动。

### 4.3 API 契约

| 接口 | 说明 |
| --- | --- |
| `GET /api/notifications?category=&unread=true&limit=50` | 列表，默认按 `priority desc, created_at desc` 排序 |
| `GET /api/notifications/unread-count` | 未读角标数 |
| `POST /api/notifications/:id/read` | 标记已读 |
| `POST /api/notifications/read-all` | 全部已读 |
| （V1）`GET /api/notifications/stream` | SSE 实时推送 |

### 4.4 前端呈现

- **顶栏铃铛**：下拉按 `category` 分组（导入 / 业务上下文 / 密钥 / MCP / 系统），组内按优先级排序，high 显示强调色点；未读角标取 `unread-count`；
- **点击通知**：跳转 `payload.href` 并标记已读；打开下拉时拉取最新列表；
- **设置页 · 通知偏好（V1）**：按分类控制是否接收、是否邮件推送、是否静默；
- **实时性**：V0 用轮询（打开下拉时刷新 + 未读数定期轮询）；V1 可升级 SSE。

### 4.5 扩展（V1+）

- **多通道分发**：统一 `NotificationService` 按偏好分发 in-app / email / webhook；
- **聚合降噪**：同类成功通知可聚合（如批量导入 N 个仓库合并为一条）；
- **生命周期**：按 `expires_at` 归档清理，避免无限堆积。

---

## 5. 业务任务：OpenAPI 异步导入

### 5.1 目标

V0 以同步接口 + 日志打点（`openapi.import.*`，含分段耗时与结果统计）作为基线；本设计升级为异步任务：

- 提交后立即返回 `taskId`，HTTP 请求不阻塞；
- 解析/落库由队列 Worker 后台执行；
- 进度与结果通过**顶栏消息通知** + **仓库状态徽章**可见；
- 失败可一键重试，无需重新上传文件。

### 5.2 `repo_tasks`（统一任务表，业务事实源）

导入与业务上下文生成共用一张 `repo_tasks`，用 `task_type` 区分；类型专属字段放 `payload` / `result` jsonb，通用状态列（status/progress/error/attempts/时间戳）共用。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | text PK | 任务 ID（对外即 `taskId`） |
| `job_id` | text | 关联 `impl_queue_jobs`（调度投递） |
| `repo_id` / `user_id` | text FK | 归属仓库与发起人 |
| `task_type` | varchar | `import` / `context` / `vectorize` / … |
| `status` | queued / running / succeeded / failed | 状态机 |
| `progress` | int | 0-100，供进度条展示 |
| `payload` | jsonb | 类型专属入参（import→`{specPath}`；context→`{trigger,endpointIds,force}`） |
| `result` | jsonb | 类型专属结果（import→stats/issues/nextVersion；context→reused/generated/failed 统计） |
| `version_id` | text | import→产出版本；context→目标版本 |
| `depends_on` | text | 同一 repo 的前置任务 id（顺序依赖） |
| `error` | text | 失败原因 |
| `attempts` | int | 重试次数 |
| `enqueued_at` / `started_at` / `finished_at` | timestamptz | 打点用 |

> 导入任务的 `spec_path` 存于 `payload`；提交时 Spec 原文已落盘，Worker 不依赖请求体。
> 任务结果通过**通用通知**触达用户（category=`import` / `context`，见 §4），通知服务与前端不感知任务细节。

### 5.3 状态机与执行流程

```
queued → running → succeeded
              ↘ failed → （重试）→ queued
```

```mermaid
flowchart LR
  A[POST /api/repos/:id/versions → 202 + taskId] --> B[事务: Spec 落盘 + 写 repo_tasks(import) queued + 入队]
  B --> C[Worker 抢占任务: FOR UPDATE SKIP LOCKED]
  C --> D[解析 → 计算版本号 → 快照落库 → 切换 current_version_id]
  D --> E[写通知 NotificationService + operation_logs]
  E --> F[前端轮询任务状态 → 进度/通知/徽章]
  D -.失败.-> G[status=failed + 错误详情 → 可重试]
```

**Worker 要点：**

- 提交阶段把 Spec 原文写入本地磁盘（`data/specs/{repoId}/{taskId}.json`），Worker 只拿路径干活，天然支持失败重试；
- 快照创建沿用现有事务逻辑（`repo_versions` + endpoints/data_models/modules/endpoint_modules/endpoint_responses，最后切换 `current_version_id` 指针），旧快照保留可回滚；
- 解析失败（文档级错误）置 `failed` 并携带 issues，单接口问题仍宽容处理；
- 启动时把遗留 `running` 标记为 `failed(interrupted)`，不自动重跑，避免重复快照。

### 5.4 API 契约

保持接口兼容（UX 稿 §4.4.1）：

| 接口 | 说明 |
| --- | --- |
| `POST /api/repos/:id/versions` | 提交导入，`202 Accepted` + `{ taskId, status: "queued" }`；同一 repo 已有 queued/running 任务时返回 `409`（防重复导入） |
| `GET /api/repos/:id/import-tasks/:taskId` | 查询任务状态/进度/结果（前端轮询，2s 间隔） |
| `POST /api/repos/:id/import-tasks/:taskId/retry` | 复用 `spec_path` 重新入队（失败重试，不要求重新上传） |

通知相关接口（列表 / 未读角标 / 已读）见 §4.3。

### 5.5 前端呈现

- **导入对话框**：确认后进入"任务已提交"态 → 轮询进度条 → 成功切到结果页（查看接口 / 生成密钥），失败展示原因 + 重试；
- **顶栏铃铛**：导入结果进入通用通知流（见 §4.4）；点击跳转仓库/版本；
- **仓库详情**：查询该 repo 最近任务，展示"导入进行中 / 导入失败（重试）"状态徽章；

---

## 6. 边界情况

| 场景 | 处理 |
| --- | --- |
| 重复提交 | repo 已有 queued/running 任务 → `409`，前端提示"已有导入进行中" |
| 失败重试 | 复用 `spec_path` 重新入队，不要求用户重新上传 |
| 并发安全 | `FOR UPDATE SKIP LOCKED` 保证同一任务只被一个 Worker 执行 |
| 进程重启 | 遗留 `running` → `failed(interrupted)`，保留手动重试 |
| 大文件 | 提交即落盘，Worker 从磁盘读取，不占内存 |

---

## 7. 实施顺序

1. drizzle 迁移：`impl_queue_jobs` + `repo_tasks` + `notifications`（通用表，含 category / priority / title_key / title_params）；
2. `packages/server`：`PgQueueProvider` + `NotificationService` + 导入执行器 + Worker 入口；
3. API 路由：提交（202）/ 任务状态 / 通知（列表、未读数、已读）/ 重试；
4. 前端：导入对话框进度、顶栏铃铛（分组 + 优先级）、仓库状态徽章；
5. 测试与冒烟。
