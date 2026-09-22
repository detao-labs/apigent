// ═══════════════════════════════════════════════════════════════════
// RAG — Public API（`@apigent/rag`）
// ═══════════════════════════════════════════════════════════════════
//
// 顶层是**消费入口**：`createRagService()` —— 平台 API route、agent 运行时
// 工具、MCP tool、评测 harness 四个调用方共用它。
//
// ⚠️ 客户端边界：顶层（将来）会传递地触及 db / native 模块，**客户端组件只能
// import `@apigent/rag/contracts` 与 `@apigent/rag/tools`**，其余一律走 API
// route。见 docs/modules/rag-package.md §2.4。
//
// 当前状态：Phase 2 进行中。`createRagService()` 已落地（P2-6），provider 的
// 具体实现随各自任务注册（P4-1 / P4-3 / P4-4 …）。
// ═══════════════════════════════════════════════════════════════════

export * from "./contracts";
export * from "./pipeline";
export * from "./telemetry";
