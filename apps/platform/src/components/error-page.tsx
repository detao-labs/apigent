"use client";

// ═══════════════════════════════════════════════════════════════════
// ErrorPage — 500 错误页（数据库不可用 / 迁移缺失 / 通用错误）
// ═══════════════════════════════════════════════════════════════════
//
// 使用位置：
//   - /500 独立路由（数据库不可用 / 迁移缺失时由布局跳转至此）
//   - 根 error.tsx（错误边界，兜底其它未处理错误）
// 数据库类错误给出可执行的排查提示，其它错误走通用文案。

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@apigent/ui";
import { House, RefreshCw } from "lucide-react";
import type { DatabaseIssue } from "@/lib/error-detection";

/** 布局跳转到 /500 前，把用户原页面存入 sessionStorage，重试时跳回。 */
export const ERROR_RETURN_KEY = "apigent-error-return";

export function ErrorPage({
  issue,
  reset,
  digest,
}: {
  issue: DatabaseIssue | null;
  reset?: () => void;
  digest?: string;
}) {
  const t = useTranslations("errors");
  const router = useRouter();

  const retry =
    reset ??
    (() => {
      let from: string | null = null;
      try {
        from = window.sessionStorage.getItem(ERROR_RETURN_KEY);
        window.sessionStorage.removeItem(ERROR_RETURN_KEY);
      } catch {
        // 存储不可用时回退到首页
      }
      router.replace(from || "/");
    });
  const isDatabase = issue !== null;
  const hints =
    issue === "connection" || issue === "migrations" ? (t.raw(`hints.${issue}`) as string[]) : [];

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl text-center">
        <h1 className="text-2xl font-bold tracking-tight text-destructive">
          {isDatabase ? t("databaseTitle") : t("genericTitle")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {isDatabase ? t("databaseDescription") : t("description")}
        </p>

        {isDatabase && hints.length > 0 && (
          <div className="mt-6 rounded-xl border bg-muted/30 p-4 text-left">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t("databaseHint")}</p>
            <ol className="space-y-1.5">
              {hints.map((hint, index) => (
                <li key={index} className="flex gap-2 text-sm">
                  <span className="font-mono text-xs text-muted-foreground">{index + 1}.</span>
                  <span>{hint}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={retry}>
            <RefreshCw className="mr-1.5 size-4" />
            {t("retry")}
          </Button>
          <Button variant="outline" render={<Link href="/" />}>
            <House className="mr-1.5 size-4" />
            {t("backHome")}
          </Button>
        </div>

        {digest && (
          <p className="mt-6 text-xs text-muted-foreground">
            {t("digest")}: <code className="font-mono">{digest}</code>
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * 已登录布局在数据库故障时渲染此组件：记录原页面地址后跳转到独立的
 * /500 页面，避免把错误 UI 内联在布局里。
 */
export function DatabaseDownRedirect({ issue }: { issue: DatabaseIssue }) {
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    try {
      window.sessionStorage.setItem(ERROR_RETURN_KEY, `${pathname}${window.location.search}`);
    } catch {
      // 存储不可用时，重试按钮会回退到首页
    }
    router.replace(`/500?issue=${issue}`);
  }, [pathname, router, issue]);

  return null;
}
