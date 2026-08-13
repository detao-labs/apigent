// ═══════════════════════════════════════════════════════════════════
// Minimal structured logger — JSON lines on stdout/stderr
// ═══════════════════════════════════════════════════════════════════

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

export function logError(event: string, error: unknown, context?: LogContext) {
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
