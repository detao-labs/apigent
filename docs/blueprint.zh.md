# Apigent 蓝图

> 🌐 Language: [English](./blueprint.md) | [中文](./blueprint.zh.md)

**Apigent**，发音 /ˈeɪ.pi.dʒənt/，是 "API for Agent" 的缩写，意为"面向 Agent 的 API"。

---

# 1. 项目概述

## 1.1 项目名称

- 名称: **Apigent**
- 仓库: `detao-labs/apigent`
- 许可证: MIT

## 1.2 一句话描述

> 一个为 API 注入业务上下文和语义知识的平台，通过 MCP 将 API 暴露给 AI Agent —— 让 Agent 能够在正确的时机发现、理解并调用正确的 API。

## 1.3 愿景

传统 API 平台是为人类开发者阅读文档而设计的。在 Agent 原生时代，API 需要被机器理解——具备业务含义、使用约束和语义关系，让 AI Agent 能够推理。

Apigent 构建这一知识层，使组织中的每一个 API 都成为可发现、可组合的能力单元，开发者和 Agent 都能使用。

## 1.4 核心理念

```
API Spec (OpenAPI)           ← 技术契约
业务知识                      ← 业务含义 + 使用规则 + 关联关系
使用洞察                      ← 示例 + 实际使用数据
        |
        v
Apigent 知识层
        |
        +-------------------+
        |                   |
   开发者              AI Agent
```

---

# 2. 产品定位

## 2.1 问题

当前 API 工具主要解决：

- API 文档
- API 测试
- 团队协作

然而，AI Agent 需要的不仅仅是 Schema：

- 这个 API 代表什么含义？
- 应该在什么场景下使用这个 API？
- 有哪些业务规则？
- 接下来应该调用哪些 API？

现有的 API 文档缺乏供 AI 消费的结构化业务知识。

---

## 2.2 解决方案

Apigent 提供：

- API 资产管理
- 业务上下文管理
- API 语义搜索
- 基于 MCP 的 Agent 访问
- AI 辅助的 API 理解

将 API 从静态文档转变为 Agent 可读的能力单元。

---

# 3. 核心原则

## 3.1 Agent 优先

所有 API 资产都应能被 AI Agent 理解和访问。

## 3.2 知识优于 Schema

OpenAPI 描述的是技术契约。

Apigent 在此基础上增加：

- 业务含义
- 使用场景
- 约束条件
- 关联关系

## 3.3 单一事实来源

同一份 API 知识应同时服务于：

- 开发者
- AI 编程 Agent
- 内部工具

---

# 4. 技术架构

## 4.1 高层次架构

```
                 AI Agent
            Cursor / Claude / 其他
                       |
                       |
                  MCP Server
                       |
                       |
              Apigent 核心平台
                       |
        --------------------------------
        |              |               |
     API 模型      知识层          RAG 层
        |
   PostgreSQL
```

---

## 4.2 技术栈

### 前端 / 全栈

- Next.js App Router
- TypeScript
- React

选择理由：

- 全栈开发体验
- 前后端统一架构
- 原生流式支持
- 强大的 TypeScript 生态

---

### 数据层

主要：

- PostgreSQL

可选：

- 向量数据库

用途：

- API 语义检索
- 业务上下文索引
- Agent 知识搜索

---

### AI 层

能力：

- RAG 检索
- MCP Server
- AI 辅助文档
- API 理解

---

# 5. 核心领域模型

## 5.1 Organization（组织）

代表顶层租户边界——公司、团队或业务单元。

- 组织成员拥有组织级角色（`org_owner` / `org_admin` / `org_member`）
- Repository 归属于某个 Organization
- 默认为单层（不嵌套）

## 5.2 Repository（仓库）

代表**一份 OpenAPI 文件**及其版本历史的技术资产容器。

- 必属且仅属一个 Organization
- 存放 OpenAPI 规范、导入的版本、解析出的 API 技术模型（method/path/schema）
- 是权限过滤的最小单元（`repo:*` 权限）
- Repository 只承载技术层；业务知识属于 Project

## 5.3 Project（项目）

代表业务层——一个 API 服务或业务系统。

示例：

```
电商订单系统
```

- 独立实体：**不挂靠在 Organization 下**
- 聚合一个或多个 Repository（多对多），可跨 Organization
- 包含项目基本信息、业务上下文、领域术语、项目约定，以及项目成员/角色（`project_owner` / `project_admin` / `project_viewer`）
- V0 仅定义模型；Project 功能在 V1+ 提供

---

---

## 5.4 API

代表一个独立的 API 能力。

包含：

- HTTP 方法
- 路径
- 请求 Schema
- 响应 Schema
- 业务描述
- 使用规则
- 示例
- 版本历史

示例：

```
POST /orders/refund
```

业务上下文：

```
退款仅可在支付后 7 天内申请。
```

---

## 5.5 API 关联关系

定义 API 之间的依赖和工作流。

示例：

```
创建订单
      |
      v
支付
      |
      v
订单确认
```

关系类型：

- depends_on（依赖）
- follow_up（后续）
- alternative（替代）
- related（关联）

---

# 6. MCP 能力设计

Apigent 为外部 AI Agent 提供 MCP 工具。

## 6.1 API 搜索

目的：

API 语义发现。

示例：

```
查找与用户退款相关的 API
```

---

## 6.2 API 详情查询

目的：

检索完整的 API 知识。

返回：

- Schema
- 业务规则
- 示例
- 关联 API

---

## 6.3 项目上下文查询

目的：

检索全局项目知识。

包括：

- 认证规则
- 领域概念
- 通用响应格式

---

# 7. 开发路线图

## V0 - API 知识基础

目标：

构建最小可用的 Agent 原生 API 知识平台。

功能：

- Organization / Repository 管理
- API 管理
- OpenAPI 导入/导出
- 业务上下文
- MCP Server
- 语义搜索
- 基础 AI 辅助

> 说明：Project 实体在领域模型中定义（见 5.3），但 V0 不实现其功能。

---

## V1 - AI 驱动的 API 工程

功能：

- Project 管理（基本信息、成员、跨 Repository 聚合）
- AI API 生成
- AI 文档改进
- API 变更分析
- 智能 Mock 生成
- API 知识助手


---

## V2 - Agent 工程平台

功能：

- API 工作流发现
- 代码生成
- 高级 MCP 工具
- Agent 可观测性
- API 治理


---

# 8. 非目标

为避免成为又一个传统 API 平台：

以下内容不是首要关注点：

- API 测试平台
- 完整 Mock 平台
- 企业权限系统
- 复杂 API 网关

Apigent 专注于：

> 让 API 能够被 AI Agent 理解和可用。

---

# 9. 成功指标

早期阶段：

- 开发者能够通过 MCP 连接 Cursor/Claude
- Agent 能够正确发现 API
- Agent 能够生成 API 集成代码
- API 上下文检索准确

长期：

Apigent 成为软件系统与 AI Agent 之间的知识层。

---

# 10. 开源策略

## 社区聚焦

目标用户：

- AI 应用开发者
- 全栈开发者
- 平台工程师
- Agent 工程实践者


## 生态方向

潜在包：

```
@apigent/core
@apigent/mcp-server
@apigent/sdk
@apigent/openapi-parser
```

---

# 11. 总结

Apigent 不是 API 文档的替代品。

它将 API 视为知识资产——而不仅仅是接口规范——让开发者和 AI Agent 对每个 API 的功能和使用方式拥有一致的理解。

其使命：

> 让每一个 API 都能被 AI Agent 理解、发现和使用。
