// ═══════════════════════════════════════════════════════════════════
// Endpoint Key — 端点身份 key 的统一构造
// ═══════════════════════════════════════════════════════════════════
//
// 全项目统一用固定的 `METHOD:PATH` 作为端点在「无 operationId 时」的
// 跨子系统身份 key（parser / diff / context 复用同一构造）。
// 规范化规则：
//   - method 统一为大写（并去除首尾空白）
//   - path 去除首尾空白
//   - 用固定分隔符 `:` 连接
// 例：`GET:/orders`、`POST:/users/{id}`。
// ═══════════════════════════════════════════════════════════════════

/** method 与 path 之间的固定分隔符 */
export const METHOD_PATH_SEPARATOR = ":" as const;

/**
 * 构造端点身份 key（无 operationId 时的回退标识）。
 * @param method HTTP 方法，如 "GET" / "post"
 * @param path   OpenAPI 路径，如 "/users/{id}"
 */
export function buildEndpointKey(method: string, path: string): string {
  const normalizedMethod = method.trim().toUpperCase();
  const normalizedPath = path.trim();
  return `${normalizedMethod}${METHOD_PATH_SEPARATOR}${normalizedPath}`;
}
