// ═══════════════════════════════════════════════════════════════════
// Audit — 操作日志类型（无 DB 依赖）
// ═══════════════════════════════════════════════════════════════════
//
// 命名约定：`<资源域>.<动作>`。组织成员与仓库成员都会发生"移除"，所以仓库侧
// 统一加 `repo.` 前缀（member.remove vs repo.member_remove），组织侧不加。
//
// 完整事件清单见 docs/modules/audit-log.md。
// ═══════════════════════════════════════════════════════════════════

/** 会写入 operation_logs 的事件类型。 */
export const OPERATION_TYPES = [
  /** 组织 / 仓库创建 */
  "org.create",
  "repo.create",
  /** 组织成员：邀请 / 改角色 / 移除 */
  "member.invite",
  "member.role_change",
  "member.remove",
  /** 仓库成员：添加 / 改角色 / 移除 */
  "repo.member_add",
  "repo.member_role_change",
  "repo.member_remove",
  /** 组织所有权转移 */
  "org.transfer",
  /** 平台管理员：授予 / 移除 / 登录 */
  "admin.grant",
  "admin.revoke",
  "admin.login",
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

/** 被操作资源的类型。 */
export const RESOURCE_TYPES = [
  "organization",
  "organization_member",
  "repository",
  "repository_member",
  "user",
  "system",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

/**
 * 一条待写入的操作日志。
 *
 * `organizationId` 为 null 表示平台级操作（Admin Webapp）；`actorId` 为 null
 * 表示系统自动操作。仓库成员变更同时带 organizationId 与 repositoryId，这样
 * 组织审计页无需 join 就能看到"发生在自己组织内的全部动作"。
 */
export interface OperationLogInput {
  operationType: OperationType;
  resourceType: ResourceType;
  /** 被操作资源的 id；没有具体资源（例如登录）时省略 */
  resourceId?: string | null;
  actorId?: string | null;
  organizationId?: string | null;
  repositoryId?: string | null;
  /** 结构化摘要，前端直接渲染，不走 i18n */
  summary?: Record<string, unknown>;
}

export interface OperationLogActor {
  id: string;
  name: string;
  email: string;
}

/** 读出来的一条操作日志。 */
export interface OperationLogEntry {
  id: string;
  operationType: string;
  resourceType: string;
  resourceId: string | null;
  summary: Record<string, unknown>;
  /** 操作者；系统自动操作为 null */
  actor: OperationLogActor | null;
  createdAt: Date;
}

export interface ListOperationLogsOptions {
  /** 组织级：该组织自身的事件（不含其下仓库） */
  organizationId?: string;
  /** 仓库级 */
  repositoryId?: string;
  /** 平台级：`organization_id IS NULL` */
  platformOnly?: boolean;
  limit?: number;
  offset?: number;
}

export interface OperationLogPage {
  items: OperationLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

// ═══════════════════════════════════════════════════════════════════
// summary 字段约定（前端直接渲染，不做 i18n）
// ═══════════════════════════════════════════════════════════════════
//
// 所有事件都会带上的字段：
//   targetUserId  — 被操作的用户 id
//   targetEmail   — 被操作用户的邮箱（展示用，用户改名/删号后仍可追溯）
//   targetName    — 被操作用户的姓名，可能为 null
//
// 各事件额外字段：
//
//   org.create             name / ownerId
//   repo.create            name / organizationId / creatorRole
//   member.invite          role                    写入的组织角色
//   member.role_change     from / to               变更前后的组织角色
//   member.remove          role                    被移除时的组织角色
//   repo.member_add        role                    写入的仓库角色
//   repo.member_role_change from / to              变更前后的仓库角色
//   repo.member_remove     role                    被移除时的仓库角色
//   org.transfer           fromUserId / toUserId   原 owner / 新 owner
//   admin.grant            role                    授予的平台角色
//   admin.revoke           role                    移除的平台角色
//
// 仓库成员事件另外带上组织侧角色 `impliedRole`（组织角色隐含的仓库角色），
// 便于审计时判断这次显式写入是提权还是收口。
