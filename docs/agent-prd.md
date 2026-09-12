# Apigent Agent PRD（V0）

> **文档基线：** 对齐 `main` 分支 2026-09-12 的仓库现状。上一版（2026-09-05）落后于实现的部分已在本次更正，包括：API 分层、认证方案、版本化模型、通知 / RBAC、依赖与验收口径。
> **相关文档：** 产品愿景与路线图见 [blueprint.md](./blueprint.md)；架构与模块设计见 [tech-design.md](./tech-design.md)、[modules/README.md](./modules/README.md)；版本化模型见 [tech/import-version-branch.md](./tech/import-version-branch.md)。

## 1 项目概述

**定位**：面向 AI Agent 的 API 知识平台，为 API 补充业务上下文与语义知识，让 Agent 与开发者都能发现、理解、调用 API。

**V0 目标**：语义检索为核心卖点；最小闭环 —— 导入 → 语义检索 → 浏览 → 接入。

**当前进度（截至 2026-09-12）**

- 已闭环：认证 → 组织 / 仓库 → OpenAPI 导入（异步）→ 版本化（分支 / 快照）→ 接口 / 模型 / 组件浏览 → 业务上下文生成 → 通知。
- 进行中：语义检索（RAG 管线未接线：`knowledge_chunks` 表已建，embedding / pgvector 检索 / 重排未实现）。
- 未开始：MCP Gateway、Project、RAG 评测与可观测。

## 2 技术选型（以仓库现状为准）

### 采用

| 层                | 选型                                                                                                                             | 现状                                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Platform REST API | Next.js Route Handlers（`apps/platform/src/app/api/**`）+ `@apigent/server` 服务层，同进程调用                                   | 已实现（约 35 个路由文件）                         |
| 独立网关          | Hono（`apps/open`，:3002）                                                                                                       | 仅 `/` 与 `/health`；MCP 未挂载                    |
| Web 应用          | Next.js 15 App Router + React 19（Platform :3000 / Admin :3001）                                                                 | 已实现；`dev` 走 Turbopack                         |
| 前端              | TypeScript + Tailwind CSS v4 + shadcn/ui                                                                                         | 已实现                                             |
| 数据库            | PostgreSQL + Drizzle ORM（单个迁移 `0000_versioning_init`，含 pgvector 扩展）                                                    | 已实现                                             |
| 版本模型          | 内容寻址 branch / commit / blob：`versions` / `version_commits` / `version_entity_links`                                         | 已实现                                             |
| 向量 / 全文       | `knowledge_chunks` 含 `vector(1024)` + HNSW、`tsvector` + GIN                                                                    | 仅 schema；检索服务未接线                          |
| LLM               | Vercel AI SDK（`@ai-sdk/openai-compatible`）→ qwen（DashScope 兼容端点）；openai / ollama 可切换                                 | 已用于业务上下文与助手运行时；claude / gemini 抛错 |
| 队列              | Postgres 队列（`packages/server/src/queue/pg-queue.ts`）+ `repository_tasks`                                                     | 已实现；`memory` 仅测试；BullMQ / Redis 未实现     |
| 认证              | 自研 credentials + HMAC-SHA256 签名 HttpOnly Cookie（`apigent_session`）；计划引入 NextAuth 支持 GitHub/Google                   | 已实现；第三方登录未实现                           |
| 授权（租户）      | org_owner / org_admin / org_member + repo_owner / repo_admin / repo_member / repo_viewer（仓库目录全站可见，内容按仓库成员门禁） | 已实现（见 §6）                                    |
| 授权（平台）      | 独立体系：`admin_super`（平台管理员的管理者）+ 全局只读；预留 `admin_operator` / `admin_support`                                 | 已实现（`admin_members` + 能力映射 + 独立会话）    |
| API 密钥          | SecretKey（`api:*` / `mcp:*` scopes）                                                                                            | **仅 schema 与只读列表**；生成/校验/吊销未实现     |
| 通知              | 站内通知（category / priority / i18n key）+ 用户偏好                                                                             | 已实现                                             |
| i18n              | next-intl，zh / en，messages 按模块拆分                                                                                          | 已实现                                             |
| OpenAPI 文档      | zod + zod-openapi，`openapi:export` 导出 `apps/platform/openapi/platform.json`                                                   | 已实现（文档不运行时 serve）                       |
| 可观测            | pino 结构化日志 + reqId / taskId（AsyncLocalStorage）                                                                            | 已实现；指标 / 追踪未实现                          |
| RAG 检索管线      | 自研（VectorStore / EmbeddingProvider 接口 + AI SDK），不引入 LangChain                                                          | 接口与配置槽已就位，实现未接线                     |
| 生产构建          | `next build`（webpack）；dev 用 Turbopack；Hono 网关 tsx 直跑                                                                    | 已实现                                             |

