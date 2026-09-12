// ═══════════════════════════════════════════════════════════════════
// Bootstrap Admin — 授予平台管理员（CLI）
// ═══════════════════════════════════════════════════════════════════
//
// 第一个 `admin_super` 只能从这里来：Admin Webapp 的门禁本身就是"只有管理员
// 能进"，不先开一个口子就没有人能授予第一个管理员（bootstrapping deadlock）。
// 之后再加管理员应该在 Admin Webapp 里操作（`admin:admins:manage`）。
//
// 用法（仓库根目录）：
//   pnpm --filter @apigent/server admin:grant -- --email=you@example.com
//
// 行为：
//   - 目标用户必须已存在（先注册，再授权），找不到就报错退出，不隐式建号；
//   - 幂等：已经是管理员时只打印现状，不重复写；
//   - 授权与 `admin.grant` 审计行在同一事务内提交（actor 为 NULL = 系统）。
// ═══════════════════════════════════════════════════════════════════

import { eq } from "drizzle-orm";
import { loadConfig } from "@apigent/core/config";
import { recordOperation, withAuditTransaction } from "../audit";
import { closeDB, getDB } from "./connection";
import { adminMembers, users } from "./schema";
import { ADMIN_ROLES, isAdminRole, type AdminRole } from "../authz/admin-capabilities";

export interface GrantAdminResult {
  userId: string;
  email: string;
  role: AdminRole;
  /** false = 本来就是管理员，未重复写入 */
  granted: boolean;
}

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
  const email = input.email.trim().toLowerCase();
  const role: AdminRole = input.role ?? "admin_super";

  const [user] = await getDB()
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    throw new Error(
      `No user with email ${email}. Register the account in the Platform Webapp first.`,
    );
  }

  const [existing] = await getDB()
    .select({ role: adminMembers.role })
    .from(adminMembers)
    .where(eq(adminMembers.userId, user.id))
    .limit(1);
  if (isAdminRole(existing?.role)) {
    return { userId: user.id, email: user.email, role: existing.role, granted: false };
  }

  await withAuditTransaction(async (tx) => {
    await tx
      .insert(adminMembers)
      .values({ userId: user.id, role, grantedBy: null })
      .onConflictDoUpdate({
        target: adminMembers.userId,
        set: { role, grantedAt: new Date(), grantedBy: null },
      });
    await recordOperation(tx, {
      actorId: null,
      operationType: "admin.grant",
      resourceType: "user",
      resourceId: user.id,
      summary: {
        targetUserId: user.id,
        targetEmail: user.email,
        role,
        source: "cli-bootstrap",
      },
    });
  });

  return { userId: user.id, email: user.email, role, granted: true };
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
