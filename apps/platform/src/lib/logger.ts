// ═══════════════════════════════════════════════════════════════════
// Minimal structured logger — JSON lines on stdout/stderr
// ═══════════════════════════════════════════════════════════════════
//
// V0 用 console 输出结构化单行 JSON，便于本地 grep 与后续接入日志系统
// （pino / OpenTelemetry 等）时只需替换本文件实现，调用点不变。

type LogContext = Record<string, unknown>;

function write(level: "info" | "error", event: string, context?: LogContext) {
  const payload: LogContext = {
    ts: new Date().toISOString(),
    level,
    event,
    ...context,
  };
  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function logInfo(event: string, context?: LogContext) {
  write("info", event, context);
}

export function logError(
  event: string,
  error: unknown,
  context?: LogContext,
) {
  write("error", event, {
    ...context,
    error: serializeError(error),
  });
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return String(error);
}