### 不使用

- API 测试平台
- 完整 Mock 平台
- 企业权限系统
- 复杂 API 网关
- turborepo / nx 构建编排：**V0 不引入**；当出现多包生产构建且构建耗时成为瓶颈时，优先采用 turborepo（轻量、契合 pnpm；nx 仅在需要代码生成 / 脚手架时再考虑）
- Redis（V0；队列走 Postgres）
- NextAuth.js（认证自研，见上表）
- LangChain（RAG 自研）
- MCP（V1 提供；V0 仅配置槽 + 前端连接卡）

## 3 界面风格

### 交互与布局

- 技术基础：shadcn/ui + Tailwind v4
- 布局：侧栏 + 全局顶栏；仓库内为 rail 导航 + Tab 独立子路由
- 原则：一屏一任务、空状态即引导、主按钮唯一、先看后点
- HTTP 方法色标：GET 绿 / POST 蓝 / PUT 琥珀 / PATCH 紫 / DELETE 红
- 主题与语言：浅深色主题 / 中英双语（next-intl，`NEXT_LOCALE` cookie）
- 全局能力：AI 助手抽屉（⌘J / Ctrl+J）、通知铃铛（分组 + 优先级）

### 信息架构

- 仓库导航：rail + Tab + 独立子路由（可直达、可分享）
- 接口详情：内嵌分栏页（左接口列表 + 右详情面板），参考 APIFox 展示风格
- 版本与历史：`versions`（分支 / 回滚 / 对比）与 `history`（commit 流）为独立页
- 设置：按 section 分区路由

## 4 编码规范

- pnpm monorepo，TypeScript 严格模式
- 业务面向接口：DI 容器，不硬编码具体实现
- 契约：Platform REST 用 Next Route Handler + `withRoute` 包装（自动 reqId / 鉴权）+ zod 校验；OpenAPI 文档由 zod-openapi 生成，不运行时 serve
- 双层配置：yaml 选型 + .env 密钥
- barrel 导出，type / value 分离
- 开发无构建：tsx 直跑 `.ts`；生产构建 —— Next.js `next build`
- 中英 `.md` 文档与 `i18n/messages` 同步
- eslint + prettier

## 5 功能范围

### 包含

- 认证（注册 / 登录 / 会话）
- 组织 / 仓库管理、组织成员管理（Platform）
- 仓库成员管理（`repository_members`，Platform）
- 两套 RBAC：租户体系（org/repo）+ 平台体系（admin）
- OpenAPI 导入（异步、全量 / 增量两种模式、预览）
- 版本管理（分支 / 快照 / 回滚 / 对比 / 手动删除）
- 接口 / 模型 / 组件浏览
- 业务上下文生成（能力上下文，repo 级）
- 通知
- 操作审计（`operation_logs`，与业务写操作同事务）
- Admin 后台：平台管理员管理 + 全局只读（统计 / 审计）
- API 密钥（SecretKey）
- 语义检索（RAG，核心卖点）—— 进行中
- RAG 可观测性与离线评测 —— 设计完成，未实现

### 不包含

- Project 功能（V0 仅模型，未建表）
- MCP Gateway（V1 提供；V0 仅配置 + 连接卡）
- Admin 租户级管理（org/repo 成员与内容管理一律在 Platform，Admin 不做）
- 账号禁用 / 启用 / 删除（预留 `admin:users:disable` / `admin:users:delete`）
- 知识图谱（V1+ 可选，默认关闭）
- SSO
- 完整 Mock / 测试平台
- BullMQ / Redis（留待企业定制版）

