import { pgTable, varchar, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth";

// ═══════════════════════════════════════════════════════════════════
// Admin Members — 平台管理员（Admin Webapp 准入）
// ═══════════════════════════════════════════════════════════════════
//
// 一行 = 这个人可以登录 Admin Webapp。这是**平台平面**的角色，与 org_* / repo_*
// 无关：admin 角色永远不持有任何租户写权限（见 authz/admin-capabilities.ts，
// 断言不变量见同目录的测试）。
//
// 第一个 admin_super 只能由 CLI 引导（src/db/bootstrap-admin.ts），之后由
// 另一个 admin_super 在 Admin Webapp 内授予——否则会形成"没有人能授予第一个
// 管理员"的死锁。
//
// 平台平面取代了早期的 users.is_platform_admin 布尔列（已删除，见迁移 0002）。
// 设计见 docs/tech-design.md §2.8.5。

export const adminMembers = pgTable(
  "admin_members",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    /** 授予人；CLI 引导时为 NULL（系统写入） */
    grantedBy: text("granted_by").references(() => users.id),
  },
  (table) => [index("admin_members_role_idx").on(table.role)],
);
