// ═══════════════════════════════════════════════════════════════════
// RBAC — 纯角色模型与层级（无 DB 依赖）
// ═══════════════════════════════════════════════════════════════════

export type OrgRole = "org_owner" | "org_admin" | "org_member";
export type RepoRole = "repo_owner" | "repo_admin" | "repo_member" | "repo_viewer";

const ORG_RANK: Record<OrgRole, number> = {
  org_member: 1,
  org_admin: 2,
  org_owner: 3,
};
const REPO_RANK: Record<RepoRole, number> = {
  repo_viewer: 1,
  repo_member: 2,
  repo_admin: 3,
  repo_owner: 4,
};

/** 权限不足。由 API 层映射为 403。 */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * 组织角色隐含的仓库角色。
 *
 * 只有管理员及以上隐含：`org_owner → repo_owner`、`org_admin → repo_admin`。
 * `org_member` **不隐含任何仓库角色**——仓库内容是显式成员制，组织成员想访问
 * 某个仓库的内容，必须被显式加进 `repository_members`。
 */
export function orgRoleToRepoRole(role: OrgRole | null | undefined): RepoRole | null {
  switch (role) {
    case "org_owner":
      return "repo_owner";
    case "org_admin":
      return "repo_admin";
    default:
      return null;
  }
}

/**
 * 有效仓库角色——**先看仓库成员，再看上级组织角色**：
 *
 *   1. 有 `repository_members` 行 → 用该角色（显式行可以**降权**，用于对单个仓库收口）
 *   2. 否则看组织角色：`org_owner → repo_owner`、`org_admin → repo_admin`
 *   3. 两者都没有 → null，API 层返回 403
 */
export function resolveEffectiveRepoRole(
  orgRole?: OrgRole | null,
  memberRole?: RepoRole | null,
): RepoRole | null {
  return memberRole ?? orgRoleToRepoRole(orgRole);
}

export function isRepoRoleAtLeast(role: RepoRole | null, min: RepoRole): boolean {
  return !!role && REPO_RANK[role] >= REPO_RANK[min];
}

export function isOrgRoleAtLeast(role: OrgRole | null, min: OrgRole): boolean {
  return !!role && ORG_RANK[role] >= ORG_RANK[min];
}

/** 仓库角色枚举，按等级升序。 */
export const REPO_ROLES: readonly RepoRole[] = [
  "repo_viewer",
  "repo_member",
  "repo_admin",
  "repo_owner",
];
