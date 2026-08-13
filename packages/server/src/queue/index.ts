// ═══════════════════════════════════════════════════════════════════
// Async Queue — Public API
// ═══════════════════════════════════════════════════════════════════

import type { Container } from "@apigent/core/di";
import { PgQueueProvider } from "./pg-queue";

export { PgQueueProvider } from "./pg-queue";
export type { QueueJob, QueueProvider } from "@apigent/core/types";

/**
 * 注册 server 侧实现的队列工厂到 Core Container。
 * 应用启动时调用一次（Next.js instrumentation.ts 或独立 Worker 入口）。
 *
 * ```ts
 * import { getContainer } from "@apigent/core/di";
 * import { registerQueueProviders } from "@apigent/server/queue";
 *
 * registerQueueProviders(getContainer());
 * ```
 */
export function registerQueueProviders(container: Container): void {
  container.registerQueueFactory("postgres", () => new PgQueueProvider());
}