## 6 已实现功能

### 已实现

- 配置 / DI
- Drizzle schema 与迁移
- OpenAPI 解析器（含单测）
- 异步导入管线（Postgres 队列 + `repository_tasks` + 通知 + 重试 + 预览）
- 版本化模型：内容寻址复用、全量（合并 / 同步）与增量（保留）导入、手动删除产生新 commit、回滚 / 激活、任意版本 diff、`versions` 与 `history` 页
- 业务上下文生成（AI SDK + qwen；任务复用、人工编辑保护、指纹）
- RBAC（组织角色 + 仓库成员；仓库目录全站可见、内容按"先仓库成员、后组织角色"判定，无角色一律 403；仓库级鉴权已覆盖全部 `repositoryId` 入口；Admin 体系仅设计，未实现）
- 仓库成员管理（`repository_members` 取代旧的 `repo_permissions`；仓库设置 → 成员：显式成员可增删改、组织隐含成员只读；创建仓库者自动成为 `repo_owner`）
- 通知（分类 / 优先级 / 偏好 / 未读角标）
- 认证（credentials + 签名 Cookie）
- Platform 各页（组织、仓库、定义、上下文、版本、历史、设置）
- AI 助手抽屉 + `/api/agent/run`（agent registry + 业务上下文工具）
- Admin 壳（audit / users / settings）
- Open 网关 health
- 结构化日志（reqId / taskId 贯穿）
- 中英 i18n（messages 按模块拆分）

### 未实现 / 待接线

- **鉴权的声明式收敛**：仓库级断言已落在每个路由入口（`apps/platform/src/lib/repo-guard.ts`），尚未收敛为 `withRoute({ repo: … })` 的声明式写法（见 tech-design §5.4.4）
- **端点 × 角色测试**：鉴权已有实现，但缺少表驱动的自动化覆盖（`apps/platform` 尚无测试基建）
- **Admin 功能面**：登录与门禁已实现（独立 cookie / 密钥 / `/login`）；门禁之后的仪表盘、审计、用户、管理员管理四个页面仍是占位
- **操作审计（部分落地）**：成员类事件（`member.*` / `repo.member_*` / `org.transfer`）与创建类事件（`org.create` / `repo.create`）已与业务写同事务落库，仓库设置页与组织详情 Tab 可查看；导入明细（`operation_log_details`）、仓库编辑 / 删除、版本设为当前 / 回滚、MCP、密钥、`admin.*` 仍未接线
- **SecretKey**：生成 / 校验 / 吊销均未实现；设置页按钮为禁用状态；无任何请求校验过 SecretKey
- **认证**：GitHub / Google 第三方登录
- 语义检索（RAG）：embedding provider、pgvector 检索、混合检索 + RRF、重排、查询改写；`knowledge_chunks` 表已建但无写入 / 检索服务
- MCP 挂载（V1 提供）
- Project
- RAG 可观测性与离线评测
- 知识图谱
- 指标 / 追踪（`observability.provider` 默认 `none`）
- claude / gemini provider

## 7 验收标准

1. `pnpm -r typecheck && pnpm -r lint` 0 错误；`pnpm -r test`（16 个 Vitest 测试文件）全绿。
2. dev 启动后 GET `:3002/health` 返回 `{status:"ok"}`；Platform `:3000` 可完成注册 → 登录 → 会话生效。
3. 导入成功率 ≥95%：固定 20 份 OpenAPI v3 样例全部走通，任务终态 `succeeded`，且版本头 commit 前进。
4. 版本化不变量：
   - 全量导入重复提交同一 spec，未变接口复用同一 `content_hash` 行（不产生新 blob）；
   - 增量导入只增 / 改，不删除缺席实体；全量导入删除缺席实体；
   - 手动删除接口 / 模型 / 组件产生新 commit，旧 commit 仍可回滚查看；
   - 任意两个 commit 可 diff，输出 added / updated / removed。
