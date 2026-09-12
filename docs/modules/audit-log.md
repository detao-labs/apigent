# Audit Log（操作日志）— 技术债记录

> **状态：** 仅 schema——`packages/server/src/db/schema/audit.ts`；尚无读写服务。

> **状态：V0 未接线（表已建，写/查/展示均未实现），记录以便后续实现**

> **优先级已提升（2026-09-12）：** 审计日志是"平台管理员不能触碰租户数据"这条边界的**唯一可验证手段**，因此列为必须实现项，而不是可选增强。事件范围与写入约束见下方「事件清单」。

## 目标

让仓库 / 接口 / 数据模型 / 组织等实体上的关键操作可追踪、可审计：谁、在何时、对哪个资源、做了什么动作（导入版本、设为当前、邀请/移除成员、改角色、转移所有权、增删密钥、删除仓库、启停 MCP 等）。用于排障与合规审计，也是「面向 Agent 平台」可信度的基础。

## 现状（V0）

| 项                         | 状态                                                                                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operation_logs` 表        | ✅ 已定义（`organization_id` / `repository_id` / `actor_id` / `operation_type` / `resource_type` / `resource_id` / `summary` JSONB / `created_at`；含 org+type+time 索引） |
| `operation_log_details` 表 | ✅ 已定义（`change_type` / `operation_id_ref` / `method` / `path` / `from_endpoint_id` / `to_endpoint_id` / `fields_changed`；operation+method+path 唯一索引）             |
| 服务层写入                 | ❌ 无（导入 / 权限 / 密钥 / MCP 等 mutation 均未写日志）                                                                                                                   |
| 查询 API                   | ❌ 无（无按资源拉取操作记录的接口）                                                                                                                                        |
| 前端展示                   | ❌ 无（仓库 / 组织 / 版本页均无操作历史区）                                                                                                                                |
| 变更明细落库               | ❌ 无（导入 diff 结果未沉淀到 `operation_log_details`）                                                                                                                    |

> 说明：`operation_log_details` 专为“导入版本变更明细”设计（跨版本的 `from/to_endpoint_id` + `fields_changed`），与版本对比（Phase 4）天然衔接，可复用同一份 diff 输出。

## 缺口与落地步骤（分阶段，待讨论）

### 事件清单（已确认要记录）

| 事件                                                       | 操作者               | 说明                                            | 优先级   |
| ---------------------------------------------------------- | -------------------- | ----------------------------------------------- | -------- |
| `admin.grant` / `admin.revoke`                             | `admin_super`        | 授予/移除平台管理员角色——平台侧**唯一**的写操作 | **必做** |
| `repo.member_add` / `member_role_change` / `member_remove` | 该仓库 `repo_admin`+ | 仓库成员变更（新功能）                          | **必做** |
| `member.invite` / `member.role_change` / `member.remove`   | `org_admin`+         | 组织成员变更                                    | **必做** |
| `org.transfer`                                             | `org_owner`          | 组织所有权转移                                  | **必做** |
| `admin.login`                                              | `admin_super`        | 平台方登录留痕                                  | 可选     |

### 写入约束（关键）

1. **与业务写操作同一事务**：审计行必须和它所记录的那次变更在同一个事务里提交。否则会出现"操作成功了、日志没落库"，而这条日志是平台侧唯一的追溯依据，缺失即等于不可信。
2. **`organization_id` 为 NULL 表示平台级操作**：现有索引是 `(organization_id, operation_type, created_at)`，NULL 行不参与该索引。Admin 审计页若要按"平台级操作"查询，需要额外索引或改写查询条件，避免全表扫描。
3. **`summary` 用结构化 JSONB**，前端直接渲染，不依赖 i18n。
4. **`operation_log_details` 只服务导入变更明细**，成员/权限类变更用 `summary` 即可，不需要写明细表。

### 阶段 A · 服务层写入（最小闭环）

- 在关键 mutation **同一事务内**写 `operation_logs`：仓库（创建/编辑/删除）、导入版本、设为当前、MCP 开关、密钥（增删）、成员（邀请/移除/改角色/转移所有权）、平台管理员（授予/移除）、仓库成员（添加/改角色/移除）。
- 统一入口：新增 `packages/server/src/audit/service.ts`，提供 `logOperation(input)`，内部判断 actor 是否为空（系统自动操作可空）。
- `summary` 用结构化 JSONB（如 `{ repoName, version }`），前端可直接渲染，不依赖 i18n。

### 阶段 B · 变更明细（与版本对比复用）

- 导入成功后，将纯规则 diff 的变更明细写入 `operation_log_details`（`change_type` = added/removed/modified、破坏性标记放入 `fields_changed` 或 `summary`）。
- 版本对比页可直读该明细，避免重复计算。

### 阶段 C · API + 前端展示

- `GET /api/repos/:id/operations`、`GET /api/orgs/:id/operations`（分页，默认倒序）。
- 仓库详情 / 组织详情新增「操作日志」分区或抽屉；版本页可联动展示“谁导入了此版本”。
- 只读，`repo_viewer` / `org_member` 即可访问；写入侧由各 mutation 自身权限兜底。

## 与其它模块的关联

- **Phase 4 版本管理**：`设为当前 / 导出 / 对比` 均应写审计；diff 明细沉淀到 `operation_log_details`。
- **Observability**：操作日志偏业务审计，日志/追踪偏系统诊断，二者不冲突，详见 [observability.md](./observability.md)。
