// ═══════════════════════════════════════════════════════════════════
// Structured Logging + AsyncLocalStorage Context (阶段 A / B)
// ═══════════════════════════════════════════════════════════════════
//
// 日志引擎：pino（高性能结构化 JSON lines）。输出字段与之前自研实现
// 保持一致：`{ ts, level, event, reqId?, taskId?, ...context }` —
// pino 负责序列化与级别方法，我们负责 AsyncLocalStorage 上下文贯穿
// 与 level 过滤。
//
// 阶段 B：ALS 贯穿 reqId / taskId / userId / orgId / repoId，让一次
// 请求 / 一次任务的日志自动带上同一 id，可串起全链路。
// ═══════════════════════════════════════════════════════════════════

import { AsyncLocalStorage } from "node:async_hooks";
import pino from "pino";
import { getConfig } from "@apigent/core/config";
import { generateId } from "../id";

export interface LoggingContext {
  reqId?: string;
  taskId?: string;
  userId?: string;
  orgId?: string;
  repoId?: string;
  entityId?: string;
  [key: string]: unknown;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const storage = new AsyncLocalStorage<LoggingContext>();

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// pino 实例：level 固定 trace（由下方 LEVEL_RANK + config 过滤），
// base/timestamp 关闭以保持我们自己的字段布局；level formatter 把
// pino 的未命名级别数字还原为字符串，兼容既有日志 `"level":"info"`。
const pinoLogger = pino({
  level: "trace",
  base: undefined,
  timestamp: false,
  formatters: {
    level: (label) => ({ level: label }),
  },
});

function currentLevel(): LogLevel {
  try {
    return getConfig().observability.logLevel;
  } catch {
    return "info";
  }
}

/** 在当前异步上下文（请求/任务）下执行 fn，fn 内的日志自动携带上下文。 */
export function runWithLoggingContext<T>(context: LoggingContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** 读取当前异步上下文（无上下文时返回空对象）。 */
export function getLoggingContext(): LoggingContext {
  return storage.getStore() ?? {};
}

/** 生成一个 request id（用于 HTTP 入口贯穿）。 */
export function newRequestId(): string {
  return generateId("req");
}

/** 便捷包装：为一次 HTTP 请求生成 reqId 并在其上下文内执行 handler。 */
export function withRequestContext<T>(fn: () => T, extra?: LoggingContext): T {
  const base = getLoggingContext();
  const context: LoggingContext = { ...base, reqId: base.reqId ?? newRequestId(), ...extra };
  return storage.run(context, fn);
}

/** 便捷包装：为一次异步任务生成/复用 taskId 并在其上下文内执行 worker。 */
export function withTaskContext<T>(taskId: string, fn: () => T, extra?: LoggingContext): T {
  const base = getLoggingContext();
  const context: LoggingContext = { ...base, taskId, ...extra };
  return storage.run(context, fn);
}

function serializeError(error: unknown): { name?: string; message?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: process.env.APIGENT_LOG_STACK === "true" ? error.stack : undefined,
    };
  }
  return { message: String(error) };
}

function write(level: LogLevel, event: string, context?: LoggingContext): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[currentLevel()]) return;
  const store = storage.getStore() ?? {};
  const payload: Record<string, unknown> = {
    ts: new Date().toISOString(),
    event,
    ...store,
    ...context,
  };
  // pino 方法名与级别一一对应；只传对象（无 msg），字段由我们控制。
  pinoLogger[level](payload);
}

export function logInfo(event: string, context?: LoggingContext): void {
  write("info", event, context);
}

export function logWarn(event: string, context?: LoggingContext): void {
  write("warn", event, context);
}

export function logDebug(event: string, context?: LoggingContext): void {
  write("debug", event, context);
}

export function logError(event: string, error: unknown, context?: LoggingContext): void {
  write("error", event, {
    ...context,
    error: serializeError(error),
  });
}
