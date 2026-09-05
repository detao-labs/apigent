// ═══════════════════════════════════════════════════════════════════
// Structured logger — JSON lines (legacy entry, now delegates to ./logging)
// ═══════════════════════════════════════════════════════════════════
//
// Backward-compatible entry point. Existing call sites `import {
//   logInfo, logError } from "../logger"` keep working unchanged.
// The real implementation (AsyncLocalStorage context + level filter)
// lives in ./logging/index.ts.
// ═══════════════════════════════════════════════════════════════════

export {
  logInfo,
  logWarn,
  logError,
  logDebug,
  runWithLoggingContext,
  withRequestContext,
  withTaskContext,
  getLoggingContext,
  newRequestId,
  type LoggingContext,
} from "./logging";
