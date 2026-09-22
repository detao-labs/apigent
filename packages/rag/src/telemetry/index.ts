// ═══════════════════════════════════════════════════════════════════
// Telemetry — Public API
// ═══════════════════════════════════════════════════════════════════
//
// 端口类型在 `@apigent/rag/contracts`（RagTelemetry / RagSpan / RagLoggerPort），
// 这里放实现。上游（server / 评测）按需注入。
// ═══════════════════════════════════════════════════════════════════

export { NoopTelemetry, NOOP_TELEMETRY, NOOP_SPAN } from "./noop";
export { LoggerTelemetry } from "./logger";
export type { LoggerTelemetryOptions } from "./logger";
export { failOpenTelemetry } from "./fail-open";
