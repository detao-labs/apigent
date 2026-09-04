// ═══════════════════════════════════════════════════════════════════
// Error detection — 判断错误是否属于数据库不可用，并细分类型
// ═══════════════════════════════════════════════════════════════════
//
// Drizzle 会把底层错误包装成 DrizzleQueryError（message 只含 SQL，
// 原始错误在 cause 链上）；pg 连接失败可能抛 AggregateError。因此这里
// 递归遍历 cause / AggregateError.errors，按错误文本匹配类型。

export type DatabaseIssue = "connection" | "migrations";

/** 数据库服务不可达（容器未启动 / 端口错误 / 网络不通）。 */
const CONNECTION_PATTERNS = [
  /ECONNREFUSED/i,
  /connection refused/i,
  /EHOSTUNREACH/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /ECONNRESET/i,
  /connection terminated/i,
  /database system/i,
  /cannot_connect_now/i,
  /57P03/i,
];

/** PostgreSQL 连接类 SQLSTATE（服务不可达 / 连接失败）。 */
const CONNECTION_CODES = new Set(["08001", "08004", "08006", "57P03"]);

/** 数据库可达但表结构缺失（迁移未执行）。 */
const MIGRATION_PATTERNS = [
  /relation .* does not exist/i,
  /column .* does not exist/i,
  /undefined_table/i,
  /42P01/i,
];

/** PostgreSQL 表/列缺失类 SQLSTATE。 */
const MIGRATION_CODES = new Set(["42P01", "42P02"]);

export function detectDatabaseIssue(err: unknown): DatabaseIssue | null {
  const seen = new Set<unknown>();

  const visit = (current: unknown): DatabaseIssue | null => {
    if (
      (typeof current !== "object" && typeof current !== "string") ||
      !current ||
      seen.has(current)
    ) {
      return null;
    }
    seen.add(current);

    const candidates: unknown[] = [current];
    if (current instanceof AggregateError && current.errors.length > 0) {
      candidates.push(...current.errors);
    }
    const cause = (current as { cause?: unknown }).cause;
    if (cause) candidates.push(cause);

    for (const candidate of candidates) {
      if (candidate && typeof candidate === "object") {
        const code = (candidate as { code?: unknown }).code;
        if (typeof code === "string") {
          if (CONNECTION_CODES.has(code)) return "connection";
          if (MIGRATION_CODES.has(code)) return "migrations";
        }
      }
      const text =
        candidate instanceof Error ? `${candidate.name}: ${candidate.message}` : String(candidate);
      if (CONNECTION_PATTERNS.some((pattern) => pattern.test(text))) {
        return "connection";
      }
      if (MIGRATION_PATTERNS.some((pattern) => pattern.test(text))) {
        return "migrations";
      }
      const nested = visit(candidate);
      if (nested) return nested;
    }
    return null;
  };

  return visit(err);
}
