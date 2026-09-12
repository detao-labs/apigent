// ═══════════════════════════════════════════════════════════════════
// RBAC — 纯角色模型与层级（无 DB 依赖）
// ═══════════════════════════════════════════════════════════════════

export type OrgRole = "org_owner" | "org_admin" | "org_member";
export type RepoRole = "repo_admin" | "repo_editor" | "repo_viewer";

const ORG_RANK: Record<OrgRole, number> = {
  org_member: 1,
  org_admin: 2,
  org_owner: 3,
};
const REPO_RANK: Record<RepoRole, number> = {
  repo_viewer: 1,
  repo_editor: 2,
  repo_admin: 3,
};

/** 权限不足。由 API 层映射为 403。 */
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** 组织角色 → 继承的仓库角色 */
export function orgRoleToRepoRole(role: OrgRole): RepoRole {
  switch (role) {
    case "org_owner":
      return "repo_admin";
    case "org_admin":
      return "repo_editor";
    default:
      return "repo_viewer";
  }
}

/** 有效仓库角色 = max(继承, 覆盖)。均无则 null。 */
export function resolveEffectiveRepoRole(
  orgRole?: OrgRole | null,
  override?: RepoRole | null,
): RepoRole | null {
  const inherited = orgRole ? orgRoleToRepoRole(orgRole) : null;
  const inheritedRank = inherited ? REPO_RANK[inherited] : 0;
  const overrideRank = override ? REPO_RANK[override] : 0;
  if (inheritedRank <= 0 && overrideRank <= 0) return null;
  return inheritedRank >= overrideRank ? (inherited ?? override!) : override!;
}

export function isRepoRoleAtLeast(role: RepoRole | null, min: RepoRole): boolean {
  return !!role && REPO_RANK[role] >= REPO_RANK[min];
}

export function isOrgRoleAtLeast(role: OrgRole | null, min: OrgRole): boolean {
  return !!role && ORG_RANK[role] >= ORG_RANK[min];
}

/** 仓库角色枚举，按等级升序。 */
export const REPO_ROLES: readonly RepoRole[] = ["repo_viewer", "repo_editor", "repo_admin"];

/**
 * 覆盖角色是否真的改变有效角色。
 *
 * 有效仓库角色取 `max(继承, 覆盖)`，所以**低于或等于**继承角色的覆盖行是
 * 空操作——它既不会降级（org_owner 不会被覆盖成 repo_viewer），也不会提供
 * 任何额外能力。这类行只会让 `repo_permissions` 表变得难以解释，因此在写入
 * 时直接拒绝。
 */
export function isOverrideEffective(orgRole: OrgRole | null, override: RepoRole): boolean {
  const inherited = resolveEffectiveRepoRole(orgRole, null);
  const floor = inherited ? REPO_RANK[inherited] : 0;
  return REPO_RANK[override] > floor;
}

/** 某继承角色下可授予的覆盖角色（严格高于继承角色，按等级升序）。 */
export function assignableRepoRoles(orgRole: OrgRole | null): RepoRole[] {
  return REPO_ROLES.filter((role) => isOverrideEffective(orgRole, role));
}
