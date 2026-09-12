// ═══════════════════════════════════════════════════════════════════
// Pagination — 查询参数解析
// ═══════════════════════════════════════════════════════════════════

export interface Pagination {
  limit: number;
  offset: number;
}

/** 解析 `?limit=&offset=`，非法值回落到默认值，limit 上限可配。 */
export function parsePagination(
  url: URL,
  options: { defaultLimit?: number; maxLimit?: number } = {},
): Pagination {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 100;
  const rawLimit = Number(url.searchParams.get("limit"));
  const rawOffset = Number(url.searchParams.get("offset"));

  const limit =
    Number.isFinite(rawLimit) && rawLimit >= 1
      ? Math.min(Math.floor(rawLimit), maxLimit)
      : defaultLimit;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 1 ? Math.floor(rawOffset) : 0;

  return { limit, offset };
}
