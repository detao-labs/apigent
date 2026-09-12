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
- **Core Engine** — API 知识流水线（OpenAPI Parser → Business Context Agent → MCP Gateway；Knowledge Graph 为 V1+ 可选增强），详见 [docs/modules/](./modules/)

**应用地图**（各 APP 使用的运行时）：

| APP             | 运行时                    | 端口 | 职责                                                                          |
| --------------- | ------------------------- | ---- | ----------------------------------------------------------------------------- |
| `apps/platform` | **Next.js**（App Router） | 3000 | 面向开发者的 Webapp **以及** Platform REST API（`src/app/api/**` 路由处理器） |
| `apps/admin`    | **Next.js**（App Router） | 3001 | Admin Webapp（V0 仅壳；完整功能V1）                                           |
| `apps/open`     | **Hono**                  | 3002 | Open Gateway —— 面向机器的接入面（当前 health，V1 提供 MCP 端点）             |

共享的、与框架无关的逻辑放在 `packages/*`，由这些 APP 直接引用，而不是单独部署成一个服务。

---

# 2. 核心领域模型

## 2.1 实体概览

```
┌──────────┐     ┌──────────────────┐     ┌────────────────┐
│   User   │────→│ OrganizationMember│←────│  Organization  │
└──────────┘     └──────────────────┘     └────────────────┘
     │                                      │
     │  ┌──────────────────┐               │
     ├──│  SecretKey       │               │
     │  └──────────────────┘               │
     │                               ┌─────┴──────┐
     │  ┌──────────────────┐        │ Repository  │
     └──│  RepoPermission  │←──────→│  (一个仓库 = │
        └──────────────────┘        │  一份 OpenAPI│
                                    │  文件)       │
                                    └─────────────┘
                                           │
                                    ┌──────┴──────┐
                                    │   OpenAPI   │
                                    │  Versions   │
                                    └─────────────┘

┌──────────┐     ┌──────────────────┐     ┌─────────────┐
│ Project  │────→│ ProjectRepository │←────│ Repository │
└──────────┘     └──────────────────┘     └─────────────┘
     │
     │  ┌──────────────────┐
     └──│   ProjectMember  │
        └──────────────────┘
```

## 2.2 User（用户）

代表一个注册用户账号。

| 字段            | 类型      | 说明                            |
| --------------- | --------- | ------------------------------- |
| `id`            | UUID      | 唯一标识                        |
| `email`         | string    | 登录邮箱（唯一）                |
| `password_hash` | string    | 密码哈希                        |
| `sso_providers` | string[]  | 绑定 SSO 账号（github、google） |
| `name`          | string    | 显示名称                        |
| `avatar_url`    | string    | 头像 URL                        |
| `created_at`    | timestamp | 注册时间                        |
| `updated_at`    | timestamp | 最后更新时间                    |

## 2.3 Organization（组织）

顶层租户边界。用户先创建 Organization，再在 Organization 下创建 Repository。

| 字段         | 类型      | 说明               |
| ------------ | --------- | ------------------ |
| `id`         | UUID      | 唯一标识           |
| `name`       | string    | 组织显示名称       |
| `slug`       | string    | URL 友好的唯一标识 |
| `owner_id`   | UUID      | 创建者             |
| `created_at` | timestamp | 创建时间           |

## 2.4 OrganizationMember（组织成员）

关联用户与组织及其角色。

