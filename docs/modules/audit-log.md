# Audit Log（操作日志）— 设计与实现进度

> **状态：** 阶段 A（成员类 + 平台管理员事件写入）+ 阶段 C（查询 API 与展示，含 Admin 审计页）已落地；阶段 B（导入变更明细）与 `admin.login` 未实现。

> 代码：`packages/server/src/audit/`（`recordOperation` / `withAuditTransaction` / `listOperationLogs`）、schema `packages/server/src/db/schema/audit.ts`。

> **定位（2026-09-12）：** 审计日志是"平台管理员不能触碰租户数据"这条边界的**唯一可验证手段**，因此是必须实现项，而不是可选增强。

## 目标

让仓库 / 接口 / 数据模型 / 组织等实体上的关键操作可追踪、可审计：谁、在何时、对哪个资源、做了什么动作（成员变更、所有权转移、导入版本、设为当前、增删密钥、删除仓库、启停 MCP 等）。用于排障与合规审计，也是「面向 Agent 平台」可信度的基础。

## 现状

| 项                         | 状态                                                                                                                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operation_logs` 表        | ✅ 已定义（`organization_id` / `repository_id` / `actor_id` / `operation_type` / `resource_type` / `resource_id` / `summary` JSONB / `created_at`）                                       |
| 索引                       | ✅ 组织+类型+时间复合索引、仓库+时间索引、**平台级部分索引**（`WHERE organization_id IS NULL`，见 `0001_audit_log_indexes.sql`）                                                          |
| `operation_log_details` 表 | ✅ 已定义（`change_type` / `operation_id_ref` / `method` / `path` / `from_endpoint_id` / `to_endpoint_id` / `fields_changed`；operation+method+path 唯一索引）                            |
| 服务层写入                 | 🟡 部分——成员 / 所有权 / 创建类事件已接线；导入、密钥、MCP、版本切换等未接线                                                                                                              |
| 查询服务                   | ✅ `listOperationLogs({ repositoryId \| organizationId \| platformOnly, limit, offset })`                                                                                                 |
| 查询 API                   | ✅ `GET /api/repos/:id/operations`（`repo_viewer`）、`GET /api/orgs/:id/operations`（`org_member`），分页默认 50 / 上限 100                                                               |
| 前端展示                   | ✅ Platform：仓库设置 →「操作日志」（`/repos/:id/settings/audit`）、组织详情 Tab；Admin：`/audit` 展示平台级事件（`platformOnly`）。两个 app 各有一份只读表格组件（i18n bundle 结构不同） |
| 变更明细落库               | ❌ 无（导入 diff 结果未沉淀到 `operation_log_details`）                                                                                                                                   |

## 事件清单

| 事件                                                                 | 操作者               | 状态      | 说明                                                        |
| -------------------------------------------------------------------- | -------------------- | --------- | ----------------------------------------------------------- |
| `member.invite` / `member.role_change` / `member.remove`             | `org_admin`+         | ✅ 已接线 | 组织成员变更                                                |
| `repo.member_add` / `repo.member_role_change` / `repo.member_remove` | 该仓库 `repo_admin`+ | ✅ 已接线 | 仓库成员变更                                                |
| `org.transfer`                                                       | `org_owner`          | ✅ 已接线 | 组织所有权转移                                              |
| `org.create` / `repo.create`                                         | 创建者               | ✅ 已接线 | 建组织 / 建仓库（创建者自动成为 owner 一并留痕）            |
| `admin.grant` / `admin.revoke`                                       | `admin_super`        | ✅ 已接线 | 平台侧唯一的写操作：CLI 引导与 Admin `/admins` 共用同一服务 |
| `admin.login`                                                        | `admin_super`        | ⏳ 可选   | 平台方登录留痕                                              |
| 导入 / 设为当前 / MCP / 密钥等                                       | 对应 `repo_*` 角色   | ⏳ 待实现 | Phase A 剩余部分                                            |

### 写入约束（关键）

1. **与业务写操作同一事务**：审计行必须和它所记录的那次变更在同一个事务里提交。否则会出现"操作成功了、日志没落库"，而这条日志是平台侧唯一的追溯依据，缺失即等于不可信。
2. **`recordOperation` 只接受事务句柄**：签名是 `recordOperation(tx, input)`，不接受普通连接。拿不到 `tx` 就写不了日志，编译期即暴露；业务写统一用 `withAuditTransaction(async (tx) => …)` 包裹。
3. **`organization_id` 为 NULL 表示平台级操作**：这些行不参与 `(organization_id, operation_type, created_at)` 复合索引，因此单独建了部分索引 `operation_logs_platform_time_idx`，避免 Admin 审计页全表扫描。
4. **`summary` 用结构化 JSONB**，前端直接渲染，不依赖 i18n。字段约定见 `packages/server/src/audit/types.ts` 顶部注释（统一带 `targetUserId` / `targetEmail` / `targetName`，角色变更带 `from` / `to`，仓库成员事件另带 `impliedRole`）。
5. **`operation_log_details` 只服务导入变更明细**，成员/权限类变更用 `summary` 即可，不写明细表。

### 读权限

操作日志是**只读**资源，读权限跟随所在资源：仓库侧 `repo_viewer`+，组织侧 `org_member`+。写入侧没有独立权限，由各 mutation 自身的授权兜底——能改成员的人才会产生成员类日志。

## 未落地

### 阶段 A 剩余：把其余 mutation 接线

仓库（编辑 / 删除）、导入版本、设为当前 / 回滚、MCP 开关、密钥（增删）。平台管理员的授予 / 移除**已接线**：CLI 引导与 Admin Webapp 的 `/admins` 都走 `packages/server/src/admin/service.ts`，与 `admin.grant` / `admin.revoke` 同事务落库。

### 阶段 B：变更明细（与版本对比复用）

导入成功后，将纯规则 diff 的变更明细写入 `operation_log_details`（`change_type` = added/removed/modified、破坏性标记放入 `fields_changed` 或 `summary`）。版本对比页可直读该明细，避免重复计算。

### 阶段 C 剩余：分页与筛选 UI

API 已支持 `limit` / `offset`，两个页面目前都只取最近 50 条；待补「加载更多」与按操作类型筛选。

## 与其它模块的关联

- **Phase 4 版本管理**：`设为当前 / 导出 / 对比` 均应写审计；diff 明细沉淀到 `operation_log_details`。
- **Admin 门禁**：`admin.grant` / `admin.revoke` 是平台侧唯一写操作，由 `packages/server/src/admin/service.ts` 统一实现（CLI 与 Admin `/admins` 都走它）；拒绝撤销最后一个管理员。
- **Observability**：操作日志偏业务审计，日志/追踪偏系统诊断，二者不冲突，详见 [observability.md](./observability.md)。
