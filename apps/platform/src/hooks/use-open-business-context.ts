"use client";

// ═══════════════════════════════════════════════════════════════════
// useOpenBusinessContext — 命令式打开全局业务上下文对话框
// ═══════════════════════════════════════════════════════════════════
//
// URL 驱动：写入 ?dialog=business-context&repo=<repoId>[&endpoint=<endpointId>]，
// 刷新不丢、可分享深链、前进后退可用。
// ═══════════════════════════════════════════════════════════════════

import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";

export interface BusinessContextTarget {
  repoId: string;
  endpointId?: string;
}

export function useOpenBusinessContext() {
  const router = useRouter();
  const pathname = usePathname();

  return useCallback(
    (target: BusinessContextTarget) => {
      const params = new URLSearchParams(window.location.search);
      params.set("dialog", "business-context");
      params.set("repo", target.repoId);
      if (target.endpointId) {
        params.set("endpoint", target.endpointId);
      } else {
        params.delete("endpoint");
      }
      router.replace(`${pathname}?${params.toString()}`);
    },
    [pathname, router],
  );
}
