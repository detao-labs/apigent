// ═══════════════════════════════════════════════════════════════════
// RAG Contracts — 宿主注入的依赖端口（非阶段）
// ═══════════════════════════════════════════════════════════════════
//
// 这些端口让 `@apigent/rag` 的适配器能用数据库（或别的外部资源），而**不依赖
// `pg` / `drizzle` / `@apigent/server`**（docs/modules/rag-package.md §2.3）。
//
// 为什么是「一个 `query(sql, params)`」而不是 ORM 句柄：
//   - rag 的检索 SQL 是手写的（pgvector 的 `<=>`、`ts_rank`、`ANY($1)` 过滤都不是
//     ORM 能自然表达的形态），给一个 query 口子就够；
//   - 端口越小，替身越好写 —— 单测直接用「返回固定行」的假执行器，不需要数据库；
//   - 连接池的生命周期归宿主，rag 不持有、不关闭它。
// ═══════════════════════════════════════════════════════════════════

/**
 * 最小 SQL 执行端口。
 *
 * 约定：
 *   - `sql` 里用 `$1` / `$2` 占位符（PostgreSQL 原生风格），**不要拼字符串** ——
 *     参数一律走 `params`；
 *   - 返回**行数组**（不是 driver 的 `{ rows }` 包封），列名按 SQL 里的别名原样
 *     出现在对象键上（要 camelCase 就在 SQL 里 `as "commitId"`）；
 *   - 抛错即失败：适配器层不吞异常、不做重试（重试是任务队列的职责，P4-7）。
 */
export interface SqlExecutor {
  query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<Row[]>;
}
