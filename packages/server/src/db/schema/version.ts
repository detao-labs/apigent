// ═══════════════════════════════════════════════════════════════════
// Repo Versioning — 版本(branch) + 快照(commit) + 版本树(link)
// ═══════════════════════════════════════════════════════════════════
//
// 版本 = 命名分支（活线）：versions
// 快照 = 不可变 commit：version_commits（单父，可带 merge_source）
// 版本树 = commit → (identity, blob)：version_entity_links
//
// 设计见 docs/tech/import-version-branch.md。
// ═══════════════════════════════════════════════════════════════════

import {
  pgTable,
  text,
  varchar,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
  index,
  primaryKey,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { repositories } from "./repo";

// ───────────────────────────────────────────────────────────────────
// versions — 活线（branch）
// ───────────────────────────────────────────────────────────────────

export const versions = pgTable(
  "versions",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    /** v1 / v2 / main —— 版本线名 */
    name: varchar("name", { length: 255 }).notNull(),
    /** 基于哪条线 fork；空树新建为 NULL */
    parentVersionId: text("parent_version_id"),
    /** 当前最新快照；首个导入前为 NULL */
    headCommitId: text("head_commit_id"),
    /** 默认主分支标志，每仓最多一个 */
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("versions_repo_name_idx").on(table.repoId, table.name),
    uniqueIndex("versions_repo_default_idx")
      .on(table.repoId)
      .where(sql`${table.isDefault}`),
  ],
);

// ───────────────────────────────────────────────────────────────────
// version_commits — 快照（commit）
// ───────────────────────────────────────────────────────────────────

export interface MergeSource {
  sourceBranchId: string;
  sourceHeadCommitId: string;
  baseCommitId: string;
}

export interface ChangeSummary {
  added: string[];
  updated: string[];
  removed: string[];
}

export const versionCommits = pgTable(
  "version_commits",
  {
    id: text("id").primaryKey(),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    versionId: text("version_id")
      .notNull()
      .references(() => versions.id),
    /** 父快照（单父）；用于历史回溯/回滚 */
    parentCommitId: text("parent_commit_id"),
    /** 展示名（导入序号/描述），可选 */
    label: text("label"),
    /** 本次导入文件 info.title */
    specTitle: text("spec_title"),
    /** 本次导入文件 info.version */
    specVersion: text("spec_version"),
    /** 本次导入文件 info.description */
    description: text("description"),
    /** 导入文件落盘路径；空树/手动删除等无文件的 commit 可为 NULL */
    specStoragePath: text("spec_storage_path"),
    /** import | manual | merge | ... */
    source: text("source"),
    /** merge 来源 */
    mergeSource: jsonb("merge_source").$type<MergeSource>(),
    /** tag 名称 → 描述/排序（modules 派生用） */
    tagMeta: jsonb("tag_meta").$type<Record<string, { description?: string; sortOrder?: number }>>(),
    /** 该 commit 引入的增/改/删 identity */
    changeSummary: jsonb("change_summary").$type<ChangeSummary>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("version_commits_repo_version_idx").on(table.repoId, table.versionId),
    index("version_commits_parent_idx").on(table.parentCommitId),
  ],
);

// ───────────────────────────────────────────────────────────────────
// version_entity_links — 版本树（commit → identity → blob）
// ───────────────────────────────────────────────────────────────────

export const versionEntityLinks = pgTable(
  "version_entity_links",
  {
    commitId: text("commit_id")
      .notNull()
      .references(() => versionCommits.id),
    /** endpoint | data_model | component */
    entityType: text("entity_type").notNull(),
    /** operationId ?? METHOD:PATH（接口）/ name（模型）/ kind::name（组件） */
    identityKey: text("identity_key").notNull(),
    /** 指向 endpoints / data_models / components .id（blob）；多态引用 */
    entityId: text("entity_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.commitId, table.entityType, table.identityKey] }),
    index("vel_commit_type_idx").on(table.commitId, table.entityType),
    check("vel_entity_type_check", sql`${table.entityType} IN ('endpoint','data_model','component')`),
  ],
);