5. 语义检索达标（阈值待 RAG 接线后生效）：预置 20 条自然语言查询，Top-3 命中预期 API 数 ≥90%。
6. 业务上下文：`autoGenerate=true` 且有 `DASHSCOPE_API_KEY` 时，接口出现「已生成」徽章；人工编辑过的接口默认跳过（`skipHumanEdited`）。
7. 认证：注册 → 登录 → Session 生效。
8. 越权防护：非组织成员访问该组织的组织 / 仓库资源返回 403；只读用户执行写操作返回 403；任何已登录用户携带他人 `repositoryId`（含用别的仓库前缀请求任务详情 / 重试）的请求必须被拒绝。实现已落地（入口守卫 + 任务按仓库过滤），尚缺「端点 × 角色」表驱动测试。
9. 仓库成员管理：仓库目录对所有登录用户可见，但仓库内容严格按成员判定——无仓库角色且非组织管理员时返回 403。成员页能添加 / 改角色 / 移除显式成员，并把组织隐含成员单独标出；显式角色可以向下覆盖组织角色，非组织成员不可授予。
10. Admin 门禁（已实现）：仅 `admin_super` 可进入 Admin——独立 cookie（`apigent_admin_session`）+ 独立密钥（`auth.adminSecret`）+ token 的 `aud` 三重隔离，Platform 的会话进不来、Admin 的会话也不被 Platform 接受；`admin_super` 不持有任何 `repo:*` / `org:*` 能力，因此无法创建 / 修改仓库内容与组织 / 仓库成员；第一个管理员由 CLI 授予并写入 `admin.grant` 审计。门禁之后的页面（仪表盘 / 审计 / 用户 / 管理员管理）仍是占位。
11. 审计（成员类已实现，其余待接线）：成员与权限变更在**同一事务**内写入 `operation_logs`，写入失败时业务操作一并回滚——`recordOperation(tx, …)` 只接受事务句柄，因此不存在"业务成功、日志缺失"的写法。仓库设置 →「操作日志」与组织详情「操作日志」Tab 可读。尚未接线：导入 / 版本 / MCP / 密钥 / `admin.*`，以及导入明细表。
12. 界面：接口详情以内嵌分栏页呈现（参考 APIFox）；仓库导航 rail + Tab 子路由可直达；中英切换与深浅主题可用。
13. RAG 评测（未实现）：预置 20 条标注查询，hit@3 ≥90%、MRR ≥0.7、P95 查询延迟 ≤2s、无召回率（空结果 / 回退）<5%。
14. RAG 可观测（未实现）：每个查询记录改写输入输出、各阶段耗时、召回 / 重排分数、token 与成本；召回为空下钻到 fallback 标记。
15. 体验 KPI（非硬性）：首闭环 <10 分钟 —— 以「N 位新用户 ≥80% 在 10 分钟内完成注册 → 建组织 → 导入」衡量。

## 8 待与客户确认

1. RAG 评测集与阈值：20 条标注查询、hit@3 ≥90%、MRR ≥0.7、P95 ≤2s、无召回率 <5% 是否采纳？评测集由谁标注？
2. 导入样例集：20 份 OpenAPI v3 样例的来源与覆盖范围（文件 / URL / 版本）。
3. 体验 KPI：首闭环 10 分钟，样本量 N 与达成率阈值（≥80%？）。
4. 语义检索是否作为 V0 发布阻塞项：若 V0 必须交付检索，则 embedding provider 与 pgvector 检索应排最高优先级。
5. 版本化交互默认值：多版本管理默认隐藏、开启后才允许新建 / 切换分支（原 V1 技术方案设计，现已落地）是否保持？
6. 仓库成员是否允许**非组织成员**（访客）？本轮按建议限制为组织成员，`repository_members` 表结构已容得下，如需放开请告知。
7. `org:delete` / `repo:delete` / `repo:manage_mcp` 是否要在 V0 实现？文档已描述，但代码里分别是"没有端点""按钮 disabled""纯前端 state"。
8. `admin_super` 是否允许读取任意仓库的接口内容（`admin:content:read`）？建议默认不给。
