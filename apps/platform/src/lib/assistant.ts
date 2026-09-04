// ═══════════════════════════════════════════════════════════════════
// Assistant — 全局 AI 助手抽屉的 URL 协议
// ═══════════════════════════════════════════════════════════════════
// 抽屉由 ?assistant=1 驱动；打开时会清除业务上下文对话框参数，避免
// 两个全局浮层同时出现（见 business-context-dialog.tsx）。

export const ASSISTANT_PARAM = "assistant";

/** 构造带/不带 assistant 参数的 URL（保留其它参数，如 repo / endpoint）。 */
export function buildAssistantUrl(pathname: string, search: string, open: boolean): string {
  const params = new URLSearchParams(search);
  if (open) {
    params.delete("dialog");
    params.set(ASSISTANT_PARAM, "1");
  } else {
    params.delete(ASSISTANT_PARAM);
  }
  return `${pathname}?${params.toString()}`;
}

/** 从路由推断仓库 id（/repos/[id]/... → [id]）。 */
export function repoIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/^\/repos\/([^/]+)/);
  return match?.[1];
}
