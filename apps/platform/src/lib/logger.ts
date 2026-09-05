// ═══════════════════════════════════════════════════════════════════
// Platform logger — delegates to the shared server logger.
// ═══════════════════════════════════════════════════════════════════
//
// Re-export from @apigent/server/logging so platform and server share
// the SAME AsyncLocalStorage context. A reqId set in a platform route
// (via withRequestContext) is therefore visible in logs emitted by
// server services it calls (e.g. import executor).
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
} from "@apigent/server/logging";
