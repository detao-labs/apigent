"use client";

// 根错误边界：捕获所有未被局部处理的渲染错误（500）。
// 生产环境下 Next.js 会脱敏 error.message，但布局层已对数据库故障做了
// 确定性兜底（见 (authed)/layout.tsx）；这里负责其余错误的通用展示。

import { ErrorPage } from "@/components/error-page";
import { detectDatabaseIssue } from "@/lib/error-detection";

export default function RootErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("[app] unhandled error", error);
  return <ErrorPage issue={detectDatabaseIssue(error)} reset={reset} digest={error.digest} />;
}
