// ═══════════════════════════════════════════════════════════════════
// Repo Guard — 入口层仓库授权
// ═══════════════════════════════════════════════════════════════════
//
// 每个接收 repositoryId 的 HTTP 入口都必须显式声明所需的最低仓库角色。
// 无权限返回 403 响应，有权限返回 null。
//
// 用法：
//   const denied = await guardRepoAccess(user.id, id, "repo_member");
//   if (denied) return denied;
//
// 这些断言后续会收敛为声明式写法
// `withRoute({ auth: true, repo: { param: "id", min: "repo_member" } })`
// （见 docs/tech-design.md §5.4.4），届时本文件删除。
// ═══════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { assertRepoAccess, ForbiddenError, type RepoRole } from "@apigent/server/authz";
import { logWarn } from "@/lib/logger";

export async function guardRepoAccess(
  userId: string,
  repositoryId: string,
  min: RepoRole,
): Promise<NextResponse | null> {
  try {
    await assertRepoAccess(userId, repositoryId, min);
    return null;
  } catch (err) {
    if (err instanceof ForbiddenError) {
      // reqId / userId 由 AsyncLocalStorage 上下文自动带入
      logWarn("authz.repo.denied", { repositoryId, requiredRole: min });
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    throw err;
  }
}
