// ═══════════════════════════════════════════════════════════════════
// AI Model Adapter — re-export（实现在 packages/server）
// ═══════════════════════════════════════════════════════════════════
//
// 保持 platform 内部 import 路径稳定（@/lib/ai → createAIModel）。
// 实现位于 packages/server/src/ai/model.ts，供 Worker（批量生成）
// 与 API route（agent 运行时）共用。
// ═══════════════════════════════════════════════════════════════════

export { createAIModel } from "@apigent/server/ai";
export type { LLMFlow } from "@apigent/core/config";
