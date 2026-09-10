import type { Metadata } from "next";
import { ErrorPage } from "@/components/error-page";
import type { DatabaseIssue } from "@/lib/error-detection";

export const metadata: Metadata = {
  title: "500 — Apigent",
  description: "Something went wrong",
};

/**
 * 独立 500 页面：数据库不可用、迁移缺失或其它未处理错误。
 * 位于根路由（不在 (authed) 分组内），因此不依赖数据库即可渲染。
 *
 * 注意：路径不能取 `/500`——Next 内部把该 URL 保留给内置 `_error` 静态页
 * （`useDefaultStatic500` → `defaultMap['/500'] = { page: '/_error' }`），
 * 与 App Router 的动态 `/500` 路由冲突会导致 `next build` 失败。
 */
export default async function ServerErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ issue?: string; digest?: string }>;
}) {
  const { issue, digest } = await searchParams;
  const parsed: DatabaseIssue | null =
    issue === "connection" || issue === "migrations" ? issue : null;

  return <ErrorPage issue={parsed} digest={digest} />;
}
