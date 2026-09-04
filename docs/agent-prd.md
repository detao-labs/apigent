# Apigent Agent PRD（V0）

## 1 项目概述

**定位**：面向 AI Agent 的 API 知识平台，提供 API 语义检索与业务上下文，让 Agent 与开发者都能发现、理解、调用 API。

**V0 目标**：语义检索为核心卖点；最小闭环 —— 导入 → 语义检索 → 浏览 → 接入。

## 2 技术选型（严守）

### 采用

| 层 | 选型 |
| --- | --- |
| API 服务 | Hono |
| Web 应用 | Next.js（Platform / Admin） |
| 前端 | React + TypeScript |
| 数据库 | PostgreSQL + Drizzle |
| 向量存储 | pgvector（Milvus / Qdrant 预留） |
| LLM / Embedding / Rerank | Qwen（DashScope，三合一，统一平台；重排默认 `qwen3-rerank` API） |
| 队列 | Postgres（V0）；BullMQ 留待企业定制版 |
| 认证 | NextAuth.js |
| RAG 检索管线 | 自研（现有 VectorStore / EmbeddingProvider 接口 + AI SDK），不引入 LangChain |
| 生产构建 | Next.js 走 `next build`；Hono 网关用 esbuild 单文件打包 `dist`（生产不用 tsx）|

### 不使用

- API 测试平台
- 完整 Mock 平台
- 企业权限系统
- 复杂 API 网关
- turborepo / nx 构建编排：**V0 不引入**；当出现多包生产构建且构建耗时成为瓶颈时，优先采用 turborepo（轻量、契合 pnpm；nx 仅在需要代码生成 / 脚手架时再考虑）
- Redis（V0）
- MCP（V1 提供）

## 3 界面风格

### 交互与布局

- 技术基础：shadcn/ui + Tailwind
- 布局：侧栏 + 全局顶栏
- 原则：一屏一任务、空状态即引导、主按钮唯一、先看后点
- HTTP 方法色标：GET 绿 / POST 蓝 / PUT 琥珀 / PATCH 紫 / DELETE 红
- 主题与语言：浅深色主题 / 中英双语

### 信息架构

- 仓库导航：Tab + 独立子路由（可直达、可分享）
- 接口详情：抽屉形式，参考 APIFox 展示风格

## 4 编码规范

- pnpm monorepo，TypeScript 严格模式
- 业务面向接口：DI 容器，不硬编码具体实现
- Hono + zod-openapi 单一契约
- 双层配置：yaml 选型 + .env 密钥
- barrel 导出，type / value 分离
- 开发无构建：tsx 直跑 `.ts`；生产构建 —— Next.js `next build`，Hono 网关 esbuild 单文件 bundle（不用 tsx）
- 中英 `.md` 文档同步
- eslint + prettier

## 5 功能范围

### 包含

- 认证
- 组织 / 仓库管理
- OpenAPI 导入
- 接口 / 模型浏览
- 业务上下文生成
- 语义检索（RAG，核心卖点）
- RAG 可观测性与离线评测
- API 密钥
- 通知
- 管理后台

### 不包含

- Project 功能（V0 仅模型）
- MCP（V1 提供）
- 知识图谱
- SSO
- 完整 Mock / 测试平台
- BullMQ（留待企业定制版）

## 6 已实现功能

### 已实现

- 配置 / DI
- Drizzle 迁移与 schema
- OpenAPI 解析器（含单测）
- 异步导入管线
- 业务上下文生成
- credentials 会话
- Platform 各页
- Admin 壳
- Open 网关 health

### 未实现 / 待调整

- 语义检索（RAG）：embedding / pgvector 接线
- 接口详情：当前为内嵌面板，需改为抽屉（参考 APIFox）
- MCP 挂载（V1 提供）
- Project

## 7 验收标准

1. `pnpm -r typecheck && lint` 0 错误；`pnpm -r test`（13 套）全绿。
2. dev 启动后 GET `:3002/health` 返回 `{status:"ok"}`。
3. 导入成功率 ≥95%：固定 20 份 OpenAPI v3 样例全部走通，任务终态 `success` 且版本数 +1。
4. 语义检索达标：预置 20 条自然语言查询，Top-3 命中预期 API 数 ≥90%。
5. 业务上下文：`autoGenerate=true` 且有 `DASHSCOPE_API_KEY` 时，接口出现「已生成」徽章。
6. 认证：注册 → 登录 → Session 生效；密钥仅创建时展示一次。
7. 界面：接口详情以抽屉呈现（参考 APIFox）；仓库导航 Tab + 子路由可直达。
8. RAG 评测：预置 20 条标注查询，hit@3 ≥90%、MRR ≥0.7、P95 查询延迟 ≤2s、无召回率（空结果/回退）<5%。
9. RAG 可观测：每个查询记录改写输入输出、各阶段耗时、召回/重排分数、token 与成本；召回为空下钻到 fallback 标记。
10. 体验 KPI（非硬性）：首闭环 <10 分钟 —— 以「N 位新用户 ≥80% 在 10 分钟内完成注册 → 建组织 → 导入 → 生成密钥」衡量。

## 8 待与客户确认

1. RAG 评测集与阈值：20 条标注查询、hit@3 ≥90%、MRR ≥0.7、P95 ≤2s、无召回率 <5% 是否采纳？评测集由谁标注？
2. 导入样例集：20 份 OpenAPI v3 样例的来源与覆盖范围（文件 / URL / 版本）。
3. 体验 KPI：首闭环 10 分钟，样本量 N 与达成率阈值（≥80%？）。
