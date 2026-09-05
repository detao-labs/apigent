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
