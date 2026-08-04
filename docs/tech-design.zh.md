# Apigent 技术设计

> 🌐 Language: [English](./tech-design.md) | [中文](./tech-design.zh.md)

本文档涵盖 Apigent 的平台层技术设计——即 Web 应用、领域模型以及 API 知识引擎之外的用户端功能。API 知识引擎的设计详见 [blueprint](./blueprint.md) 和 [modules/](./modules/)。

---

# 1. 产品架构

Apigent 由三个应用层组成：

```
                          外部 AI Agent
                       (Cursor / Claude / ...)
                                |
                           MCP Protocol
                                |
┌───────────────────────────────┼───────────────────────────────┐
│                      MCP Gateway                              │
│                    （协议服务器）                                │
└───────────────────────────────┼───────────────────────────────┘
                                |
                    Apigent Core API 层
                                |
            ┌───────────────────┼───────────────────┐
            |                   |                   |
    ┌───────┴───────┐   ┌───────┴───────┐   ┌───────┴───────┐
    │ Platform      │   │ Admin         │   │ Core Engine    │
    │ Webapp        │   │ Webapp        │   │ (Services +    │
    │ (Next.js)     │   │ (Next.js)     │   │  AI Agents)    │
    └───────────────┘   └───────────────┘   └───────────────┘
                                                    |
                                              PostgreSQL
                                              + Vector DB
```

- **Platform Webapp** — 面向开发者的主应用，用于管理 API
- **Admin Webapp** — 面向平台管理员的后台
- **Core Engine** — API 知识流水线（OpenAPI Parser → Business Context Agent → Knowledge Graph → MCP Gateway），详见 [docs/modules/](./modules/)

---

# 2. 核心领域模型

## 2.1 实体概览

```
┌──────────┐     ┌──────────────┐     ┌────────────────┐
│   User   │────→│  TeamMember  │←────│     Team       │
└──────────┘     └──────────────┘     └────────────────┘
     │                                      │
     │  ┌──────────────────┐               │
     ├──│  SecretKey       │               │
     │  └──────────────────┘               │
     │                               ┌─────┴──────┐
     │  ┌──────────────────┐        │ Repository  │
     └──│  RepoPermission  │←──────→│  (一个仓库 = │
        └──────────────────┘        │  一个项目)   │
                                    └─────────────┘
                                           │
                                    ┌──────┴──────┐
                                    │   OpenAPI   │
                                    │  Versions   │
                                    └─────────────┘
```

## 2.2 User（用户）

代表一个注册用户账号。

| 字段 | 类型 | 说明 |
|-------|------|------|
| `id` | UUID | 唯一标识 |
| `email` | string | 登录邮箱（唯一） |
| `password_hash` | string | 密码哈希 |
| `sso_providers` | string[] | 绑定 SSO 账号（github、google） |
| `name` | string | 显示名称 |
| `avatar_url` | string | 头像 URL |
| `created_at` | timestamp | 注册时间 |
| `updated_at` | timestamp | 最后更新时间 |

## 2.3 Team（团队）

组织单元。用户先创建 Team，再在 Team 下创建 Repository。

| 字段 | 类型 | 说明 |
|-------|------|------|
| `id` | UUID | 唯一标识 |
| `name` | string | 团队显示名称 |
| `slug` | string | URL 友好的唯一标识 |
| `owner_id` | UUID | 创建者 |
| `created_at` | timestamp | 创建时间 |

## 2.4 TeamMember（团队成员）

关联用户与团队及其角色。

