// ═══════════════════════════════════════════════════════════════════
// AI Model — 兼容 shim（实现已迁至 @apigent/core/ai）
// ═══════════════════════════════════════════════════════════════════
//
// P1-1 把「调用模型服务的能力」收敛到 @apigent/core/ai
// （定案见 docs/modules/rag-package-tasks.md）。本文件保留为 re-export，
// 让现有调用点零改动：
//
//   - packages/server/src/contexts/executor.ts（业务上下文生成）
//   - apps/platform/src/lib/ai.ts → app/api/agent/run（agent 运行时）
//
// `createAIModel` 是迁移前的旧名，只为兼容保留；**新代码请用
// `createLanguageModel`**。等调用点全部改名后，本 shim 可以删除。
// ═══════════════════════════════════════════════════════════════════

export { createLanguageModel, createLanguageModel as createAIModel } from "@apigent/core/ai";
