# Observability（日志 / 指标 / 追踪）

> **状态：V0 已实现 A+B（日志规范 + reqId/taskId 贯穿）；C（Metrics）与 D（Tracing）待实现**

## 选型结论（2026-09 确认）

- **采集/导出标准**：OpenTelemetry（Logs/Metrics/Traces 统一 API + OTLP 导出）。
- **自托管后端**：**SigNoz**（logs+metrics+traces+UI 一体化，一个 Docker/Helm）。
- **配置**：顶部新增 `observability` 块（`apigent.config.example.yaml`），`provider: none | otlp | langfuse | phoenix`，默认 `none`。secret 走 `.env`。
- **日志库**：已接入 **pino**（`packages/server/src/logging`），结构化 JSON lines + context 贯穿 + level 过滤；平台与 server 共享同一实例（AsyncLocalStorage）。
- **LLM/RAG 专项**（Langfuse / Phoenix）后置，作为产品增值，复用现有 `rag-observability.md`。

## 目标

让平台具备可观测性：日志可追溯、指标可量化、请求可串联。用于排查与定位问题（如导入失败、业务上下文生成错误、LLM 调用异常、队列阻塞、性能劣化）。

## 现状（V0 已做）

| 项 | 现状 |
| --- | --- |
| 结构化日志 | ✅ 统一结构性 logger（`packages/server/src/logging`，`platform/lib/logger` 复用同实例），`{ ts, level, event, reqId?, taskId?, ...context }` |
| 日志级别 | ✅ 由 `observability.logLevel` 控制（debug/info/warn/error），默认 info |
| 错误日志 | ✅ `logError(event, error, context)`（含 `name` / `message` / 可选 stack） |
| 业务打点 | ✅ 导入/上下文等关键节点 `logInfo/logError`（如 `openapi.import.*`） |
| 请求级贯穿 | ✅ `withRequestContext` 生成 reqId（导入提交路由已接入） |
| 任务级贯穿 | ✅ `withTaskContext` 带 taskId（导入 Worker 已接入） |
| Metrics | ❌ 无（无 Prometheus 指标、无计数器/直方图） |
| Tracing | ❌ 无（无 OpenTelemetry Trace / span 贯穿） |
| 采集/汇聚/导出 | ❌ 无（日志仅 stdout/stderr，未接日志系统 / SigNoz） |

## 缺口与落地步骤（分阶段，待讨论）

### 阶段 A · 日志规范统一 ✅（已实现）
- 统一字段：`ts / level / event` + 上下文 `reqId / taskId / userId / orgId / repoId`。
- 结构性 logger（`packages/server/src/logging`，引擎 **pino**），输出 JSON lines 到 stdout/stderr；调用点 `logInfo / logError` 签名不变。
- 采集 stdouts → SigNoz（Loki）；pino 自带 child/redact 能力可后续按需启用。

### 阶段 B · 请求/任务级贯穿 ✅（已实现，待铺开）
- HTTP 入口用 `withRequestContext` 生成 `reqId`；任务 worker 用 `withTaskContext` 带 `taskId`。
- 同一 AsyncLocalStorage 实例贯穿 platform 与 server（`platform/lib/logger` re-export server）。
- **已接入**：导入提交路由 + 导入 Worker（一次导入从提交→解析→落库→通知可串联）。
- **待铺开**：其余 API route 用同样方式包 `withRequestContext`；key 列表见「接入清单」。
- 接 OTel 时把 `reqId` 提升为 `traceId` 无缝演进。

### 阶段 C · Metrics
- 暴露 `/metrics`（Prometheus 格式）。
- HTTP 中间件：QPS、P50/P95 延迟、错误率。
- 领域计数：导入成功/失败、业务上下文生成成功/失败/耗时、队列积压、LLM 调用次数与耗时、token/成本。
- 可选：DB 连接池、查询耗时、矢量检索延迟。

### 阶段 D · Tracing（OpenTelemetry）
- 引入 `@opentelemetry/sdk-node` + exporter（OTLP / Jaeger）。
- 为 HTTP / DB / 队列 / LLM 调用加 instrumentations，建立 span 与父子关系，支持跨进程。
- 与 RAG 观测对接（[rag-observability.md](./rag-observability.md)：检索 trace、各阶段耗时、召回/重排分数、token 与成本）。

> 备注：当前日志已覆盖"事件发生 + 错误信息"；排查单次失败可用 `event` + `context`（如 `taskId` / `repoId`）在本地 grep。**指标与追踪**用于趋势、瓶颈与跨请求定位。

## 接入清单（阶段 B，已铺开）

全部 API route 用高阶 **`withRoute`**（`apps/platform/src/lib/route.ts`）统一接入：
`withRoute({ auth: true }, handler)` 自动生成 `reqId`、读 session 注入 `userId`、未登录返回 401；handler 不再手写 `getSessionUser` / `withRequestContext` 样板。涉及：

- 认证：`login` / `register` / `logout`
- 组织：`POST /orgs`、`PATCH /orgs/[id]`、`POST /orgs/[id]/transfer`
- 成员：`POST /orgs/[id]/members`、`PATCH|DELETE /orgs/[id]/members/[memberId]`
- 仓库：`POST /repos`、`PATCH /repos/[id]`
- 版本/导入：`POST /repos/[id]/versions`（导入）、`POST /repos/[id]/versions/[versionId]/activate`、`POST /repos/[id]/import-tasks/[taskId]/retry`、`POST /repos/[id]/imports/preview`
- 业务上下文：`POST /repos/[id]/contexts/generate`、`PUT /repos/[id]/contexts/[endpointId]`、`POST /repos/[id]/context-tasks/[taskId]/retry`
- Agent：`POST /api/agent/run`
- 通知 / 设置：`POST /api/notifications/read-all`、`POST /api/notifications/[id]/read`、`PATCH /api/settings/notification-preferences`

`withTaskContext` 已用于两个后台队列 Worker：

- `imports/worker.ts`（导入任务，`taskId`）
- `contexts/worker.ts`（业务上下文生成任务，`taskId`）

> 原则：会产生业务副作用 / 需要排障的 API 入口都包一层 `withRequestContext`；worker / 后台任务包 `withTaskContext`。纯只读 GET 查询不包裹（降低噪音）。

## 关联

- [rag-observability.md](./rag-observability.md) — RAG 专项可观测（V0 最后实现）
- `docs/modules/async-queue.md` — 队列执行打点