| 字段 | 类型 | 说明 |
|-------|------|------|
| `user_id` | UUID | 用户引用 |
| `team_id` | UUID | 团队引用 |
| `role` | string | 角色标识（详见 [2.8 RBAC 模型](#28-rbac-模型)） |

**团队级角色：**

| 角色 | 范围 | 概述 |
|------|------|------|
| `team_owner` | Team | 完全控制：删除团队、管理成员、管理所有仓库 |
| `team_admin` | Team | 管理成员、管理团队内所有仓库 |
| `team_member` | Team | 根据仓库级角色分配访问仓库 |

## 2.5 Repository（仓库）

核心组织单元。**一个仓库对应一个后端项目的 OpenAPI 文件。**

| 字段 | 类型 | 说明 |
|-------|------|------|
| `id` | UUID | 唯一标识 |
| `team_id` | UUID | 所属 Team |
| `name` | string | 仓库名称 |
| `description` | string | 仓库描述（支持 LLM 辅助生成） |
| `openapi_versions` | Version[] | OpenAPI 版本历史 |
| `current_version` | string | 当前活跃版本标识 |
| `mcp_enabled` | boolean | 是否开启 MCP 服务 |
| `created_at` | timestamp | 创建时间 |
| `updated_at` | timestamp | 最后更新时间 |

**版本管理：**

- 每次导入自动创建新版本（根据 OpenAPI `info.version` 自动识别）
- 版本历史记录，支持版本间 diff 对比
- 支持回滚到历史版本
- 支持导出任意版本的 OpenAPI JSON/YAML

## 2.6 RepositoryPermission（仓库权限）

针对特定仓库的用户角色。设置后**覆盖**从 Team 级角色继承的默认权限。

| 字段 | 类型 | 说明 |
|-------|------|------|
| `user_id` | UUID | 用户引用 |
| `repo_id` | UUID | 仓库引用 |
| `role` | string | 仓库级角色标识（详见 [2.8 RBAC 模型](#28-rbac-模型)） |

**仓库级角色：**

| 角色 | 能力 |
|------|------|
| `repo_admin` | 管理权限、配置 MCP、删除仓库、导入版本 |
| `repo_editor` | 编辑 API 描述、导入新版本 |
| `repo_viewer` | 查看 API、模型和描述 |

## 2.7 SecretKey（密钥）

用户级 API Key，用于 MCP 访问。外部 AI Agent 使用此密钥通过 MCP Gateway 鉴权。

| 字段 | 类型 | 说明 |
|-------|------|------|
| `id` | UUID | 唯一标识 |
| `user_id` | UUID | 所属用户 |
| `name` | string | 密钥名称（可读） |
| `key_hash` | string | 密钥哈希（原始密钥仅在创建时展示一次） |
| `key_prefix` | string | 前 8 个字符用于识别（如 `apigent_sk_...`） |
| `scopes` | string[] | 权限范围：`mcp:read`、`mcp:search` |
| `last_used_at` | timestamp | 最后使用时间 |
| `expires_at` | timestamp | 过期时间（可选） |
| `created_at` | timestamp | 创建时间 |

## 2.8 RBAC 模型

Apigent 采用正式的基于角色的访问控制（RBAC）模型。**角色**是**权限**的命名集合。用户通过被分配角色来获得权限——在 Team 级、Repository 级或 Platform 级。

### 2.8.1 角色定义

| 角色 ID | 级别 | 说明 |
|---------|------|------|
| `team_owner` | Team | 完全控制 Team 及其所有仓库 |
| `team_admin` | Team | 管理成员和团队内所有仓库 |
| `team_member` | Team | 基础团队成员；仓库访问取决于仓库级角色 |
| `repo_admin` | Repository | 完全控制特定仓库 |
| `repo_editor` | Repository | 编辑 API 描述、导入新版本 |
| `repo_viewer` | Repository | 只读访问 API 和模型 |
| `platform_admin` | Platform | 跨 Team 管理员访问（Admin Webapp） |

### 2.8.2 权限枚举

| 权限 | 级别 | 说明 |
|------|------|------|
| `team:manage_members` | Team | 邀请、移除和修改成员角色 |
| `team:delete` | Team | 删除 Team |
| `team:manage_settings` | Team | 编辑 Team 名称、slug 和设置 |
| `repo:read` | Repository | 查看 API、模型和描述 |
| `repo:write` | Repository | 编辑 API 描述和业务上下文 |
| `repo:import` | Repository | 导入新 OpenAPI 版本 |
| `repo:delete` | Repository | 删除仓库 |
| `repo:manage_permissions` | Repository | 分配和修改仓库用户角色 |
| `repo:manage_mcp` | Repository | 开启/关闭 MCP、配置工具暴露范围 |
| `mcp:search` | MCP | 访问 `search_apis` 工具 |
| `mcp:detail` | MCP | 访问 `get_api_detail` 工具 |
| `mcp:context` | MCP | 访问 `get_project_context` 工具 |
| `admin:manage_users` | Platform | 查看、禁用、启用、删除用户账号 |
| `admin:view_stats` | Platform | 查看平台统计数据 |
| `admin:view_audit` | Platform | 查看审计日志和安全事件 |

### 2.8.3 角色 → 权限映射

| 角色 | 权限 |
|------|------|
| `team_owner` | `team:*`、`repo:*`（该 Team 所有仓库） |
| `team_admin` | `team:manage_members`、`team:manage_settings`、`repo:*`（该 Team 所有仓库） |
| `team_member` | `repo:read`（仅在分配了仓库级角色的仓库） |
| `repo_admin` | `repo:*`（特定仓库） |
| `repo_editor` | `repo:read`、`repo:write`、`repo:import` |
| `repo_viewer` | `repo:read` |
| `platform_admin` | `admin:*`、跨 Team 只读访问 |

### 2.8.4 继承与覆盖规则

```
Team 角色 (team_owner / team_admin / team_member)
        │
        ├──→ 默认仓库级权限从 Team 角色继承
        │      team_owner  → repo_admin（所有仓库）
        │      team_admin  → repo_editor（所有仓库）
        │      team_member → repo_viewer（所有仓库）
        │
        └──→ 可按仓库覆盖 (Override)
               例：一个 team_member 在仓库 X 被指定为 repo_admin
                   则该成员对仓库 X 拥有完全控制权，对其他仓库仍为 viewer
```

**规则：**

1. 用户对某仓库的**有效权限**取以下两者中较高的：继承自 Team 角色的权限 **或** 显式分配的仓库级角色
2. `platform_admin` 对所有 Team 和仓库有只读权限（用于审计），但除非被显式添加为成员，否则不能修改
3. MCP 工具受 Secret Key `scopes` 控制——即使用户拥有 `repo:read`，其 Secret Key 也必须具有 `mcp:*` 范围才能通过 MCP 调用工具

---

# 3. Platform Webapp

面向开发者的主应用，用于管理 API 知识资产，使其可被 Agent 发现和使用。

## 3.1 认证系统

| 功能 | 说明 |
|------|------|
| **邮箱注册** | 邮箱 + 密码注册，邮箱验证 |
| **邮箱登录** | 邮箱 + 密码登录，Session 管理 |
| **SSO 登录** | GitHub OAuth、Google OAuth |
| **密码重置** | 通过邮箱重置密码 |
| **Session 管理** | 基于 JWT 的会话管理，Refresh Token，登出 |

## 3.2 用户配置

| 功能 | 说明 |
|------|------|
| **个人资料编辑** | 名称、头像、简介 |
| **安全设置** | 修改密码、管理 SSO 绑定 |
| **通知偏好** | 邮件通知设置 |

## 3.3 团队管理

| 功能 | 说明 |
|------|------|
| **创建团队** | 填写名称 + slug，创建者自动成为 Owner |
| **邀请成员** | 通过邮箱邀请，指定角色 |
| **成员列表** | 查看所有成员及其角色 |
| **角色管理** | Owner/Admin 可修改成员角色 |
| **退出/移除** | 成员可主动退出；Owner/Admin 可移除成员 |

## 3.4 首页 Dashboard

登录后展示：

- **仓库概览**：跨 Team 的仓库列表，显示最后更新时间和 API 数量
- **最近活动**：最近的导入、编辑、成员变更
- **快捷操作**：创建 Team、创建仓库、导入 OpenAPI
- **全局搜索**：跨仓库搜索 API

## 3.5 仓库管理

### 3.5.1 创建与导入

| 操作 | 说明 |
|------|------|
| **创建仓库** | 填写名称 + 可选描述 |
| **导入 OpenAPI** | 上传 JSON/YAML 文件，或从 URL 获取 |
| **自动识别版本** | 从 OpenAPI `info.version` 字段提取版本号 |
| **校验** | 导入前验证 Spec 合法性，展示错误信息 |

### 3.5.2 内容展示

仓库内容支持两种浏览视图：

**接口视图（Endpoints View）：**
- 按 tag 分组列出所有 API 接口
- 每个接口展示：HTTP 方法、路径、摘要、业务意图（来自 Business Context Agent）
- 点击展开：请求/响应 Schema、业务规则、示例、关联 API

**数据模型视图（Data Models View）：**
- 列出 OpenAPI 中定义的所有 Schema/Component
- Schema 树形可视化：字段类型、约束、描述
- 交叉引用：哪些接口使用了该模型

### 3.5.3 版本管理

| 功能 | 说明 |
|------|------|
| **版本列表** | 完整导入历史 + 时间戳 |
| **版本 Diff** | 任意两个版本的并列对比 |
| **版本回滚** | 回退到历史版本 |
| **导出** | 下载任意版本的 OpenAPI JSON/YAML |

## 3.6 API 搜索与知识检索

面向开发者的 API 发现和理解入口。详细检索架构和 RAG 流水线设计见 Agent 实现文档，本节仅做功能级概要描述。

### 3.6.1 V0 — 语义搜索

| 功能 | 说明 |
|------|------|
| **全局搜索栏** | Dashboard 和仓库页面均可使用，自然语言输入 |
| **混合搜索** | Embedding（Dense）+ BM25（Sparse）+ Knowledge Graph——RRF 融合 + Cross-encoder 精排。详见 [Semantic Search Agent](./modules/semantic-search.agent.md) |
| **权限感知** | 基于 RBAC effective permissions 检索前过滤——用户只能搜到有权限访问的 API |
| **搜索范围** | 全局搜索（跨所有有权限的仓库）或限定单个仓库/Team |
| **筛选条件** | 按 HTTP 方法、tag、路径前缀过滤 |
| **结果展示** | 方法 + 路径、业务意图摘要、匹配原因、相关度评分 |
| **快捷跳转** | 点击结果 → API 详情页 |

**实现方式：** [Semantic Search Agent](./modules/semantic-search.agent.md)——与 MCP `search_apis` 共用同一引擎。每次查询 LLM 调用 ≤1 次（query rewriting 可选；检索步骤为确定性操作）。

### 3.6.2 V1 — RAG 知识问答

基于 RAG 的对话式 API 知识问答。

| 功能 | 说明 |
|------|------|
| **对话式问答** | 多轮对话，可自然追问 |
| **RAG 流水线** | Query Rewriting → 权限预过滤 → 混合检索（Embedding + BM25 + KG）→ RRF 粗排 → Cross-encoder 精排 → 上下文拼装 → LLM 回答生成 |
| **来源引用** | 每个回答附带引用链接，指向具体的 API 和模型 |
| **知识范围** | 单个仓库内，或跨 Team 仓库 |

**检索实现详见：** [Semantic Search Agent](./modules/semantic-search.agent.md) 涵盖 chunk 策略、BM25 + Embedding 混合检索、query rewriting、权限过滤、两阶段排序的完整设计。

---

## 3.7 Agent 辅助编辑

| 功能 | 说明 |
|------|------|
| **增强接口描述** | LLM 根据路径、方法和 Schema 生成/改进 API 描述 |
| **增强仓库描述** | LLM 根据 API 列表生成仓库概览 |
| **Diff 展示** | AI 建议应用前，展示修改内容的并列对比 |
| **接受/拒绝** | 用户逐条确认或拒绝修改建议 |
| **手动修改** | 用户可在此基础上手动调整 |

这是**用户主动触发**的 LLM 调用，独立于导入时的自动 Business Context 推断。

## 3.8 权限控制

Apigent 的 RBAC 模型（定义见 [2.8 RBAC 模型](#28-rbac-模型)）在 Platform Webapp 中通过以下交互体现：

### 3.8.1 Team 级角色管理

| 功能 | 说明 |
|------|------|
| **角色分配** | 邀请成员或编辑已有成员时，分配 Team 角色：`team_owner`、`team_admin`、`team_member` |
| **角色继承** | Team 角色自动授予该 Team 下所有现有及未来仓库的对应仓库级权限 |
| **角色变更** | Team Owner/Admin 可随时修改成员角色 |
| **转让所有权** | Team Owner 可将所有权转让给其他成员 |

### 3.8.2 仓库级角色覆盖

| 功能 | 说明 |
|------|------|
| **按仓库覆盖** | 在任何仓库上，可将 `team_member` 提升为 `repo_admin` 或 `repo_editor`，无需改变其 Team 角色 |
| **覆盖展示** | 仓库成员列表同时显示继承角色和显式覆盖（带视觉标记） |
| **有效权限** | 每个仓库取继承权限和覆盖权限中较高者 |

### 3.8.3 权限场景示例

| 场景 | 设置 | 效果 |
|------|------|------|
| **新成员加入** | 邀请为 `team_member` | 可查看所有仓库（继承 `repo_viewer`），但不可编辑 |
| **提升为编辑者** | `team_member` + 仓库 A 覆盖为 `repo_editor` | 可编辑仓库 A，其他仓库仍为 viewer |
| **外部协作者** | 非 Team 成员，仅分配仓库 B 的 `repo_viewer` | 只能查看仓库 B，无法访问其他仓库 |
| **MCP 访问** | 仓库 C 的 `repo_admin` + Secret Key 具有 `mcp:*` 范围 | 可对仓库 C 使用 MCP 工具 |

## 3.9 MCP 设置

| 功能 | 说明 |
|------|------|
| **按仓库开关** | 为每个仓库独立开启/关闭 MCP 访问 |
| **访问范围控制** | 控制暴露哪些工具：`search_apis`、`get_api_detail`、`get_project_context` |
| **用量监控** | 按 Key 查看 MCP 调用次数和历史 |
| **连接信息** | 展示 MCP 端点 URL，用户配置到 Cursor/Claude 中 |

## 3.10 Secret Key 管理

| 功能 | 说明 |
|------|------|
| **生成 Key** | 创建新 API Key，指定名称和权限范围 |
| **查看 Key 列表** | 展示所有 Key 的前缀、范围、创建/过期时间 |
| **原始 Key 展示** | 完整 Key 仅在创建时展示一次（安全最佳实践） |
| **轮换 Key** | 生成新 Key、废弃旧 Key |
| **删除 Key** | 立即吊销 Key |
| **用量追踪** | 最后使用时间、调用次数 |

Key 格式：`apigent_sk_<random_hex>`

---

# 4. Admin Webapp

独立的管理后台应用，仅管理员可访问。

## 4.1 认证

| 功能 | 说明 |
|------|------|
| **管理员登录** | 独立于 Platform Webapp 的认证流程 |
| **管理员权限检查** | 仅具有 `admin` 标记的用户可访问 |
| **Session 隔离** | 管理员 Session 与 Platform Session 独立 |

## 4.2 仪表盘与统计

| 指标 | 说明 |
|------|------|
| **用户数** | 注册用户总数、新增用户（日/周） |
| **团队数** | 团队总数、活跃团队数 |
| **仓库数** | 仓库总数、已开启 MCP 的仓库数 |
| **API 数量** | 全平台 API 端点总数 |
| **MCP 用量** | MCP 调用总量、按仓库、按 Key、时间序列 |
| **活跃用户** | DAU/WAU/MAU 统计 |

## 4.3 用户管理

| 功能 | 说明 |
|------|------|
| **用户列表** | 可搜索、可筛选的全量用户列表 |
| **用户详情** | 完整个人信息、所属团队、仓库、活动日志 |
| **禁用账号** | 临时暂停用户账号 |
| **启用账号** | 重新激活已禁用的账号 |
| **删除账号** | 永久删除用户及其数据（需确认 + 冷却期） |

## 4.4 安全审计

| 功能 | 说明 |
|------|------|
| **操作日志** | 审计追踪：谁在何时做了什么、来源 IP |
| **登录历史** | 每个用户的登录记录（IP、User Agent） |
| **异常检测** | 标记异常模式（新 IP、大量 API 调用、批量导出） |
| **Key 泄露检查** | 检测 Secret Key 是否出现在公开仓库或暴露环境中 |

---

# 5. 技术架构

## 5.1 应用结构

```
apps/
├── platform/          # Platform Webapp（Next.js App Router）
│   ├── app/           # 页面
│   ├── components/    # React 组件
│   └── lib/           # Webapp 专用工具函数
├── admin/             # Admin Webapp（Next.js App Router）
│   ├── app/
│   ├── components/
│   └── lib/
├── server/            # Apigent Core API Server（Hono，独立进程）
│   ├── services/      # Platform Services（OpenAPI Parser、Knowledge Graph 等）
│   ├── agents/        # AI Agents（Business Context、Semantic Search）
│   ├── mcp/           # MCP Gateway（HTTP + Streamable HTTP）
│   ├── jobs/          # 异步任务 Worker（BullMQ）
│   ├── db/            # 数据库 Schema 与迁移
│   └── index.ts       # Server 入口
└── packages/           # 共享包
    ├── types/          # 共享 TypeScript 类型
    ├── ui/             # 共享 UI 组件
    └── auth/           # 共享认证工具
```

### 为什么 Core API Server 用 Hono？

将 Core API Server 与 Next.js 分离，基于三个理由：

| 考量 | Next.js API Routes | 独立 Server（Hono） |
|------|:--:|:--:|
| **独立扩缩** | 耦合在 Webapp 进程生命周期中 | MCP 流量和页面流量可独立部署、扩缩、监控 |
| **无超时焦虑** | Serverless 平台有 10–60s 硬限制；`search_apis` 涉及 LLM + 语义理解可能超限 | 常驻进程，无超时限制 |
| **部署灵活** | 绑定 Vercel/Node.js serverless 模型 | 可部署到 VPS、K8s、Docker，甚至未来迁移到边缘运行时（Bun、Cloudflare Workers） |

### MCP 传输模式

Apigent 的 MCP Gateway 使用 **Streamable HTTP**（2025 规范），而非旧的 SSE 传输：

| MCP Tool | 传输模式 | 说明 |
|----------|---------|------|
| `search_apis` | 标准请求 → 响应 | 一次 HTTP POST，返回 JSON |
| `get_api_detail` | 标准请求 → 响应 | 一次 HTTP POST，返回 JSON |
| `get_project_context` | 标准请求 → 响应 | 一次 HTTP POST，返回 JSON |

三个 tool 都是**普通请求-响应**——不需要流式返回，不需要服务端推送，不需要持久连接。MCP 对 Apigent 的使用场景不需要 SSE 或长连接。分离成独立服务是**架构选择**（独立扩缩 + 部署灵活），而非协议要求。

## 5.2 技术选型

每个可替换组件由 **TypeScript 接口**定义，并附带**默认实现**。用户可通过实现接口并在配置中注册来替换任何组件。详见 [5.5 可扩展架构](#55-可扩展架构)。

| 层 | 默认实现 | 抽象接口 | 选型理由 |
|-----|---------|---------|---------|
| **Webapp 前端** | Next.js App Router、React、TypeScript | — | SSR、Streaming、Server Components、丰富生态 |
| **Webapp 样式** | Tailwind CSS | — | 原子化 CSS，快速 UI 开发 |
| **API Server** | Hono（TypeScript） | — | 轻量（12KB）、多运行时、Web 标准 `Request`/`Response`、Express 风格 API |
| **类型桥梁** | tRPC | — | Webapp 与 API Server 端到端类型安全 |
| **数据库** | PostgreSQL | `DatabaseAdapter` | 关系型数据；Drizzle ORM 已支持 MySQL、SQLite——仅需更换驱动和 Schema |
| **向量存储** | pgvector | `VectorStore` | V0 阶段 PG 内向量检索；规模增长后可换 Milvus/Qdrant/Weaviate |
| **ORM** | Drizzle | `DatabaseAdapter` | SQL 优先、类型安全；Drizzle 以统一 API 支持 PostgreSQL、MySQL、SQLite |
| **异步任务** | BullMQ + Redis | `QueueProvider` | OpenAPI 导入、LLM 推理、批处理——可按需换 RabbitMQ/SQS |
| **认证** | NextAuth.js（credentials + OAuth） | `AuthProvider` | Next.js 生态成熟、灵活的认证方案；可接自定义 OIDC/LDAP |
| **LLM** | Qwen API（阿里云百炼） | `LLMProvider` | Structured Output、Function Calling；可换 Claude/OpenAI/Gemini/本地模型 |
| **Embedding** | Qwen Embedding（text-embedding-v4） | `EmbeddingProvider` | 语义搜索向量化；可换 Claude/OpenAI/Cohere/本地 Embedding 模型 |
| **MCP** | @modelcontextprotocol/sdk | — | 标准 MCP 实现，Streamable HTTP 传输 |
| **存储** | 本地文件系统 | `StorageProvider` | OpenAPI 文件存储；可换 S3/MinIO/Google Cloud Storage |
| **Diff** | diff（或自研渲染器） | — | 版本对比和 AI 编辑建议展示 |

## 5.3 API 层设计

```
Platform Webapp ──→ tRPC ──→ Core API Server (Hono) ──→ PostgreSQL
Admin Webapp    ──→ tRPC ──→ Core API Server (Hono) ──→ PostgreSQL
                                           │
                                    ┌──────┴──────┐
                                    │  MCP Gateway │  ← 嵌入 Core API Server 进程，
                                    │  (Streamable │     直接调用 Services
                                    │   HTTP)      │
                                    └──────────────┘
                                           ↑
                                    外部 AI Agent
                                   (Cursor / Claude)
```

- **tRPC** 提供 Webapp 与 Core API Server 之间的端到端类型安全
- **MCP Gateway** 嵌入同一个 Hono 进程，直接调用 Core Services（内部调用无 HTTP 开销），对外暴露 Streamable HTTP 端点
- **两个 Webapp** 是独立的 Next.js 实例；API Server 是独立进程，可单独扩缩
- **异步任务**（OpenAPI 导入、Business Context LLM 推理）分发到 BullMQ Worker 执行，不阻塞 HTTP 请求

## 5.4 认证与 RBAC 实现

### 5.4.1 架构概览

身份认证（"你是谁"）和权限授权（"你能做什么"）是分离的关注点，由不同层处理：

```
浏览器请求
    │
    ▼
┌──────────────────────────────────────────────┐
│  Next.js 中间件 (middleware.ts)               │
│                                              │
│  ┌────────────────────┐                      │
│  │ 1. 身份认证         │  NextAuth.js         │
│  │    解码 JWT          │  "你是谁？"          │
│  │    → session.user    │                      │
│  └────────┬───────────┘                      │
│           │                                   │
│  ┌────────▼───────────┐                      │
│  │ 2. 权限授权         │  RBAC 引擎            │
│  │    检查权限          │  "你能做什么？"       │
│  │    → 通过 / 拒绝     │                      │
│  └────────┬───────────┘                      │
│           │                                   │
│  ┌────────▼───────────┐                      │
│  │ 3. 路由处理         │                      │
│  │    页面 / API / MCP  │                      │
│  └────────────────────┘                      │
└──────────────────────────────────────────────┘
```

### 5.4.2 认证流程（NextAuth.js）

NextAuth.js（Auth.js v5）配置为 **JWT 策略**——会话 token 是签名后的 JWT，存储在 httpOnly cookie 中。每次请求无需查询数据库。

**配置（`packages/auth/auth.ts`）：**

```ts
import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import Google from "next-auth/providers/google"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "@/server/db"

export const { auth, handlers, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async (credentials) => {
        // 验证邮箱 + 密码
        const user = await verifyCredentials(credentials)
        return user // { id, email, name }
      },
    }),
    GitHub({ clientId: process.env.GITHUB_ID, clientSecret: process.env.GITHUB_SECRET }),
    Google({ clientId: process.env.GOOGLE_ID, clientSecret: process.env.GOOGLE_SECRET }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) token.userId = user.id
      return token
    },
    session: async ({ session, token }) => {
      session.user.id = token.userId as string
      return session
    },
  },
})
```

**JWT Payload 结构：**

```ts
{
  sub: "user_abc123",      // 用户 ID
  email: "dev@example.com",
  name: "Jiahui Wu",
  iat: 1722000000,         // 签发时间
  exp: 1722600000,         // 过期时间（7 天）
}
```

### 5.4.3 RBAC 权限检查

核心权限检查函数在每次需要授权的请求中调用。它解析用户对特定资源的**有效权限**。

**解析顺序：**

```
checkPermission(userId, resourceType, resourceId, requiredPermission)

步骤 1：用户是 platform_admin？
        └── 是 → 通过（跳过后续检查）

步骤 2：是否存在显式的 RepoPermission 记录（userId, repoId）？
        └── 有 → 使用该覆盖角色对应的权限
        └── 无 → 进入步骤 3

步骤 3：用户在 Team 中的角色是什么？
        └── team_owner  → 继承 repo_admin（Team 内所有仓库）
        └── team_admin  → 继承 repo_editor（Team 内所有仓库）
        └── team_member → 继承 repo_viewer（Team 内所有仓库）

步骤 4：映射角色 → 权限列表，检查 requiredPermission 是否包含其中
        └── 是 → 通过
        └── 否 → 拒绝（403）
```

**参考实现（`packages/auth/rbac.ts`）：**

```ts
import { db } from "@/server/db"
import { teamMembers, repoPermissions, users } from "@/server/db/schema"
import { eq, and } from "drizzle-orm"

const ROLE_PERMISSIONS: Record<string, string[]> = {
  team_owner:  ["team:manage_members", "team:delete", "team:manage_settings",
                "repo:read", "repo:write", "repo:import", "repo:delete",
                "repo:manage_permissions", "repo:manage_mcp"],
  team_admin:  ["team:manage_members", "team:manage_settings",
                "repo:read", "repo:write", "repo:import", "repo:delete",
                "repo:manage_permissions", "repo:manage_mcp"],
  team_member: ["repo:read"],
  repo_admin:  ["repo:read", "repo:write", "repo:import", "repo:delete",
                "repo:manage_permissions", "repo:manage_mcp"],
  repo_editor: ["repo:read", "repo:write", "repo:import"],
  repo_viewer: ["repo:read"],
  platform_admin: ["admin:manage_users", "admin:view_stats", "admin:view_audit"],
}

const TEAM_ROLE_INHERITANCE: Record<string, string> = {
  team_owner:  "repo_admin",
  team_admin:  "repo_editor",
  team_member: "repo_viewer",
}

async function checkPermission(
  userId: string,
  resourceType: "team" | "repo" | "mcp" | "admin",
  resourceId: string,
  requiredPermission: string,
): Promise<boolean> {
  // 1. 检查 platform_admin
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  })
  if (user?.role === "platform_admin") return true

  // 2. 仓库级权限检查
  if (resourceType === "repo" || resourceType === "mcp") {
    // 2a. 检查显式仓库级角色覆盖
    const explicitRole = await db.query.repoPermissions.findFirst({
      where: and(
        eq(repoPermissions.userId, userId),
        eq(repoPermissions.repoId, resourceId),
      ),
    })
    if (explicitRole) {
      return ROLE_PERMISSIONS[explicitRole.role]?.includes(requiredPermission) ?? false
    }

    // 2b. 回退到继承的 Team 角色
    const { teamId } = await db.query.repos.findFirst({
      where: eq(repos.id, resourceId),
      columns: { teamId: true },
    }) ?? {}
    if (teamId) {
      const membership = await db.query.teamMembers.findFirst({
        where: and(
          eq(teamMembers.userId, userId),
          eq(teamMembers.teamId, teamId),
        ),
      })
      if (membership) {
        const inheritedRole = TEAM_ROLE_INHERITANCE[membership.role]
        return ROLE_PERMISSIONS[inheritedRole]?.includes(requiredPermission) ?? false
      }
    }
  }

  // 3. Team 级权限检查
  if (resourceType === "team") {
    const membership = await db.query.teamMembers.findFirst({
      where: and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.teamId, resourceId),
      ),
    })
    if (membership) {
      return ROLE_PERMISSIONS[membership.role]?.includes(requiredPermission) ?? false
    }
  }

  return false
}
```

### 5.4.4 中间件集成

Next.js 中间件在每个请求前执行。它串联身份认证（NextAuth.js）和权限授权（RBAC）：

**`middleware.ts`：**

```ts
import { auth } from "@/packages/auth/auth"
import { checkPermission } from "@/packages/auth/rbac"

// 不需要认证的公开路由
const PUBLIC_ROUTES = ["/login", "/register", "/api/auth/*"]

// 路由 → 所需权限映射
const ROUTE_PERMISSIONS: Record<string, { type: string; permission: string }> = {
  "/api/repos/:repoId/edit":       { type: "repo", permission: "repo:write" },
  "/api/repos/:repoId/import":     { type: "repo", permission: "repo:import" },
  "/api/repos/:repoId/settings":   { type: "repo", permission: "repo:manage_permissions" },
  "/api/repos/:repoId/mcp":        { type: "repo", permission: "repo:manage_mcp" },
  "/api/teams/:teamId/members":    { type: "team", permission: "team:manage_members" },
  "/api/teams/:teamId/settings":   { type: "team", permission: "team:manage_settings" },
  "/api/admin/*":                  { type: "admin", permission: "admin:view_stats" },
}

export default auth((req) => {
  const { pathname } = req.nextUrl

  // 放行公开路由
  if (PUBLIC_ROUTES.some(r => pathname.startsWith(r))) {
    return  // 无需认证，直接通过
  }

  // 要求已登录
  if (!req.auth?.user?.id) {
    return Response.redirect(new URL("/login", req.url))
  }

  // 检查路由级权限
  const routeConfig = matchRoute(pathname, ROUTE_PERMISSIONS)
  if (routeConfig) {
    const allowed = checkPermission(
      req.auth.user.id,
      routeConfig.type,
      extractResourceId(pathname),  // 例如从 "/api/repos/repo_123/edit" 中提取 "repo_123"
      routeConfig.permission,
    )
    if (!allowed) {
      return new Response("Forbidden", { status: 403 })
    }
  }
})

// 路由匹配器配置
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
```

### 5.4.5 MCP Tool 授权

MCP 工具使用独立的认证路径——API Key 而非 Session Cookie：

```
外部 Agent（Cursor/Claude）
    │
    │  Authorization: Bearer apigent_sk_xxxx
    │
    ▼
┌─────────────────────────────────┐
│  MCP Gateway (Hono)             │
│                                 │
│  1. 从 Header 提取 API Key       │
│  2. 在数据库中查找 SecretKey      │
│     ├── 已过期？→ 401           │
│     └── 有效？→ 步骤 3          │
│  3. 检查 key.scopes[]            │
│     ├── 包含 "mcp:search"？      │
│     │   → 允许 search_apis       │
│     ├── 包含 "mcp:detail"？      │
│     │   → 允许 get_api_detail    │
│     └── 包含 "mcp:context"？     │
│         → 允许 get_project_context│
│  4. 传入 userId + repoId 到       │
│     RBAC 检查仓库访问权限         │
└─────────────────────────────────┘
```

### 5.4.6 共享 Auth 包结构

```
packages/auth/
├── auth.ts              # NextAuth.js 配置
├── auth.config.ts       # 路由匹配器、公开路由列表
├── middleware.ts         # Next.js 中间件（认证 + RBAC）
├── rbac.ts              # checkPermission()、角色↔权限映射表
├── mcp-auth.ts          # MCP API Key 验证（供 Hono 服务端使用）
└── types.ts             # Session、Role、Permission 类型定义
```

**关键设计决策：**

| 决策 | 理由 |
|------|------|
| JWT 策略（而非数据库 Session） | 中间件每次请求无需查 DB；更快，水平扩展友好 |
| httpOnly cookie（而非 localStorage） | 免疫 XSS 攻击；浏览器自动在每次请求中携带 cookie |
| 中间件级 RBAC（而非每个 handler 各自检查） | 集中化、可审计；避免单个路由遗漏权限检查 |
| MCP 使用 API Key（而非 Session） | 外部 Agent（Cursor/CLI）没有浏览器 Session；Bearer token 是标准的机器间认证模式 |
| `packages/auth/` 跨 Webapp 共享 | Platform 和 Admin Webapp 使用相同的认证逻辑；共享包避免重复代码 |

## 5.5 可扩展架构

### 5.5.1 设计理念

Apigent 是一个**开源、自托管**的平台。不同团队有不同的基础设施偏好——有的用 MySQL，有的用 Milvus 做向量搜索，有的想用 OpenAI 而非 Qwen。Apigent 不强绑定单一技术栈，而是为每个基础设施关注点定义 **TypeScript 接口**，并提供合理的默认实现。用户通过修改配置来替换实现，无需改动代码。

```
┌─────────────────────────────────────────────────────────────┐
│                    Apigent Core                              │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐ │
│  │ Services │ │ Agents   │ │ MCP      │ │ Auth / RBAC   │ │
│  │          │ │          │ │ Gateway  │ │               │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘ │
│       │            │            │               │          │
│       └────────────┴────────────┴───────────────┘          │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              接口 / 适配器层                          │   │
│  │                                                     │   │
│  │  VectorStore  LLMProvider  EmbeddingProvider  ...    │   │
│  └──────────────────────┬──────────────────────────────┘   │
└─────────────────────────┼──────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          │               │               │
    ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐
    │ 默认       │   │ 自定义     │   │ 自定义     │
    │ pgvector  │   │ Milvus    │   │ Qdrant    │
    └───────────┘   └───────────┘   └───────────┘
```

**核心原则：** Apigent 的代码依赖接口而非具体实现。每个基础设施组件都可以在不触碰业务逻辑的情况下被替换。

### 5.5.2 可替换组件

| 组件 | 接口 | 默认实现 | 常见替代方案 |
|------|------|---------|------------|
| **向量存储** | `VectorStore` | pgvector | Milvus、Qdrant、Weaviate、Pinecone、Chroma |
| **LLM 提供商** | `LLMProvider` | Qwen API（阿里云百炼） | Claude、OpenAI、Gemini、Ollama（本地）、vLLM |
| **Embedding 提供商** | `EmbeddingProvider` | Qwen Embedding（text-embedding-v4） | Claude Embedding、OpenAI Embedding、Cohere、BGE（本地） |
| **存储提供商** | `StorageProvider` | 本地文件系统 | AWS S3、MinIO、Google Cloud Storage、Azure Blob |
| **队列提供商** | `QueueProvider` | BullMQ + Redis | RabbitMQ、AWS SQS、Google Pub/Sub |
| **认证提供商** | `AuthProvider` | NextAuth.js | 自定义 OIDC、LDAP、SAML、Authentik |

### 5.5.3 Vector Store 接口

```ts
// packages/core/src/interfaces/vector-store.ts

export interface VectorDocument {
  id: string
  vector: number[]
  metadata: Record<string, unknown>
}

export interface VectorSearchResult {
  document: VectorDocument
  score: number
}

export interface VectorStore {
  /** 插入或更新带 Embedding 的文档 */
  upsert(documents: VectorDocument[]): Promise<void>

  /** 按向量搜索相似文档 */
  search(vector: number[], options?: {
    topK?: number
    filter?: Record<string, unknown>
  }): Promise<VectorSearchResult[]>

  /** 按 ID 删除文档 */
  delete(ids: string[]): Promise<void>

  /** 按过滤条件删除文档 */
  deleteByFilter(filter: Record<string, unknown>): Promise<void>

  /** 检查连接健康状态 */
  health(): Promise<boolean>
}
```

**默认实现 — pgvector：**

```ts
// packages/vector-store-pgvector/src/pgvector-store.ts
import { VectorStore, VectorDocument, VectorSearchResult } from "@/core/interfaces"
import { sql } from "drizzle-orm"

export class PgvectorStore implements VectorStore {
  async upsert(documents: VectorDocument[]): Promise<void> {
    await this.db.insert(embeddings).values(
      documents.map(d => ({
        id: d.id,
        vector: sql`${JSON.stringify(d.vector)}::vector`,
        metadata: d.metadata,
      }))
    ).onConflictDoUpdate({
      target: embeddings.id,
      set: { vector: sql`excluded.vector`, metadata: sql`excluded.metadata` },
    })
  }

  async search(vector: number[], options?: {
    topK?: number
    filter?: Record<string, unknown>
  }): Promise<VectorSearchResult[]> {
    const topK = options?.topK ?? 10
    const rows = await this.db.execute(sql`
      SELECT id, metadata, 1 - (vector <=> ${JSON.stringify(vector)}::vector) AS score
      FROM embeddings
      ORDER BY vector <=> ${JSON.stringify(vector)}::vector
      LIMIT ${topK}
    `)
    return rows.map(r => ({
      document: { id: r.id, vector: [], metadata: r.metadata },
      score: r.score,
    }))
  }

  // ... delete, deleteByFilter, health
}
```

**替换示例 — Milvus：**

```ts
// 用户项目：my-apigent/vector-store.ts
import { VectorStore, VectorDocument, VectorSearchResult } from "apigent/core"
import { MilvusClient } from "@zilliz/milvus2-sdk-node"

export class MilvusStore implements VectorStore {
  private client: MilvusClient

  constructor(config: { host: string; port: number; collection: string }) {
    this.client = new MilvusClient({ address: `${config.host}:${config.port}` })
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    await this.client.insert({
      collection_name: this.collection,
      data: documents.map(d => ({
        id: d.id,
        vector: d.vector,
        metadata: JSON.stringify(d.metadata),
      })),
    })
  }

  async search(vector: number[], options?: {
    topK?: number
    filter?: Record<string, unknown>
  }): Promise<VectorSearchResult[]> {
    const results = await this.client.search({
      collection_name: this.collection,
      vector,
      limit: options?.topK ?? 10,
    })
    return results.map(r => ({
      document: { id: r.id, vector: [], metadata: JSON.parse(r.metadata) },
      score: r.score ?? 0,
    }))
  }

  async delete(ids: string[]): Promise<void> {
    await this.client.delete({ collection_name: this.collection, ids })
  }

  // ... deleteByFilter, health
}
```

### 5.5.4 LLM Provider 接口

```ts
// packages/core/src/interfaces/llm-provider.ts

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
}

export interface ChatOptions {
  model?: string
  temperature?: number
  maxTokens?: number
  responseFormat?: "text" | "json_object"
}

export interface ChatResponse {
  content: string
  usage: { inputTokens: number; outputTokens: number }
}

export interface LLMProvider {
  /** 单轮对话补全 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>

  /** 流式对话补全 */
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<string>

  /** 列出可用模型 */
  listModels(): Promise<string[]>
}
```

**默认实现：** `QwenProvider` 封装阿里云百炼 DashScope API（OpenAI 兼容模式）。  
**替代方案：** `ClaudeProvider` 封装 `@anthropic-ai/sdk`，`OpenAIProvider` 封装 `openai` SDK，`OllamaProvider` 封装 Ollama HTTP API，`GeminiProvider` 封装 `@google/generative-ai`。

### 5.5.5 Embedding Provider 接口

```ts
// packages/core/src/interfaces/embedding-provider.ts

export interface EmbeddingProvider {
  /** 为单段文本生成 Embedding */
  embed(text: string): Promise<number[]>

  /** 为多段文本批量生成 Embedding */
  embedBatch(texts: string[]): Promise<number[][]>

  /** Embedding 向量的维度 */
  readonly dimension: number
}
```

此接口独立于 `LLMProvider`，原因：
- 部分部署中 chat 和 embedding 使用不同服务（如 Qwen 聊天 + Cohere 向量化）
- 本地 Embedding 模型（BGE、GTE）没有对话能力
- 解耦接口允许独立替换

**默认实现：** `QwenEmbeddingProvider` 使用阿里云百炼 `text-embedding-v4`。  
**替代方案：** `ClaudeEmbeddingProvider`、`OpenAIEmbeddingProvider`、`CohereEmbeddingProvider`、`LocalEmbeddingProvider`（封装 FastEmbed/Transformers.js）。

### 5.5.6 Storage Provider 接口

```ts
// packages/core/src/interfaces/storage-provider.ts

export interface StorageProvider {
  /** 上传文件，返回存储路径 */
  upload(key: string, body: Buffer | ReadableStream, contentType: string): Promise<string>

  /** 下载文件为 Buffer */
  download(key: string): Promise<Buffer>

  /** 获取签名 URL 用于直接访问（可选） */
  getSignedUrl?(key: string, expiresInSeconds: number): Promise<string>

  /** 删除文件 */
  delete(key: string): Promise<void>

  /** 检查文件是否存在 */
  exists(key: string): Promise<boolean>
}
```

**默认实现：** `LocalStorageProvider` 存储文件到 `data/uploads/` 目录。  
**替代方案：** `S3StorageProvider`、`MinioStorageProvider`、`GCSStorageProvider`。

### 5.5.7 Queue Provider 接口

```ts
// packages/core/src/interfaces/queue-provider.ts

export interface QueueProvider {
  /** 入队一个任务 */
  enqueue<T>(queueName: string, payload: T, options?: {
    delay?: number
    priority?: number
  }): Promise<string>

  /** 注册队列处理器 */
  register<T, R>(queueName: string, handler: (payload: T) => Promise<R>): void

  /** 查询任务状态 */
  getStatus(jobId: string): Promise<"waiting" | "active" | "completed" | "failed">

  /** 优雅关闭 */
  shutdown(): Promise<void>
}
```

**默认实现：** `BullmqQueueProvider` 封装 BullMQ + Redis。  
**替代方案：** `RabbitmqQueueProvider`、`SqsQueueProvider`、`InMemoryQueueProvider`（开发/测试）。

### 5.5.8 配置系统 — 双层设计

Apigent 使用**双层配置系统**，方便开发环境和部署环境之间无缝切换：

| 层 | 文件 | 放什么 | 示例 |
|-------|------|---------------|----------|
| **方案选择** | `apigent.config.yaml` | 使用哪个 provider / 模型 / 策略（结构化 YAML，支持注释） | `llm.provider: qwen`、`rag.retrievalMode: hybrid` |
| **密钥** | `.env` | API key、密码、连接字符串（`APIGENT_` 前缀） | `DASHSCOPE_API_KEY`、`APIGENT_DATABASE_URL`、`APIGENT_AUTH_SECRET` |
| **编程配置** | `apigent.config.ts` | 自定义 provider 工厂、高级配置（可选 — 大多数用户只需 `.yaml` + `.env`） | 自定义 `VectorStore` 实现、插件注册 |

**默认工作流 — apigent.config.yaml + .env（95% 用户）：**

`apigent.config.yaml`（方案选择）：
```yaml
llm:
  provider: qwen
  models:
    default: qwen3.7-plus
    query_rewrite: qwen3.7-flash
    rag_answer: qwen3.7-plus

embedding:
  provider: qwen
  model: text-embedding-v4

rag:
  retrievalMode: hybrid
  reranker:
    provider: qwen
    model: qwen3-rerank
```

`.env`（仅密钥）：
```bash
DASHSCOPE_API_KEY=sk-your-dashscope-key-here
APIGENT_DATABASE_URL=postgresql://localhost:5432/apigent_dev
APIGENT_REDIS_URL=redis://localhost:6379
APIGENT_AUTH_SECRET=your-secret-here
```

配置加载器读取 YAML + .env 并构造完整类型化的 `ApigentConfig`：

```ts
import { loadConfig } from "@apigent/core/config";

const config = loadConfig();
// → 读取 apigent.config.yaml + .env → ApigentConfig
```

**高级工作流 — apigent.config.ts（自定义 provider）：**

对于自定义 provider 实现，`apigent.config.ts` 在 YAML + env 基础上提供编程式覆盖：

```ts
// apigent.config.ts
import type { ApigentConfig } from "@apigent/core";
import { loadConfig } from "@apigent/core/config";
import { MyCustomVectorStore } from "./my-vector-store";

const base = loadConfig();

const config: ApigentConfig = {
  ...base,
  vectorStore: () => new MyCustomVectorStore({ /* ... */ }),
};

export default config;
```

**切换示例 — dev（Qwen + pgvector）→ production（OpenAI + Milvus）：**

无需修改代码。只需使用不同的配置文件：

```yaml
# apigent.config.prod.yaml
llm:
  provider: openai
  models:
    default: gpt-4o
    query_rewrite: gpt-4o-mini

embedding:
  provider: openai
  model: text-embedding-3-small

vectorStore:
  provider: milvus
  host: milvus-prod.internal
  port: 19530

rag:
  reranker:
    provider: cohere
```

```bash
# .env.production
OPENAI_API_KEY=sk-prod-key
APIGENT_COHERE_API_KEY=co-prod-key
APIGENT_DATABASE_URL=postgresql://prod-db:5432/apigent
APIGENT_AUTH_SECRET=prod-secret
```

配置类型定义位于 `packages/core/src/config/types.ts`。所有可用选项请参见仓库根目录的 `.env.example` 和 `apigent.config.example.yaml`。

Apigent 核心框架在启动时读取配置，通过 **服务容器（Service Container）** 注入实现：

```ts
// packages/core/src/container.ts
import type { ApigentConfig } from "./config"

export class Container {
  private instances = new Map<string, unknown>()

  constructor(private config: ApigentConfig) {}

  getVectorStore(): VectorStore {
    if (!this.instances.has("vectorStore")) {
      this.instances.set("vectorStore", this.config.vectorStore())
    }
    return this.instances.get("vectorStore") as VectorStore
  }

  getLLM(): LLMProvider { /* ... */ }
  getEmbedding(): EmbeddingProvider { /* ... */ }
  getStorage(): StorageProvider { /* ... */ }
  getQueue(): QueueProvider { /* ... */ }
}

// 单例——应用启动时初始化一次
let container: Container

export function initContainer(config: ApigentConfig) {
  container = new Container(config)
}

export function getContainer(): Container {
  if (!container) throw new Error("Container 未初始化")
  return container
}
```

业务代码绝不直接导入具体实现：

```ts
// ✅ 正确——依赖接口，与具体实现无关
import { getContainer } from "@/core/container"

async function searchApis(query: string) {
  const vectorStore = getContainer().getVectorStore()
  const embeddingProvider = getContainer().getEmbedding()
  const queryVector = await embeddingProvider.embed(query)
  return vectorStore.search(queryVector, { topK: 10 })
}

// ❌ 错误——硬编码依赖，无法替换
import { PgvectorStore } from "@apigent/vector-store-pgvector"
```

### 5.5.9 插件系统（V1+）

除了核心基础设施接口外，Apigent 支持通过**插件**扩展平台行为：

```
plugins/
├── custom-notification/       # 通过微信/Slack/邮件发送通知
│   ├── index.ts
│   └── package.json
├── custom-ai-rule/            # 添加自定义 lint/校验规则
│   ├── index.ts
│   └── package.json
└── custom-export/             # 以自定义格式导出 API
    ├── index.ts
    └── package.json
```

**插件接口（V1）：**

```ts
export interface ApigentPlugin {
  name: string
  version: string
  /** 插件注册时调用 */
  register(ctx: PluginContext): void | Promise<void>
  /** 插件卸载时调用 */
  unregister?(): void | Promise<void>
}

export interface PluginContext {
  container: Container
  logger: Logger
  /** 在平台生命周期中注册钩子 */
  onHook(hook: string, handler: (...args: any[]) => Promise<void>): void
}
```

插件通过 `apigent.config.ts` 注册：

```ts
const config: ApigentConfig = {
  // ... 核心配置
  plugins: [
    "./plugins/custom-notification",
    "./plugins/custom-ai-rule",
  ],
}
```

---

# 6. V0 范围

综合 blueprint 路线图，V0 覆盖最小可用产品：

| 领域 | V0 功能 |
|------|--------|
| **认证** | 邮箱登录/注册、Session 管理 |
| **团队** | 创建团队、邀请成员、基础角色 |
| **仓库** | 创建仓库、导入 OpenAPI（文件/URL）、版本列表 |
| **浏览** | 接口列表（按 tag 分组）、数据模型列表、语义搜索（自然语言） |
| **Core Engine** | OpenAPI Parser → Business Context Agent → Knowledge Graph |
| **MCP** | 基础 MCP Gateway，提供 `search_apis` + `get_api_detail` + `get_project_context` |
| **Secret Key** | 生成、查看、删除密钥 |
| **Dashboard** | 简单仓库列表 + 最近活动 |
| **Admin** | 基础用户列表、平台统计 |
