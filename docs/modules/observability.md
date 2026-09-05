# Observability（日志 / 指标 / 追踪）— 技术债记录

> **状态：V0 未实现（技术债，记录以便后续排查定位）**

## 目标

让平台具备可观测性：日志可追溯、指标可量化、请求可串联。用于排查与定位问题（如导入失败、业务上下文生成错误、LLM 调用异常、队列阻塞、性能劣化）。

## 现状（V0 已做）

| 项 | 现状 |
| --- | --- |
| 结构化日志 | ✅ 最小 JSON lines logger（`packages/server/src/logger.ts`、`apps/platform/src/lib/logger.ts`），`console` 输出 `{ ts, level, event, ...context }` |
| 错误日志 | ✅ `logError(event, error, context)`（含 `name` / `message`） |
| 业务打点 | ✅ 导入/上下文等关键节点 `logInfo/logError`（如 `openapi.import.*`） |
| Metrics | ❌ 无（无 Prometheus 指标、无计数器/直方图） |
| Tracing | ❌ 无（无 OpenTelemetry Trace / span 贯穿） |
| 采集/汇聚/导出 | ❌ 无（日志仅 stdout/stderr，未接日志系统） |
| 请求级可观测 | ❌ 无 request_id / trace_id 贯穿 |

## 缺口与落地步骤（分阶段，待讨论）

### 阶段 A · 日志规范统一（低成本，建议先做）
- 统一字段：`ts / level / event` + 常见上下文 `requestId / taskId / repoId / userId`。
- 升级 `console` → `pino`（或保留 console 但严格统一格式），业务调用点不变。
- 采集：stdout/stderr → Loki / 云日志，支持按 `event` / `repoId` / `taskId` 检索。
- 原则：结构化、单行 JSON、可 grep、可聚合。

### 阶段 B · 请求/任务级贯穿
- 平台 HTTP 入口（layout / route 中间件）生成 `requestId`；任务 worker 生成 `taskId`。
- 注入 logger context 与通知 payload；跨模块用 `requestId` 串联（一次导入的解析→落库→通知）。
- 后续接 OTel 时把 `requestId` 提升为 `traceId`，无缝演进。

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

## 关联

- [rag-observability.md](./rag-observability.md) — RAG 专项可观测（V0 最后实现）
- `docs/modules/async-queue.md` — 队列执行打点

> 备注：当前日志已覆盖"事件发生 + 错误信息"；排查单次失败可用 `event` + `context`（如 `taskId` / `repoId`）在本地 grep。缺的是**指标与追踪**，用于趋势、瓶颈与跨请求定位。
