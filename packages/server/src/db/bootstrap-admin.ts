// ═══════════════════════════════════════════════════════════════════
// Bootstrap Admin — 授予平台管理员（CLI）
// ═══════════════════════════════════════════════════════════════════
//
// 第一个 `admin_super` 只能从这里来：Admin Webapp 的门禁本身就是"只有管理员
// 能进"，不先开一个口子就没有人能授予第一个管理员（bootstrapping deadlock）。
// 之后再加管理员可以在 Admin Webapp 的「管理员」页操作（`admin:admins:manage`）。
//
// 用法（仓库根目录）：
//   pnpm --filter @apigent/server admin:grant -- --email=you@example.com
//
// 行为：
//   - 目标用户必须已存在（先注册，再授权），找不到就报错退出，不隐式建号；
//   - 幂等：已经是管理员时只打印现状，不重复写；
//   - 授权与 `admin.grant` 审计行在同一事务内提交（actor 为 NULL = 系统）。
//
// 授予逻辑复用 src/admin/service.ts —— Webapp 与 CLI 走同一条路径，审计与幂等
// 语义不会出现第二份实现。
// ═══════════════════════════════════════════════════════════════════

import { loadConfig } from "@apigent/core/config";
import { AdminMemberError, grantAdminRole, type GrantAdminResult } from "../admin";
import { closeDB } from "./connection";
import { ADMIN_ROLES, isAdminRole, type AdminRole } from "../authz/admin-capabilities";

export type { GrantAdminResult };

function parseArgs(argv: string[]): { email: string; role: AdminRole } {
  const emailArg = argv.find((arg) => arg.startsWith("--email="));
  const roleArg = argv.find((arg) => arg.startsWith("--role="));
  const email = emailArg?.slice("--email=".length).trim().toLowerCase() ?? "";
  const role = roleArg?.slice("--role=".length) ?? "admin_super";

  if (!email) {
    throw new Error("Missing --email=<address>. Usage: admin:grant -- --email=you@example.com");
  }
  if (!isAdminRole(role)) {
    throw new Error(`Unknown role "${role}". Known roles: ${ADMIN_ROLES.join(", ")}`);
  }
  return { email, role };
}

export async function grantAdmin(input: {
  email: string;
  role?: AdminRole;
}): Promise<GrantAdminResult> {
  try {
    return await grantAdminRole({
      email: input.email,
      role: input.role,
      actorId: null, // 系统引导：没有操作者
      source: "cli-bootstrap",
    });
  } catch (err) {
    if (err instanceof AdminMemberError && err.code === "user-not-found") {
      throw new Error(
        `No user with email ${input.email.trim().toLowerCase()}. ` +
          `Register the account in the Platform Webapp first.`,
      );
    }
    throw err;
  }
}

export async function bootstrapAdmin(argv: string[]): Promise<void> {
  loadConfig();
  const { email, role } = parseArgs(argv);
  const result = await grantAdmin({ email, role });

  if (result.granted) {
    console.log(`[admin:grant] ${result.email} is now ${result.role}`);
  } else {
    console.log(`[admin:grant] ${result.email} is already ${result.role} — nothing to do`);
  }
  await closeDB();
}

// Run directly:  pnpm --filter @apigent/server admin:grant -- --email=you@example.com
if (process.argv[1]?.endsWith("bootstrap-admin.ts")) {
  bootstrapAdmin(process.argv.slice(2))
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[admin:grant] Failed:", err instanceof Error ? err.message : err);
      closeDB().finally(() => process.exit(1));
    });
}