| 字段              | 类型   | 说明                                            |
| ----------------- | ------ | ----------------------------------------------- |
| `user_id`         | UUID   | 用户引用                                        |
| `organization_id` | UUID   | 组织引用                                        |
| `role`            | string | 角色标识（详见 [2.8 RBAC 模型](#28-rbac-模型)） |

**组织级角色：**

| 角色         | 范围         | 概述                                       |
| ------------ | ------------ | ------------------------------------------ |
| `org_owner`  | Organization | 完全控制：删除组织、管理成员、管理所有仓库 |
| `org_admin`  | Organization | 管理成员、管理组织内所有仓库               |
| `org_member` | Organization | 根据仓库级角色分配访问仓库                 |

## 2.5 Repository（仓库）

技术资产容器。**一个仓库对应一份 OpenAPI 文件及其版本历史。** Repository 承载技术层 + **能力上下文**（V0）——该后端项目提供了哪些能力。消费方的**使用上下文**属于 Project（见 [2.9](#29-project项目)）。

| 字段                 | 类型      | 说明                                                                           |
| -------------------- | --------- | ------------------------------------------------------------------------------ |
| `id`                 | UUID      | 唯一标识                                                                       |
| `organization_id`    | UUID      | 所属 Organization                                                              |
| `name`               | string    | 仓库名称                                                                       |
| `description`        | string    | 仓库描述（支持 LLM 辅助生成）                                                  |
| `capability_context` | object    | 能力上下文（V0）：能力意图、约束、副作用、示例——由 Business Context Agent 产出 |
| `openapi_versions`   | Version[] | OpenAPI 版本历史                                                               |
| `current_version`    | string    | 当前活跃版本标识                                                               |
| `mcp_enabled`        | boolean   | 是否开启 MCP 服务                                                              |
| `created_at`         | timestamp | 创建时间                                                                       |
| `updated_at`         | timestamp | 最后更新时间                                                                   |

**版本管理：**

- 每次导入自动创建新版本（根据 OpenAPI `info.version` 自动识别）
- 版本历史记录，支持版本间 diff 对比
- 支持回滚到历史版本
- 支持导出任意版本的 OpenAPI JSON/YAML

## 2.6 RepositoryMember（仓库成员）

仓库自己的成员表。**仓库目录全站可见，仓库内容由这张表决定**——表里没有行、也不是所属 Organization 的 admin/owner，访问内容一律 403（详见 [2.8 RBAC 模型](#28-rbac-模型)）。

| 字段            | 类型      | 说明                                        |
| --------------- | --------- | ------------------------------------------- |
| `repository_id` | string    | 仓库引用（与 `user_id` 组成复合主键）       |
| `user_id`       | string    | 用户引用                                    |
| `role`          | string    | 仓库角色标识（详见 [2.8.1](#281-租户角色)） |
| `granted_at`    | timestamp | 加入时间                                    |
| `granted_by`    | string    | 授予人（审计用）；系统写入时为 NULL         |

**仓库角色（四级阶梯，严格嵌套）：**

| 角色          | 能力                                                        |
| ------------- | ----------------------------------------------------------- |
| `repo_owner`  | 仓库全部操作，含删除仓库                                    |
| `repo_admin`  | 仓库设置（MCP 开关等）+ 成员管理                            |
| `repo_member` | 基本信息修改、接口导入/导出、业务上下文编辑、建分支与删实体 |
| `repo_viewer` | 仓库只读                                                    |

## 2.7 SecretKey（密钥）

用户级 API Key，用于 MCP 访问。外部 AI Agent 使用此密钥通过 MCP Gateway 鉴权。

| 字段           | 类型      | 说明                                                                                             |
| -------------- | --------- | ------------------------------------------------------------------------------------------------ |
| `id`           | UUID      | 唯一标识                                                                                         |
| `user_id`      | UUID      | 所属用户                                                                                         |
| `name`         | string    | 密钥名称（可读）                                                                                 |
| `key_hash`     | string    | 密钥哈希（原始密钥仅在创建时展示一次）                                                           |
| `key_prefix`   | string    | 前 8 个字符用于识别（如 `apigent_sk_...`）                                                       |
| `scopes`       | string[]  | 权限范围：`api:read`、`api:write`（外部 REST）、`mcp:search`、`mcp:detail`、`mcp:context`（MCP） |
| `last_used_at` | timestamp | 最后使用时间                                                                                     |
| `expires_at`   | timestamp | 过期时间（可选）                                                                                 |
| `created_at`   | timestamp | 创建时间                                                                                         |

## 2.8 RBAC 模型

授权拆成**两套互相独立的体系**。它们共用身份（`users`），但不共用词汇：租户角色永远不会授予平台能力，平台角色也永远不会授予租户内容权限。

| 体系          | 作用域                         | 使用方          | 存储位置                                     |
| ------------- | ------------------------------ | --------------- | -------------------------------------------- |
| **租户 RBAC** | 单个 Organization / Repository | Platform Webapp | `organization_members`、`repository_members` |
| **平台 RBAC** | 整个部署（实例级）             | Admin Webapp    | `admin_members`                              |

> **为什么是两套：** 租户角色回答"你在这个租户里能做什么"，平台角色回答"作为这个部署的运营方你能做什么"。两者是正交的——单一角色层级**无法**表达"能管理平台管理员、但不能修改仓库内容"，而这恰好是平台运营角色必须具备（且必须不越界）的形态。

### 2.8.1 租户角色

| 角色 ID          | 级别           | 说明                                                                        |
| ---------------- | -------------- | --------------------------------------------------------------------------- |
| `org_owner`      | Organization   | 完全控制 Organization（含删除）；隐式持有组织内所有仓库的 `repo_owner`      |
| `org_admin`      | Organization   | 修改组织信息与成员，**不可删除组织**；隐式持有组织内所有仓库的 `repo_admin` |
| `org_member`     | Organization   | 组织信息只读；**不隐含任何仓库角色**                                        |
| `repo_owner`     | Repository     | 仓库全部操作，含删除仓库                                                    |
| `repo_admin`     | Repository     | 仓库设置（MCP 开关等）+ 成员管理                                            |
| `repo_member`    | Repository     | 基本信息修改、接口导入/导出、业务上下文编辑、建分支与删实体                 |
| `repo_viewer`    | Repository     | 仓库只读                                                                    |
| `project_owner`  | Project（V1+） | 完全控制 Project 及其 Repository 关联                                       |
| `project_admin`  | Project（V1+） | 管理 Project 成员与 Repository 关联                                         |
| `project_viewer` | Project（V1+） | 查看 Project 及其聚合的使用上下文                                           |

仓库角色是**四级全嵌套**的阶梯（`viewer ⊂ member ⊂ admin ⊂ owner`），因此判定用等级比较即可。

### 2.8.2 权限命名约定

**当前判定是角色等级比较**（`isRepoRoleAtLeast` / `isOrgRoleAtLeast`），还没有 capability 层——因为租户侧的能力目前是**真嵌套**的，等级比较足够。

| 权限                    | 级别           | 说明                                  |
| ----------------------- | -------------- | ------------------------------------- |
| `org:manage_members`    | Organization   | 邀请、移除和修改成员角色              |
| `org:manage_settings`   | Organization   | 编辑 Organization 名称与描述          |
| `org:delete`            | Organization   | 删除 Organization（需先删完其下仓库） |
| `repo:read`             | Repository     | 查看 API、模型与业务上下文            |
| `repo:write`            | Repository     | 编辑 API 描述、业务上下文、删实体     |
| `repo:import`           | Repository     | 导入新 OpenAPI 版本、建分支           |
| `repo:activate_version` | Repository     | 激活 / 回滚（改默认版本指向）         |
| `repo:manage_members`   | Repository     | 增删改仓库成员                        |
| `repo:manage_mcp`       | Repository     | 开启/关闭 MCP、配置工具暴露范围       |
| `repo:delete`           | Repository     | 删除仓库                              |
| `project:read`          | Project（V1+） | 查看 Project 及其聚合的使用上下文     |
| `project:manage`        | Project（V1+） | 管理 Project 设置与成员               |
| `project:link_repo`     | Project（V1+） | 将 Repository 关联/取消关联到 Project |
| `api:read`              | REST API       | 访问外部 REST 端点（只读）            |
| `api:write`             | REST API       | 访问外部 REST 端点（写入）            |
| `mcp:search`            | MCP            | 访问 `search_apis` 工具               |
| `mcp:detail`            | MCP            | 访问 `get_api_detail` 工具            |
| `mcp:context`           | MCP            | 访问 `get_project_context` 工具       |

### 2.8.3 租户角色 → 权限映射

| 角色             | 权限                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `org_owner`      | `org:*`；组织内所有仓库的全部 `repo:*`                                                                      |
| `org_admin`      | `org:manage_members`、`org:manage_settings`；组织内所有仓库除 `repo:delete` 外的 `repo:*`                   |
| `org_member`     | 无组织和仓库写权限；**也不隐含任何仓库读权限**——仓库内容必须靠下面的仓库角色                                |
| `repo_owner`     | 该仓库全部 `repo:*`                                                                                         |
| `repo_admin`     | `repo:read`、`repo:write`、`repo:import`、`repo:activate_version`、`repo:manage_members`、`repo:manage_mcp` |
| `repo_member`    | `repo:read`、`repo:write`、`repo:import`                                                                    |
| `repo_viewer`    | `repo:read`                                                                                                 |
| `project_owner`  | `project:*`（V1+）                                                                                          |
| `project_admin`  | `project:read`、`project:manage`、`project:link_repo`（V1+）                                                |
| `project_viewer` | `project:read`（V1+）                                                                                       |

### 2.8.4 仓库目录与仓库内容

**目录全站可见，内容按角色门禁。** 这是本节最重要的一条：能"发现"一个仓库，和能"打开"它是两件事。

```
仓库目录（/repos 列表）
  任何登录用户都能看到平台上所有仓库的名称 / 描述 / 所属组织

仓库内容（详情页与所有 /api/repos/*）
  ① 有 repository_members 行          → 用该行的角色
  ② 否则看所属 Organization      → org_owner → repo_owner
                                   org_admin → repo_admin
  ③ 都不是                       → 403（提示联系仓库管理员或组织管理员）
```

1. **目录与内容分离。** 目录可见解决"能不能发现"，内容门禁解决"能不能读"。打不开的仓库在列表里带锁标记，且不下发版本号与接口数——那已经属于内容元数据。
2. **显式成员行优先，且可以向下覆盖。** 判定顺序是"先仓库、后组织"，所以给某位组织管理员在该仓库上设 `repo_viewer`，他就只有只读——用于对单个仓库收口。这也是取消"覆盖只能升权"那条旧规则的原因。
3. **组织成员不再自动拥有仓库读权限。** `org_member` 要访问某仓库的内容，必须被显式加入该仓库。
4. 仓库成员在 **Platform Webapp** 管理（仓库设置 → 成员），页面列出显式成员与组织隐含成员（后者只读、不可在此处移除）。
5. 仓库成员的目标必须是**该组织的成员**；V0 不支持非组织成员的访客（`repository_members` 的表结构天然容得下，只是产品上先不开）。
6. **新建仓库时创建者自动成为该仓库 `repo_owner`**，否则新仓库没有第一位成员、无人能管理。

### 2.8.5 平台角色

平台角色作用于整个部署，存放在 `admin_members(userId, role, grantedAt, grantedBy)`——表里有一行就意味着"该用户可以登录 Admin Webapp"。

| 角色 ID          | 状态           | 说明                                                            |
| ---------------- | -------------- | --------------------------------------------------------------- |
| `admin_super`    | **V0 目标**    | 超级管理员。管理其他平台管理员，并对平台统计 / 审计拥有只读访问 |
| `admin_operator` | 预留（未实现） | 运营：账号生命周期（禁用 / 启用）、统计、审计                   |
| `admin_support`  | 预留（未实现） | 客服 / 支持：只读 + 少量受限操作（如禁用账号，但绝不能删除）    |

说明：

- **不存在租户级平台角色。** Organization / Repository 的成员与角色管理留在 Platform Webapp（§3.8），因此 Admin Webapp 永远不需要租户级作用域。这也意味着 `admin_super` 没有任何路径可以触碰租户数据——它无法先把自己加进某个租户、再去改内容。
- **当前不设只读平台角色**（`admin_viewer` 评估后砍掉）。当出现"需要全局可见但不能改动"的人时，再加 `admin_support`。
- 角色值遵循既有的 `作用域_层级` 约定（与 `org_*` / `repo_*` 一致）。避免 `admin_member`（与 `org_member`"成员=最低、无特权"的含义冲突）和 `admin_sub`（不表达任何能力信息）。

### 2.8.6 平台权限枚举

权限名遵循 `admin:<域>:<动作>`。

| 权限                  | 状态 | 说明                                               |
| --------------------- | ---- | -------------------------------------------------- |
| `admin:admins:manage` | V0   | 授予 / 移除平台管理员角色（仅 `admin_super` 持有） |
| `admin:stats:view`    | V0   | 查看平台统计                                       |
| `admin:audit:view`    | V0   | 查看平台级审计日志                                 |
| `admin:users:view`    | V0   | 查看用户列表与用户详情                             |
| `admin:users:disable` | 预留 | 禁用 / 重新启用用户账号                            |
| `admin:users:delete`  | 预留 | 永久删除用户账号及其数据                           |
| `admin:content:read`  | 待定 | 为排障读取任意仓库内容（默认**不授予**）           |

`admin_super` 恰好持有上表四个 V0 权限，且**不持有任何** `repo:*` 或 `org:*` 权限——因此"在 Platform 上只读"是结构性质，而不是需要靠约定维持的行为。

### 2.8.7 跨体系规则

1. **写操作来自租户体系。** 租户内的内容与成员写入，唯一来源是 `org:*` / `repo:*` 权限。
2. **平台体系绝不能持有内容写权限。** 用测试强制：任何 `admin_*` 角色都不得映射到 `repo:write`、`repo:import`、`repo:delete`、`repo:manage_members`、`repo:manage_mcp` 或任何 `org:*` 写权限。加了这样的映射应当让 CI 失败，而不是靠代码评审发现。
3. **`admin_super` 不是数据超级用户。** 它唯一的写能力是 `admin:admins:manage`；既不能改内容，也不能增删 Organization / Repository 成员。
4. **Secret Key 是独立平面。** MCP 工具与外部 REST API 由用户签发的 Secret Key 认证，携带 `mcp:*` / `api:*` 范围；租户或平台会话角色本身永远不够。（SecretKey 的签发 / 校验链路尚未实现——见 §5.4.8。）
5. **双层访问规则（V1+）：** Project 成员身份只决定"能否看到项目存在"；项目内任何 Repository 的内容访问始终走 `repo:*` 权限。

### 2.8.8 授予与引导

| 角色                                                        | 谁能授予                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `org_owner`                                                 | 只能通过 Organization 所有权转移                                            |
| `org_admin` / `org_member`                                  | 该 Organization 的 `org_admin`+                                             |
| `repo_viewer` / `repo_member` / `repo_admin` / `repo_owner` | 该仓库的有效角色 ≥ `repo_admin`（含组织隐含的 `repo_admin` / `repo_owner`） |
| `admin_super`                                               | 另一个 `admin_super`，或引导种子数据                                        |

**第一个** `admin_super` 由显式的 seed 命令创建，绝不通过 Admin Webapp——否则没人能授予第一个管理员，形成引导死锁。**新仓库的第一位 `repo_owner`** 则是创建者本人（§2.8.4 第 6 条），不需要别人授予。

> 仓库成员管理只能增删**显式的 `repository_members` 行**。组织管理员 / 拥有者的 `repo_admin` / `repo_owner` 是隐式的、不落表，因此在成员页上"移除"对他们无效——收回权限要改组织角色。

---

## 2.9 Project（项目）

独立的业务层实体，通过 `ProjectRepository` 跨 Organization 聚合多个 Repository（多对多）。Project **不挂靠在 Organization 下**，承载**使用上下文**（V1+）——该项目如何使用各关联 Repository 的能力。

| 字段            | 类型      | 说明                                                                                        |
| --------------- | --------- | ------------------------------------------------------------------------------------------- |
| `id`            | UUID      | 唯一标识                                                                                    |
| `name`          | string    | 项目显示名称                                                                                |
| `description`   | string    | 项目描述（业务用途）                                                                        |
| `usage_context` | object    | 使用上下文（V1+，按 `(project, repo)`）：使用场景、使用政策、工作流；以及领域术语与项目约定 |
| `created_at`    | timestamp | 创建时间                                                                                    |
| `updated_at`    | timestamp | 最后更新时间                                                                                |

**ProjectRepository（M:N 关联表）：**

| 字段            | 类型 | 说明                                       |
| --------------- | ---- | ------------------------------------------ |
| `project_id`    | UUID | Project 引用                               |
| `repository_id` | UUID | Repository 引用（可属于不同 Organization） |

**ProjectMember：**

| 字段         | 类型   | 说明                                                 |
| ------------ | ------ | ---------------------------------------------------- |
| `user_id`    | UUID   | 用户引用                                             |
| `project_id` | UUID   | Project 引用                                         |
| `role`       | string | `project_owner` / `project_admin` / `project_viewer` |

**双层访问规则：** Project 成员身份只决定能否看到项目存在；项目内任何 Repository 的内容访问始终由 `repo:*` 权限控制——项目视图按用户可访问的 Repository 子集组装。

**V0 状态：** Project 在领域模型中定义，但 **V0 不实现其功能**（Project CRUD、使用上下文、跨 Repository 知识聚合、`get_project_context` 均在 V1+ 提供）。

# 3. Platform Webapp

面向开发者的主应用，用于管理 API 知识资产，使其可被 Agent 发现和使用。

## 3.1 认证系统

| 功能             | 说明                                                            | V0 状态                                     |
| ---------------- | --------------------------------------------------------------- | ------------------------------------------- |
| **邮箱注册**     | 邮箱 + 密码注册                                                 | ✅ 已实现（暂无邮箱验证）                   |
| **邮箱登录**     | 在 `users` 表校验凭据，然后签发签名 Cookie                      | ✅ 已实现                                   |
| **SSO 登录**     | GitHub OAuth、Google OAuth                                      | ⏳ 未实现（已预留 `auth.providers` 配置槽） |
| **密码重置**     | 通过邮箱重置密码                                                | ⏳ 未实现                                   |
| **Session 管理** | HMAC-SHA256 签名 httpOnly Cookie（`apigent_session`），登出清除 | ✅ 已实现（V0 无 Refresh Token / 吊销）     |

## 3.2 用户配置

| 功能             | 说明                    |
| ---------------- | ----------------------- |
| **个人资料编辑** | 名称、头像、简介        |
| **安全设置**     | 修改密码、管理 SSO 绑定 |
| **通知偏好**     | 邮件通知设置            |

## 3.3 Organization 管理

| 功能                  | 说明                                   |
| --------------------- | -------------------------------------- |
| **创建 Organization** | 填写名称 + slug，创建者自动成为 Owner  |
| **邀请成员**          | 通过邮箱邀请，指定角色                 |
| **成员列表**          | 查看所有成员及其角色                   |
| **角色管理**          | Owner/Admin 可修改成员角色             |
| **退出/移除**         | 成员可主动退出；Owner/Admin 可移除成员 |

## 3.4 首页 Dashboard

登录后展示：

- **仓库概览**：跨 Organization 的仓库列表，显示最后更新时间和 API 数量
- **最近活动**：最近的导入、编辑、成员变更
- **快捷操作**：创建 Organization、创建仓库、导入 OpenAPI
- **全局搜索**：跨仓库搜索 API

## 3.5 仓库管理

### 3.5.1 创建与导入

| 操作             | 说明                                                        |
| ---------------- | ----------------------------------------------------------- |
| **创建仓库**     | 填写名称 + 可选描述                                         |
| **导入 OpenAPI** | 上传 JSON/YAML 文件，或从 URL 获取；确认后异步执行（见 §7） |
| **自动识别版本** | 从 OpenAPI `info.version` 字段提取版本号                    |
| **校验**         | 导入前验证 Spec 合法性，展示错误信息                        |

> **异步执行（V0 目标）**：提交后立即返回任务 ID，解析/落库由队列 Worker 在后台执行，进度通过顶栏消息通知与仓库状态徽章可见（详见 [Async Queue 模块文档](./modules/async-queue.md)）。

### 3.5.2 内容展示

仓库内容支持两种浏览视图：

**接口视图（Endpoints View）：**

- 按 tag 分组列出所有 API 接口
- 每个接口展示：HTTP 方法、路径、摘要、能力意图（来自 Business Context Agent）
- 点击展开：请求/响应 Schema、业务规则、示例、关联 API

**数据模型视图（Data Models View）：**

- 列出 OpenAPI 中定义的所有 Schema/Component
- Schema 树形可视化：字段类型、约束、描述
- 交叉引用：哪些接口使用了该模型

### 3.5.3 版本管理

| 功能          | 说明                             |
| ------------- | -------------------------------- |
| **版本列表**  | 完整导入历史 + 时间戳            |
| **版本 Diff** | 任意两个版本的并列对比           |
| **版本回滚**  | 回退到历史版本                   |
| **导出**      | 下载任意版本的 OpenAPI JSON/YAML |

## 3.6 API 搜索与知识检索

面向开发者的 API 发现和理解入口。详细检索架构和 RAG 流水线设计见 Agent 实现文档，本节仅做功能级概要描述。

### 3.6.1 V0 — 语义搜索

| 功能           | 说明                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **全局搜索栏** | Dashboard 和仓库页面均可使用，自然语言输入                                                                                                           |
| **混合搜索**   | Embedding（Dense）+ BM25（Sparse）+ Knowledge Graph——RRF 融合 + Cross-encoder 精排。详见 [Semantic Search Agent](./modules/semantic-search.agent.md) |
| **权限感知**   | 基于 RBAC effective permissions 检索前过滤——用户只能搜到有权限访问的 API                                                                             |
| **搜索范围**   | 全局搜索（跨所有有权限的仓库）或限定单个仓库/Organization                                                                                            |
| **筛选条件**   | 按 HTTP 方法、tag、路径前缀过滤                                                                                                                      |
| **结果展示**   | 方法 + 路径、能力意图摘要、匹配原因、相关度评分                                                                                                      |
| **快捷跳转**   | 点击结果 → API 详情页                                                                                                                                |

**实现方式：** [Semantic Search Agent](./modules/semantic-search.agent.md)——与 MCP `search_apis` 共用同一引擎。每次查询 LLM 调用 ≤1 次（query rewriting 可选；检索步骤为确定性操作）。

### 3.6.2 V1 — RAG 知识问答

基于 RAG 的对话式 API 知识问答。

| 功能           | 说明                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **对话式问答** | 多轮对话，可自然追问                                                                                                        |
| **RAG 流水线** | Query Rewriting → 权限预过滤 → 混合检索（Embedding + BM25 + KG）→ RRF 粗排 → Cross-encoder 精排 → 上下文拼装 → LLM 回答生成 |
| **来源引用**   | 每个回答附带引用链接，指向具体的 API 和模型                                                                                 |
| **知识范围**   | 单个仓库内，或跨 Organization 仓库                                                                                          |

**检索实现详见：** [Semantic Search Agent](./modules/semantic-search.agent.md) 涵盖 chunk 策略、BM25 + Embedding 混合检索、query rewriting、权限过滤、两阶段排序的完整设计。

---

## 3.7 Agent 辅助编辑

| 功能             | 说明                                           |
| ---------------- | ---------------------------------------------- |
| **增强接口描述** | LLM 根据路径、方法和 Schema 生成/改进 API 描述 |
| **增强仓库描述** | LLM 根据 API 列表生成仓库概览                  |
| **Diff 展示**    | AI 建议应用前，展示修改内容的并列对比          |
| **接受/拒绝**    | 用户逐条确认或拒绝修改建议                     |
| **手动修改**     | 用户可在此基础上手动调整                       |

这是**用户主动触发**的 LLM 调用，独立于导入时的自动 Business Context 推断。

## 3.8 权限控制

Apigent 的 RBAC 模型（定义见 [2.8 RBAC 模型](#28-rbac-模型)）在 Platform Webapp 中通过以下交互体现：

### 3.8.1 Organization 级角色管理

| 功能             | 说明                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| **角色分配**     | 邀请成员或编辑已有成员时，分配 Organization 角色：`org_owner`、`org_admin`、`org_member`                              |
| **隐含仓库角色** | `org_owner` 隐式持有组织内所有仓库的 `repo_owner`；`org_admin` 隐式持有 `repo_admin`；`org_member` 不隐含任何仓库角色 |
| **角色变更**     | Organization Owner/Admin 可随时修改成员角色                                                                           |
| **转让所有权**   | Organization Owner 可将所有权转让给其他成员                                                                           |

### 3.8.2 仓库成员

| 功能         | 说明                                                                                 |
| ------------ | ------------------------------------------------------------------------------------ |
| **管理入口** | 仓库设置 → 成员（`/repos/:id/settings/members`）；组织成员管理仍在组织页，两者不混用 |
| **成员列表** | 一张表列出显式成员（可改角色、可移除）与组织隐含成员（只读、标注来源）               |
| **添加成员** | 从该组织的成员里选，任意一级仓库角色都可授予；授予者需 `repo_admin`+                 |
| **有效权限** | **先看仓库成员行，再看上级组织角色**——所以显式行可以把组织管理员在该仓库上收口为只读 |
| **新建仓库** | 创建者自动成为该仓库的 `repo_owner`                                                  |

### 3.8.3 权限场景示例

| 场景               | 设置                                                    | 效果                                                |
| ------------------ | ------------------------------------------------------- | --------------------------------------------------- |
| **新成员加入组织** | 邀请为 `org_member`                                     | 能在仓库目录里看到所有仓库，但打不开任何一个（403） |
| **加入某个仓库**   | `org_member` + 仓库 A 设为 `repo_member`                | 可编辑仓库 A；其他仓库仍打不开                      |
| **组织管理员**     | `org_admin`                                             | 组织内所有仓库都能打开、能管成员（除删除仓库外）    |
| **对单个仓库收口** | `org_admin` + 仓库 C 显式设为 `repo_viewer`             | 仓库 C 上只有只读——显式行优先于组织角色             |
| **MCP 访问**       | 仓库 C 的 `repo_admin`，且 Secret Key 具有 `mcp:*` 范围 | 可对仓库 C 使用 MCP 工具                            |

## 3.9 MCP 设置

| 功能             | 说明                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| **按仓库开关**   | 为每个仓库独立开启/关闭 MCP 访问                                                                     |
| **访问范围控制** | 控制暴露哪些工具。V0：`search_apis` + `get_api_detail`；`get_project_context` 随 Project 在 V1+ 提供 |
| **用量监控**     | 按 Key 查看 MCP 调用次数和历史                                                                       |
| **连接信息**     | 展示 MCP 端点 URL，用户配置到 Cursor/Claude 中                                                       |

## 3.10 Secret Key 管理

| 功能              | 说明                                        |
| ----------------- | ------------------------------------------- |
| **生成 Key**      | 创建新 API Key，指定名称和权限范围          |
| **查看 Key 列表** | 展示所有 Key 的前缀、范围、创建/过期时间    |
| **原始 Key 展示** | 完整 Key 仅在创建时展示一次（安全最佳实践） |
| **轮换 Key**      | 生成新 Key、废弃旧 Key                      |
| **删除 Key**      | 立即吊销 Key                                |
| **用量追踪**      | 最后使用时间、调用次数                      |

Key 格式：`apigent_sk_<random_hex>`

---

# 4. Admin Webapp

面向**部署运营方**的独立应用，仅持有平台管理员角色（`admin_members`，当前为 `admin_super`，见 §2.8.5）的用户可访问。

**范围边界：** Admin Webapp 不是管理租户数据的地方。Organization 与 Repository 的成员、角色与内容都在 **Platform Webapp**（§3.8）管理——包括仓库成员。Admin 对租户数据只读，其唯一的写能力是管理"谁是平台管理员"。

## 4.1 认证

| 功能               | 说明                                       | V0 状态                                 |
| ------------------ | ------------------------------------------ | --------------------------------------- |
| **管理员登录**     | 独立于 Platform Webapp 的登录流程          | ⏳ 未实现（V0 只有无鉴权的壳）          |
| **管理员权限检查** | 仅 `admin_super` 持有者可访问（见 §2.8.5） | ⏳ 未实现（`admin_members` 表尚未创建） |
| **Session 隔离**   | 管理员会话使用独立 Cookie 与独立签名密钥   | ⏳ 未实现                               |

## 4.2 仪表盘与统计

| 指标         | 说明                                   |
| ------------ | -------------------------------------- |
| **用户数**   | 注册用户总数、新增用户（日/周）        |
| **组织数**   | 组织总数、活跃组织数                   |
| **仓库数**   | 仓库总数、已开启 MCP 的仓库数          |
| **API 数量** | 全平台 API 端点总数                    |
| **MCP 用量** | MCP 调用总量、按仓库、按 Key、时间序列 |
| **活跃用户** | DAU/WAU/MAU 统计                       |

## 4.3 用户管理

这些是**实例级账号操作**——与 Organization / Repository 成员管理是两条不同的轴，后者留在 Platform Webapp。

| 功能         | 说明                                    |
| ------------ | --------------------------------------- |
| **用户列表** | 可搜索、可筛选的全量用户列表            |
| **用户详情** | 完整个人信息、所属组织、仓库、活动日志  |
| **禁用账号** | 临时暂停用户账号                        |
| **启用账号** | 重新激活已禁用的账号                    |
| **删除账号** | 永久删除用户及其数据（需确认 + 冷却期） |

账号生命周期能力（`admin:users:disable` / `admin:users:delete`）**已预留但 V0 不实现**——它们是把平台侧引入第二档管理员（`admin_operator` / `admin_support`）时最自然的第一批能力。

## 4.4 安全审计

| 功能             | 说明                                           |
| ---------------- | ---------------------------------------------- |
| **操作日志**     | 审计追踪：谁在何时做了什么、来源 IP            |
| **登录历史**     | 每个用户的登录记录（IP、User Agent）           |
| **异常检测**     | 标记异常模式（新 IP、大量 API 调用、批量导出） |
| **Key 泄露检查** | 检测 Secret Key 是否出现在公开仓库或暴露环境中 |

---

# 5. 技术架构

## 5.1 应用结构

```
apps/
├── platform/          # Platform Webapp —— Next.js App Router（端口 3000）
│   └── src/
│       ├── app/       # 页面 + 路由处理器（src/app/api/** 即 Platform REST API）
│       ├── components/ # React 组件
│       ├── services/  # Webapp 侧胶水层，调用 @apigent/server
│       └── lib/       # Zod 契约、withRoute 包装、日志、错误处理
├── admin/             # Admin Webapp —— Next.js App Router（端口 3001，V0 仅壳）
│   └── src/
└── open/              # Open Gateway —— Hono 进程（端口 3002）
    └── src/index.ts   # 当前 `/` + `/health`；MCP 端点规划在 V1

packages/
├── core/              # 配置（YAML + .env）、DI 容器、共享类型、i18n、agent registry
├── server/            # 领域与基础设施，与框架无关：
│                      # db（Drizzle Schema + 迁移）、openapi parser、imports、versions、
│                      # contexts、queue、auth、authz、notifications、logging、ai（AI SDK 适配器）
└── ui/                # shadcn/ui 组件（Base UI + Tailwind v4）
```

> **说明：** 以上即当前仓库结构。`packages/server` 是**共享库**，不是独立服务——它没有 HTTP 入口，由 Next.js Webapp 直接引用（后续也会被 Hono 网关引用）。目前没有 `mcp/` 或 `jobs/` 目录——MCP Gateway 与 BullMQ 工作进程仍是设计，尚未实现。

### API 分别跑在哪里？

Platform REST API 与面向 Agent 的 MCP 接入面刻意采用不同运行时：

| 接入面                       | 运行时                                                                             | 原因                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Platform REST API**        | Next.js 路由处理器（`apps/platform/src/app/api/**`）→ 同进程调用 `@apigent/server` | 与 Webapp 共享进程与部署目标：没有 HTTP 跳转，V0 不需要多跑一个服务。服务层保持与框架无关，未来可被任意运行时复用。                                   |
| **面向 Agent 的网关（MCP）** | Hono（`apps/open`）                                                                | 机器间流量与页面渲染的扩缩特性、生命周期不同：可独立部署、扩缩、监控；常驻进程不受 Serverless 10–60s 限制，而 `search_apis` 这类 LLM 工具有可能超限。 |

“把 API Server 与 Next.js 分离”的原始理由依然成立——只是它现在适用于**网关**，而不是 Webapp 的 REST API。`apps/open` 已声明 `@modelcontextprotocol/sdk`，V1 挂载 MCP 端点后会直接调用 `@apigent/server`（内部调用无 HTTP 开销）。

### MCP 传输模式

> **状态：** 已设计，尚未实现。`apps/open` 的 Hono 进程目前只提供 `/` 与 `/health`；尚无 `/mcp` 端点或工具注册（`@modelcontextprotocol/sdk` 是声明依赖，但未使用）。

Apigent 的 MCP Gateway 使用 **Streamable HTTP**（2025 规范），而非旧的 SSE 传输：

| MCP Tool                     | 传输模式        | 说明                      |
| ---------------------------- | --------------- | ------------------------- |
| `search_apis`                | 标准请求 → 响应 | 一次 HTTP POST，返回 JSON |
| `get_api_detail`             | 标准请求 → 响应 | 一次 HTTP POST，返回 JSON |
| `get_project_context`（V1+） | 标准请求 → 响应 | 一次 HTTP POST，返回 JSON |

所有 tool 都是**普通请求-响应**——不需要流式返回，不需要服务端推送，不需要持久连接。MCP 对 Apigent 的使用场景不需要 SSE 或长连接。分离成独立服务是**架构选择**（独立扩缩 + 部署灵活），而非协议要求。

## 5.2 技术选型

每个可替换组件由 **TypeScript 接口**定义，并附带**默认实现**。用户可通过实现接口并在配置中注册来替换任何组件。详见 [5.5 可扩展架构](#55-可扩展架构)。

| 层               | 默认实现                                    | 抽象接口            | 选型理由                                                                             |
| ---------------- | ------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------ |
| **Webapp 前端**  | Next.js App Router、React、TypeScript       | —                   | SSR、Streaming、Server Components、丰富生态                                          |
| **Webapp 样式**  | Tailwind CSS                                | —                   | 原子化 CSS，快速 UI 开发                                                             |
| **Platform API** | Next.js 路由处理器 + `@apigent/server`      | —                   | 与 Platform Webapp 同进程：没有 HTTP 跳转，V0 只有一个部署目标；服务层保持与框架无关 |
| **Open Gateway** | Hono（TypeScript）                          | —                   | 面向机器流量（MCP）的独立进程；多运行时、Web 标准 `Request`/`Response`               |
| **类型桥梁**     | Zod Schema + `zod-openapi`                  | —                   | 路由处理器用 Zod 校验；OpenAPI 3.1 文档由同一份 Schema 离线生成                      |
| **数据库**       | PostgreSQL                                  | `DatabaseAdapter`   | V0 关系型存储；仅支持 PostgreSQL（Drizzle pg-core Schema）                           |
| **向量存储**     | pgvector                                    | `VectorStore`       | V0 阶段 PG 内向量检索；规模增长后可换 Milvus/Qdrant/Weaviate                         |
| **ORM**          | Drizzle                                     | `DatabaseAdapter`   | SQL 优先、类型安全；V0 使用 PostgreSQL（pg-core）——其他方言规划中，暂未支持          |
| **异步任务**     | Postgres 队列（V0）/ BullMQ + Redis（扩容） | `QueueProvider`     | OpenAPI 导入、LLM 推理、批处理——可通过配置切换 RabbitMQ/SQS                          |
| **认证**         | Credentials + HMAC 签名 Cookie              | `AuthProvider`      | V0 用邮箱 + 密码 + 无状态签名 httpOnly Cookie；接口是后续接 OAuth/OIDC/LDAP 的扩展点 |
| **LLM**          | Qwen API（阿里云百炼）                      | `LLMProvider`       | Structured Output、Function Calling；可换 Claude/OpenAI/Gemini/本地模型              |
| **Embedding**    | Qwen Embedding（text-embedding-v4）         | `EmbeddingProvider` | 语义搜索向量化；可换 Claude/OpenAI/Cohere/本地 Embedding 模型                        |
| **MCP**          | @modelcontextprotocol/sdk                   | —                   | 标准 MCP 实现，Streamable HTTP 传输                                                  |
| **存储**         | 本地文件系统                                | `StorageProvider`   | OpenAPI 文件存储；可换 S3/MinIO/Google Cloud Storage                                 |
| **Diff**         | diff（或自研渲染器）                        | —                   | 版本对比和 AI 编辑建议展示                                                           |

> **实现状态：** LLM 调用已可用——产品代码（业务上下文生成、Agent 运行时）走 `@apigent/server/ai`（基于 Vercel AI SDK 的 `createAIModel()`），DI 容器里的 `getLLM()` 仍是快速失败的桩。容器只注册了 `memory` 向量库、`local` 存储与 Postgres 队列；Embedding、pgvector、BullMQ 以及 MCP Gateway 只在 config/types 中定义，尚无工厂实现——`getEmbedding()`、`getVectorStore()`（非 `memory`）、`getQueue()`（非 `postgres`/`memory`）都会以 `not implemented` 快速失败（参见 `packages/core/src/di/container.test.ts`）。

## 5.3 API 层设计

```
                       ┌──────────────────────────────┐
                       │  内部 Webapp                 │
                       │  （Platform / Admin）        │
                       │  认证：Session Cookie        │
                       └──────────────┬───────────────┘
                                      │ 同进程服务调用
                                      │（Next.js 路由处理器 → @apigent/server）
                       ┌──────────────┴───────────────┐
                       │  外部开发者 / SDK             │
                       │  认证：Bearer SecretKey      │
                       │  （api:* scopes）            │
                       └──────────────┬───────────────┘
                                      │ 按 OpenAPI 规范提供 REST（尚未对外提供）
                       ┌──────────────┴───────────────┐
                       │  外部 AI Agent               │
                       │  认证：Bearer SecretKey      │
                       │  （mcp:* scopes）            │
                       └──────────────┬───────────────┘
                                      │ MCP（Streamable HTTP）
                                      ▼
                      Open Gateway（Hono，apps/open）
                      └── MCP Gateway（规划中）→ 直接调用 @apigent/server
                                      │
                                      ▼
                        PostgreSQL（+ pgvector / pg-fts）
```

**三种调用方式——一份 REST 契约、三条认证路径：**

| 调用方式      | 通道                                                            | 认证                              | 类型安全                  |
| ------------- | --------------------------------------------------------------- | --------------------------------- | ------------------------- |
| 内部 Webapp   | Next.js 路由处理器（`withRoute`）→ 同进程调用 `@apigent/server` | Session Cookie（HMAC 签名）       | 共享 Zod Schema + TS 类型 |
| 外部 OpenAPI  | 按导出的 OpenAPI 规范提供 REST（尚未对外提供）                  | Bearer SecretKey + `api:*` scopes | OpenAPI 生成 SDK          |
| 外部 AI Agent | MCP Gateway（Streamable HTTP，规划中）                          | Bearer SecretKey + `mcp:*` scopes | MCP SDK                   |

- **一份契约**：路由处理器用 `apps/platform/src/lib/openapi-schemas.ts` 的共享 Zod Schema 校验；OpenAPI 3.1 文档由 `zod-openapi` 从同一份 Schema 生成并写入 `apps/platform/openapi/platform.json`（`pnpm openapi:platform`）。校验与文档不会漂移。
- **规范覆盖范围**：当前导出的文档覆盖公开的 auth 与 organization 路由；运行时不再提供该文档。
- **MCP Gateway** 将位于 `apps/open` 这个 Hono 进程，直接调用 `@apigent/server`（内部调用无 HTTP 开销），对外暴露 Streamable HTTP 端点。
- **两个 Webapp** 是独立的 Next.js 实例，各自托管页面；Platform APP 同时托管 Platform REST API。`apps/open` 是唯一的 Hono 进程，可单独扩缩。
- **异步任务**（OpenAPI 导入、Business Context LLM 推理）通过 `QueueProvider` 调度（V0 默认 Postgres 队列，可通过 `apigent.config.yaml` 切换 BullMQ + Redis），由独立 Worker 执行，不阻塞 HTTP 请求（见 [Async Queue 模块文档](./modules/async-queue.md)）。

## 5.4 认证与 RBAC 实现

### 5.4.1 架构概览

身份认证（"你是谁"）和权限授权（"你能做什么"）是分离的关注点，由不同层处理：

```
浏览器请求
    │
    ▼
┌──────────────────────────────────────────────┐
│  Next.js 路由处理器 / Server Component         │
│                                              │
│  ┌────────────────────┐                      │
│  │ 1. 身份认证         │  @apigent/server/auth│
│  │    校验签名 Cookie   │  "你是谁？"          │
│  └────────┬───────────┘                      │
│           │                                   │
│  ┌────────▼───────────┐                      │
│  │ 2. 权限授权         │  @apigent/server/authz│
│  │    有效角色          │  "你能做什么？"       │
│  └────────┬───────────┘                      │
│           │                                   │
│  ┌────────▼───────────┐                      │
│  │ 3. 服务调用         │                      │
│  │    页面 / API / MCP  │                      │
│  └────────────────────┘                      │
└──────────────────────────────────────────────┘
```

这里**没有 `middleware.ts`**：认证在每个入口显式执行——路由处理器调用 `withRoute({ auth: true })`，在业务逻辑前解析会话用户、未登录直接返回 401；需要登录的页面位于 `(authed)` 路由组，其 layout 调用 `getSessionUser()`，未登录时跳转 `/login`。授权在服务层由 `assertRepoAccess()` / `assertOrgRole()` 执行。两层都信任同一个签名 Cookie，身份只有一个事实来源。

### 5.4.2 认证流程（credentials + 签名 Cookie）

V0 使用自研的 credentials 认证，而非 NextAuth.js。邮箱 + 密码在 `users` 表中校验（scrypt 哈希），会话是**无状态的 HMAC-SHA256 签名 Cookie**——没有 session 表，验证 token 本身也不需要查库。

**Token 格式：**

```
base64url(JSON { uid, iat, exp }) + "." + base64url(HMAC-SHA256(payload, auth.secret))
```

**实现（`packages/server/src/auth/`）：**

```ts
// packages/server/src/auth/session.ts
export const SESSION_COOKIE = "apigent_session";

function sign(payload: string): string {
  return createHmac("sha256", getAuthConfig().secret).update(payload).digest("base64url");
}

export function createSessionToken(userId: string): string {
  /* uid + iat + exp，再签名 */
}
export function verifySessionToken(token: string): SessionPayload | null {
  /* 恒定时间比较 */
}
```

**配置（`apigent.config.yaml` + `.env`）：** `auth.providers: [credentials]`；签名密钥与有效期来自 `APIGENT_AUTH_SECRET`（`auth.secret`）与 `auth.sessionMaxAge`。OAuth 尚未实现——`auth.providers` 是为它预留的配置槽。

**会话 Payload：**

```ts
{
  uid: "user_abc123",  // 用户 ID
  iat: 1722000000,     // 签发时间（秒）
  exp: 1722600000,     // 过期时间（配置项：auth.sessionMaxAge）
}
```

> **V0 已知限制：** 签名是对称的，且没有吊销列表——登出只在客户端清除 Cookie，已签发的 token 在 `exp` 前依然有效。若需要吊销能力，升级路径是引入 session 表或密钥轮换。

### 5.4.3 RBAC 权限检查

核心权限检查函数在每次需要授权的请求中调用。它解析用户对特定资源的**有效权限**。

**解析顺序：**

```
checkPermission → 有效角色

步骤 1：解析用户在该仓库的显式成员身份
        └── repository_members（repositoryId, userId）→ 仓库角色（可能不存在）
        └── 命中则**直接采用**，不再看组织角色

步骤 2：否则解析用户对所属 Organization 的角色
        └── organization_members.role，回退到 organizations.owner_id → org_owner
        └── org_owner  → repo_owner（隐式）
        └── org_admin  → repo_admin（隐式）
        └── org_member → 无隐式角色

步骤 3：两者都没有 → 无内容访问权（ForbiddenError → 403）

步骤 4：与所需最低角色比较等级
        └── rank(有效角色) >= rank(所需角色) → 通过
        └── 否则                             → 拒绝（ForbiddenError → 403）
```

**参考实现（`packages/server/src/authz/`）：**

```ts
// packages/server/src/authz/roles.ts —— 纯角色模型，无 DB 依赖
export type OrgRole = "org_owner" | "org_admin" | "org_member";
export type RepoRole = "repo_owner" | "repo_admin" | "repo_member" | "repo_viewer";

const ORG_RANK = { org_member: 1, org_admin: 2, org_owner: 3 };
const REPO_RANK = { repo_viewer: 1, repo_member: 2, repo_admin: 3, repo_owner: 4 };

/** Organization 角色隐含的仓库角色；org_member 不隐含任何角色 */
export function orgRoleToRepoRole(role: OrgRole | null | undefined): RepoRole | null {
  /* owner→owner、admin→admin、member/null→null */
}

/** 有效仓库角色：先看仓库成员行，再看组织角色；都没有则为 null */
export function resolveEffectiveRepoRole(
  orgRole?: OrgRole | null,
  memberRole?: RepoRole | null,
): RepoRole | null {
  return memberRole ?? orgRoleToRepoRole(orgRole);
}

export function isRepoRoleAtLeast(role: RepoRole | null, min: RepoRole): boolean {
  return !!role && REPO_RANK[role] >= REPO_RANK[min];
}
```

```ts
// packages/server/src/authz/index.ts —— 路由处理器使用的 DB 检查
getUserOrgRole(userId, organizationId); // organization_members.role，owner 兜底
getRepoMemberRole(userId, repositoryId); // repository_members.role
getEffectiveRepoRole(userId, repositoryId); // 先成员行、后组织角色
assertRepoAccess(userId, repositoryId, min); // 抛 ForbiddenError → 403
assertOrgRole(userId, organizationId, min);
listAccessibleRepositoryIds(userId); // 显式成员 ∪ 我是 org_admin/owner 的组织下全部仓库
```

**显式成员行优先，所以它可以向下覆盖**：把某位 `org_admin` 在单个仓库上设为 `repo_viewer`，他在这一个仓库上就真的只有只读。这是刻意的——用于对敏感仓库收口。

**平台作用域单独解析。** `admin_members` 是不同的表、不同的词汇（§2.8.5–2.8.7）：平台能力用 `assertAdminCapability(userId, "admin:admins:manage")` 校验，**绝不**走租户角色阶梯。两套体系只有一个交汇点——`withRoute` 上的资源声明决定某条路由适用哪一套。

**rank 与 permission。** 租户能力是**真嵌套**的（`repo_viewer ⊂ repo_member ⊂ repo_admin ⊂ repo_owner`），所以判定沿用 rank 比较。平台体系与它们正交，因此改用命名能力（`admin:<域>:<动作>`，§2.8.6）。如果将来租户侧出现非嵌套需求（例如"能管仓库成员但不能激活主版本"），那就是在租户侧引入 capability 层的信号——命名约定已经在 §2.8.2 备好；在那之前，rank 更简单且不会漂移。

### 5.4.4 鉴权执行（三层）

鉴权分层执行：入口层让它**不可能被漏掉**，服务层表达业务级要求，后台 Worker 以系统主体运行。

| 层       | 位置                                  | 职责                                                        |
| -------- | ------------------------------------- | ----------------------------------------------------------- |
| 入口声明 | `withRoute` 选项（`lib/route.ts`）    | 声明路由操作的资源与最低角色——没有声明就没有处理器          |
| 服务断言 | `packages/server/src/authz` 调用点    | 把细粒度要求写在它保护的操作旁边                            |
| 系统主体 | 队列 Worker（`imports` / `contexts`） | 授权发生在**入队**时；Worker 以 system 主体执行，不重复校验 |

**入口声明**（目标形态）：

```ts
export const POST = withRoute(
  { auth: true, repo: { param: "id", min: "repo_member" } },
  async ({ request, params, user }) => { … },
);

{ auth: true, org:   { param: "id", min: "org_admin" } }
{ auth: true, admin: "admin:admins:manage" }
```

**服务断言**——同一要求直接声明，非 HTTP 调用方也能覆盖：

```ts
await assertRepoAccess(user.id, id, "repo_member");
await assertOrgRole(user.id, organizationId, "org_admin");
```

**系统主体**——入队的导入任务在创建时已通过授权，Worker 没有可校验的请求上下文，因此**不应**重复做用户校验。重试类端点由 HTTP 触发，**仍要**在入口层重新校验。

**页面**依赖 `apps/platform/src/app/(authed)/layout.tsx` 做认证；资源级授权在页面的数据加载处执行：

```tsx
const user = await getSessionUser();
if (!user) redirect("/login");
```

认证对每个请求只解析一次，来源是签名 Cookie——API 走 `withRoute`，页面走 `getSessionUser()`——绝不信任客户端传入的值。公开路由（登录、注册）不加 `auth: true` 即可放行。

这里没有 `middleware.ts`：Next.js 中间件无法把 `AsyncLocalStorage` 传入路由处理器，因此由 `withRoute` 在入口开启日志上下文（reqId / userId）并校验会话。

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
│  4. 传入 userId + repositoryId 到       │
│     RBAC 检查仓库访问权限         │
└─────────────────────────────────┘
```

### 5.4.6 共享 Auth 代码结构

认证代码放在 `packages/server`（所有运行时共享），Platform APP 里只有一层很薄的 Next.js 胶水：

```
packages/server/src/auth/           # credentials + session 原语（与运行时无关）
├── index.ts                        # barrel：SESSION_COOKIE、createSessionToken、verifySessionToken…
├── password.ts                     # hashPassword() / verifyPassword()（scrypt）
└── session.ts                      # HMAC-SHA256 签名 Cookie payload

packages/server/src/authz/          # RBAC
├── roles.ts                        # 纯角色模型 + 等级比较（无 DB）
└── index.ts                        # assertRepoAccess()、assertOrgRole()、listAccessibleRepositoryIds()

apps/platform/src/services/auth.ts  # Next.js 胶水：cookies() + users 表 → SessionUser
apps/platform/src/lib/route.ts      # withRoute({ auth: true }) —— 业务逻辑前返回 401
apps/platform/src/lib/repo-guard.ts # guardRepoAccess() —— 入口层仓库断言，403
apps/platform/src/services/repo-members.ts # 仓库成员读写（显式成员 + 组织隐含成员）
```

**关键设计决策：**

| 决策                                 | 理由                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| HMAC 签名 Cookie（而非 session 表）  | 验证 token 不需要查库；V0 明确不要求吊销能力                                                                                               |
| httpOnly cookie（而非 localStorage） | 免疫 XSS 攻击；浏览器自动在每次请求中携带 cookie                                                                                           |
| Auth 原语放在 `packages/server`      | Platform Webapp 与未来的 Hono 网关用同一份代码校验同一个 Cookie                                                                            |
| 入口层校验（而非 `middleware.ts`）   | Next.js 中间件无法把 `AsyncLocalStorage` 传入路由处理器，因此由 `withRoute` 在入口开启日志上下文并校验会话；授权则紧贴它所保护的操作用执行 |
| MCP 使用 API Key（而非 Session）     | 外部 Agent（Cursor/CLI）没有浏览器 Session；Bearer token 是标准的机器间认证模式                                                            |

### 5.4.7 审计日志

每一次特权变更都必须**与业务写操作在同一事务内**写入 `operation_logs`。否则会出现"变更成功、日志缺失"，而这条审计链是"平台管理员无法触碰租户数据"这条边界唯一可验证的证据。

需要记录的事件（完整方案见 [modules/audit-log.md](./modules/audit-log.md)）：

| 事件                                                       | 操作者               | 说明                   |
| ---------------------------------------------------------- | -------------------- | ---------------------- |
| `admin.grant` / `admin.revoke`                             | `admin_super`        | 平台侧**唯一**的写操作 |
| `member.invite` / `member.role_change` / `member.remove`   | `org_admin`+         | 组织成员变更           |
| `repo.member_add` / `member_role_change` / `member_remove` | 该仓库 `repo_admin`+ | 仓库成员变更           |
| `org.transfer`                                             | `org_owner`          | 组织所有权转移         |
| `admin.login`                                              | `admin_super`        | 可选                   |

`operation_logs.organizationId` 在平台级操作时为 NULL，而现有索引是 `(organizationId, operationType, createdAt)`——NULL 行不参与该索引，因此查询平台级事件需要额外索引或不同的查询条件。

### 5.4.8 已知缺口与落地顺序

上面的模型是目标态。**已落地：**

- ✅ **仓库级鉴权覆盖全部 HTTP 入口**——每个接收 `repositoryId` 的路由都在入口层断言最低仓库角色（守卫见 `apps/platform/src/lib/repo-guard.ts`：读 `repo_viewer`、写与导入 `repo_member`、改默认版本指向与成员管理 `repo_admin`）。`getContextTask` / `retryContextTask` / `getImportTask` / `retryImportTask` 额外按 `repositoryId` 过滤——任务 id 全局唯一，只校验 URL 里的仓库不够，否则换个仓库前缀就能读到别的仓库的任务。把这些断言收敛为 `withRoute({ repo: … })` 的声明式写法仍待做（§5.4.4）。
- ✅ **版本权限一致**——`activate` 与 `rollback` 现在都要求 `repo_admin`。
- ✅ **仓库成员可管理**——`repository_members` 表取代了旧的 `repo_permissions` 覆盖层，仓库成员页（`/repos/:id/settings/members`）列出显式成员与组织隐含成员，支持添加 / 改角色 / 移除（`GET/POST /api/repos/:id/members`、`PATCH/DELETE /api/repos/:id/members/:userId`）。写入侧强制"目标必须是组织成员"，并允许显式行向下覆盖（§2.8.4）。**尚未接线审计**——`repo.member_*` 事件要等下面第 1 项完成后补上。

**剩余缺口**，按应修复的顺序排列：

1. **审计未接线**——表已建，无人写入。成员变更（`member.*`、`repo.member_*`、`org.transfer`）都要与业务写在同一事务内落库。
2. **`admin_members` 尚未创建**——Admin Webapp 目前完全无认证，能访问端口的人都能打开。
3. **`users.is_platform_admin` 未使用**——`admin_members` 落地时一并删除，保持单一事实来源。
4. **待定项**——`admin_super` 能否读仓库内容（`admin:content:read`）；SecretKey 的签发/校验是否先于外部接口落地；`org:delete` / `repo:delete` / `repo:manage_mcp` 是否先实现（文档已描述，代码未实现）。

建议顺序：1 → 2 → 3 / 4。

### 5.4.9 计划：引入第三方认证（NextAuth）

V0 使用自研 credentials 认证。GitHub / Google 登录已排期，方向是采用 Auth.js / NextAuth，但**仅负责认证**部分——授权仍留在 `packages/server`，如本节所述。

| 决策                                          | 理由                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| NextAuth 只负责身份                           | RBAC 依旧只吃 `userId`，因此路由处理器、`withRoute`、`authz/*` 都不用改                        |
| 新增 `packages/auth` 存放共享配置工厂         | `packages/server` 保持与框架无关；Hono 网关永远不能依赖 `next-auth`                            |
| Platform 与 Admin 各自独立实例、Cookie 与密钥 | Admin 是更高权限面：独立登出、更短有效期、独立密钥轮换                                         |
| 共用 `users` 表，不建独立管理员用户体系       | 管理员本来就是持有平台角色的平台用户；独立身份源会破坏账号绑定                                 |
| 保留邮箱 + 密码登录                           | 自托管部署需要本地兜底——这也是会话保持 JWT 形态的原因（Auth.js credentials 不支持 DB session） |
| 角色永不写入 token                            | 授权每请求从数据库解析，角色变更立即生效                                                       |

迁移成本被 `getSessionUser()` 这个接缝限制住：换的是"用户 id 从哪来"，而不是"怎么被消费"。

## 5.5 可扩展架构

### 5.5.1 设计理念

Apigent 是一个**开源、自托管**的平台。不同团队有不同的基础设施偏好——有的用 Milvus 做向量搜索，有的想用 OpenAI 而非 Qwen。Apigent 不强绑定单一技术栈，而是为每个基础设施关注点定义 **TypeScript 接口**，并提供合理的默认实现。用户通过修改配置来替换实现，无需改动代码。

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

| 组件                 | 接口                | 默认实现                            | 常见替代方案                                                       |
| -------------------- | ------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| **向量存储**         | `VectorStore`       | pgvector                            | Milvus、Qdrant、Weaviate、Pinecone、Chroma                         |
| **LLM 提供商**       | `LLMProvider`       | Qwen API（阿里云百炼）              | Claude、OpenAI、Gemini、Ollama（本地）、vLLM                       |
| **Embedding 提供商** | `EmbeddingProvider` | Qwen Embedding（text-embedding-v4） | Claude Embedding、OpenAI Embedding、Cohere、BGE（本地）            |
| **存储提供商**       | `StorageProvider`   | 本地文件系统                        | AWS S3、MinIO、Google Cloud Storage、Azure Blob                    |
| **队列提供商**       | `QueueProvider`     | Postgres 队列（`PgQueueProvider`）  | BullMQ + Redis、RabbitMQ、AWS SQS                                  |
| **认证提供商**       | `AuthProvider`      | Credentials + HMAC 签名 Cookie      | 自定义 OAuth/OIDC、LDAP、SAML、Authentik（配置槽已预留，尚未实现） |

### 5.5.3 Vector Store 接口

```ts
// packages/core/src/interfaces/vector-store.ts

export interface VectorDocument {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface VectorSearchResult {
  document: VectorDocument;
  score: number;
}

export interface VectorStore {
  /** 插入或更新带 Embedding 的文档 */
  upsert(documents: VectorDocument[]): Promise<void>;

  /** 按向量搜索相似文档 */
  search(
    vector: number[],
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
    },
  ): Promise<VectorSearchResult[]>;

  /** 按 ID 删除文档 */
  delete(ids: string[]): Promise<void>;

  /** 按过滤条件删除文档 */
  deleteByFilter(filter: Record<string, unknown>): Promise<void>;

  /** 检查连接健康状态 */
  health(): Promise<boolean>;
}
```

**默认实现 — pgvector：**

```ts
// packages/vector-store-pgvector/src/pgvector-store.ts
import { VectorStore, VectorDocument, VectorSearchResult } from "@/core/interfaces";
import { sql } from "drizzle-orm";

export class PgvectorStore implements VectorStore {
  async upsert(documents: VectorDocument[]): Promise<void> {
    await this.db
      .insert(embeddings)
      .values(
        documents.map((d) => ({
          id: d.id,
          vector: sql`${JSON.stringify(d.vector)}::vector`,
          metadata: d.metadata,
        })),
      )
      .onConflictDoUpdate({
        target: embeddings.id,
        set: { vector: sql`excluded.vector`, metadata: sql`excluded.metadata` },
      });
  }

  async search(
    vector: number[],
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
    },
  ): Promise<VectorSearchResult[]> {
    const topK = options?.topK ?? 10;
    const rows = await this.db.execute(sql`
      SELECT id, metadata, 1 - (vector <=> ${JSON.stringify(vector)}::vector) AS score
      FROM embeddings
      ORDER BY vector <=> ${JSON.stringify(vector)}::vector
      LIMIT ${topK}
    `);
    return rows.map((r) => ({
      document: { id: r.id, vector: [], metadata: r.metadata },
      score: r.score,
    }));
  }

  // ... delete, deleteByFilter, health
}
```

**替换示例 — Milvus：**

```ts
// 用户项目：my-apigent/vector-store.ts
import { VectorStore, VectorDocument, VectorSearchResult } from "apigent/core";
import { MilvusClient } from "@zilliz/milvus2-sdk-node";

export class MilvusStore implements VectorStore {
  private client: MilvusClient;

  constructor(config: { host: string; port: number; collection: string }) {
    this.client = new MilvusClient({ address: `${config.host}:${config.port}` });
  }

  async upsert(documents: VectorDocument[]): Promise<void> {
    await this.client.insert({
      collection_name: this.collection,
      data: documents.map((d) => ({
        id: d.id,
        vector: d.vector,
        metadata: JSON.stringify(d.metadata),
      })),
    });
  }

  async search(
    vector: number[],
    options?: {
      topK?: number;
      filter?: Record<string, unknown>;
    },
  ): Promise<VectorSearchResult[]> {
    const results = await this.client.search({
      collection_name: this.collection,
      vector,
      limit: options?.topK ?? 10,
    });
    return results.map((r) => ({
      document: { id: r.id, vector: [], metadata: JSON.parse(r.metadata) },
      score: r.score ?? 0,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    await this.client.delete({ collection_name: this.collection, ids });
  }

  // ... deleteByFilter, health
}
```

### 5.5.4 LLM Provider 接口

```ts
// packages/core/src/interfaces/llm-provider.ts

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json_object";
}

export interface ChatResponse {
  content: string;
  usage: { inputTokens: number; outputTokens: number };
}

export interface LLMProvider {
  /** 单轮对话补全 */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse>;

  /** 流式对话补全 */
  chatStream(messages: ChatMessage[], options?: ChatOptions): AsyncIterable<string>;

  /** 列出可用模型 */
  listModels(): Promise<string[]>;
}
```

**默认实现：** `QwenProvider` 封装阿里云百炼 DashScope API（OpenAI 兼容模式）。  
**替代方案：** `ClaudeProvider` 封装 `@anthropic-ai/sdk`，`OpenAIProvider` 封装 `openai` SDK，`OllamaProvider` 封装 Ollama HTTP API，`GeminiProvider` 封装 `@google/generative-ai`。

### 5.5.5 Embedding Provider 接口

```ts
// packages/core/src/interfaces/embedding-provider.ts

export interface EmbeddingProvider {
  /** 为单段文本生成 Embedding */
  embed(text: string): Promise<number[]>;

  /** 为多段文本批量生成 Embedding */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Embedding 向量的维度 */
  readonly dimension: number;
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
  upload(key: string, body: Buffer | ReadableStream, contentType: string): Promise<string>;

  /** 下载文件为 Buffer */
  download(key: string): Promise<Buffer>;

  /** 获取签名 URL 用于直接访问（可选） */
  getSignedUrl?(key: string, expiresInSeconds: number): Promise<string>;

  /** 删除文件 */
  delete(key: string): Promise<void>;

  /** 检查文件是否存在 */
  exists(key: string): Promise<boolean>;
}
```

**默认实现：** `LocalStorageProvider` 存储文件到 `data/uploads/` 目录。  
**替代方案：** `S3StorageProvider`、`MinioStorageProvider`、`GCSStorageProvider`。

### 5.5.7 Queue Provider 接口

```ts
// packages/core/src/types/queue-provider.ts

export interface QueueJob {
  id?: string;
  name: string;
  data: unknown;
}

export interface QueueProvider {
  /** 入队一个任务 */
  enqueue(queue: string, job: QueueJob): Promise<string>;

  /** 注册队列处理器 */
  process(queue: string, handler: (job: QueueJob) => Promise<void>): Promise<void>;

  /** 优雅关闭 */
  shutdown(): Promise<void>;
}
```

队列只负责**调度与投递**；任务业务状态（进度、结果、错误）由业务任务表（如 `repository_tasks`）持久化，`QueueProvider` 本身不做状态查询。

**默认实现（V0）：`PgQueueProvider` — Postgres 队列**（复用现有 PostgreSQL，无需 Redis；消费用 `FOR UPDATE SKIP LOCKED` 抢占，多实例安全；进程重启把遗留 `running` 标记为 `failed(interrupted)`）。

完整设计（`impl_queue_jobs` 表结构、Worker 生命周期、配置切换、OpenAPI 异步导入任务、站内通知、API 契约）见 **[Async Queue & Notifications 模块文档](./modules/async-queue.md)**。

### 5.5.8 配置系统 — 双层设计

Apigent 使用**双层配置系统**，方便开发环境和部署环境之间无缝切换：

| 层           | 文件                  | 放什么                                                                                                              | 示例                                                               |
| ------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **方案选择** | `apigent.config.yaml` | 使用哪个 provider / 模型 / 策略（结构化 YAML，支持注释）                                                            | `llm.provider: qwen`、`rag.retrieval.retrievalMode: hybrid`        |
| **密钥**     | `.env`                | 仅敏感数据：API key、密码、连接字符串。不再提供任何 provider/方案选择环境变量——方案选择一律在 `apigent.config.yaml` | `DASHSCOPE_API_KEY`、`APIGENT_DATABASE_URL`、`APIGENT_AUTH_SECRET` |
| **编程配置** | `apigent.config.ts`   | 自定义 provider 工厂、高级配置（**规划中，V0 未实现**；大多数用户只需 `.yaml` + `.env`）                            | 自定义 `VectorStore` 实现、插件注册                                |

**默认工作流 — apigent.config.yaml + .env（95% 用户）：**

`apigent.config.yaml`（方案选择）：

```yaml
llm:
  provider: qwen
  models:
    default: qwen3.7-plus
    business_context: qwen3.7-plus
    query_rewrite: qwen3.7-flash
    rag_answer: qwen3.7-plus
    editing: qwen3.7-plus

rag:
  chunkStrategy: hierarchical
  embedding:
    provider: qwen
    model: text-embedding-v4
  vectorStore:
    provider: pgvector
    indexType: ivfflat
  searchStore:
    provider: pg-fts
  queryRewrite: true
  retrieval:
    retrievalMode: hybrid
    fusionMethod: rrf
    coarseRankTopK: 20
    fineRankTopK: 10
    reranker:
      provider: qwen
      model: qwen3-rerank
  knowledgeGraph:
    enabled: false
```

`.env`（仅密钥）：

```bash
DASHSCOPE_API_KEY=sk-your-dashscope-key-here
APIGENT_DATABASE_URL=postgresql://localhost:5433/apigent
APIGENT_AUTH_SECRET=your-secret-here
```

配置加载器读取 YAML + .env 并构造完整类型化的 `ApigentConfig`：

```ts
import { loadConfig } from "@apigent/core/config";

const config = loadConfig();
// → 读取 apigent.config.yaml + .env → ApigentConfig
```

**高级工作流 — apigent.config.ts（自定义 provider）：**

> ⚠️ **状态：规划中（V1+）。** `loadConfig()` 目前只读取 `apigent.config.yaml` + `.env`，`ApigentConfig` 字段是纯数据而非工厂。下面的示例描述的是目标设计。

对于自定义 provider 实现，`apigent.config.ts` 在 YAML + env 基础上提供编程式覆盖：

```ts
// apigent.config.ts
import type { ApigentConfig } from "@apigent/core";
import { loadConfig } from "@apigent/core/config";
import { MyCustomVectorStore } from "./my-vector-store";

const base = loadConfig();

const config: ApigentConfig = {
  ...base,
  rag: {
    ...base.rag,
    vectorStore: () => new MyCustomVectorStore({/* ... */}),
  },
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

rag:
  embedding:
    provider: openai
    model: text-embedding-3-small
  vectorStore:
    provider: milvus
    host: milvus-prod.internal
    port: 19530
  searchStore:
    provider: pg-fts
  retrieval:
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
import type { ApigentConfig } from "./config";

export class Container {
  private instances = new Map<string, unknown>();

  constructor(private config: ApigentConfig) {}

  getVectorStore(): VectorStore {
    if (!this.instances.has("vectorStore")) {
      this.instances.set("vectorStore", this.config.rag.vectorStore());
    }
    return this.instances.get("vectorStore") as VectorStore;
  }

  getLLM(): LLMProvider {
    /* ... */
  }
  getEmbedding(): EmbeddingProvider {
    /* ... */
  }
  getStorage(): StorageProvider {
    /* ... */
  }
  getQueue(): QueueProvider {
    /* ... */
  }
}

// 单例——应用启动时初始化一次
let container: Container;

export function initContainer(config: ApigentConfig) {
  container = new Container(config);
}

export function getContainer(): Container {
  if (!container) throw new Error("Container 未初始化");
  return container;
}
```

业务代码绝不直接导入具体实现：

```ts
// ✅ 正确——依赖接口，与具体实现无关
import { getContainer } from "@/core/container";

async function searchApis(query: string) {
  const vectorStore = getContainer().getVectorStore();
  const embeddingProvider = getContainer().getEmbedding();
  const queryVector = await embeddingProvider.embed(query);
  return vectorStore.search(queryVector, { topK: 10 });
}

// ❌ 错误——硬编码依赖，无法替换
import { PgvectorStore } from "@apigent/vector-store-pgvector";
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
  name: string;
  version: string;
  /** 插件注册时调用 */
  register(ctx: PluginContext): void | Promise<void>;
  /** 插件卸载时调用 */
  unregister?(): void | Promise<void>;
}

export interface PluginContext {
  container: Container;
  logger: Logger;
  /** 在平台生命周期中注册钩子 */
  onHook(hook: string, handler: (...args: any[]) => Promise<void>): void;
}
```

插件通过 `apigent.config.ts` 注册：

```ts
const config: ApigentConfig = {
  // ... 核心配置
  plugins: ["./plugins/custom-notification", "./plugins/custom-ai-rule"],
};
```

---

# 6. V0 范围

综合 blueprint 路线图，V0 覆盖最小可用产品：

| 领域             | V0 功能                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------ |
| **认证**         | 邮箱登录/注册、Session 管理                                                                      |
| **Organization** | 创建组织、邀请成员、基础角色                                                                     |
| **仓库**         | 创建仓库、导入 OpenAPI（文件/URL）、版本列表                                                     |
| **版本化**       | 版本分支、快照（commit）、回滚、对比 —— 已提前落地（原计划 V1）                                  |
| **浏览**         | 接口列表（按 tag 分组）、数据模型列表、语义搜索（自然语言）                                      |
| **Core Engine**  | OpenAPI Parser → Business Context Agent（能力上下文；Knowledge Graph 为 V1+ 可选增强，默认关闭） |
| **Secret Key**   | 生成、查看、删除密钥                                                                             |
| **Dashboard**    | 简单仓库列表 + 最近活动                                                                          |
| **Project**      | 仅领域模型定义，V0 不实现功能                                                                    |

> **范围说明：** MCP Gateway 挂载与 **Admin Webapp 完整功能**均移至 **V1**（V0 聚焦 Platform Webapp）：外部 Agent 接入（`search_apis` / `get_api_detail`）随 V1 提供，`get_project_context` 仍随 Project 在 V1+；Admin 在 V0 仅保留壳。

---

# 7. 异步任务与消息通知

OpenAPI 异步导入、站内通知与队列实现（`repository_tasks` / `notifications` / `impl_queue_jobs`、状态机、API 契约、前端呈现、实施顺序）已独立为模块文档：

👉 **[Async Queue & Notifications 模块文档](./modules/async-queue.md)**
