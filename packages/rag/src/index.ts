// ═══════════════════════════════════════════════════════════════════
// RAG — Public API（`@apigent/rag`）
// ═══════════════════════════════════════════════════════════════════
//
// 顶层是**消费入口**：`createRagService()` —— 平台 API route、agent 运行时
// 工具、MCP tool、评测 harness 四个调用方共用它。
//
// ⚠️ 客户端边界：顶层会传递地触及 Node 专有模块（`node:crypto`，还有将来的
// db / native），**客户端组件只能 import `@apigent/rag/contracts` 与
// `@apigent/rag/tools`**，其余一律走 API route。见 docs/modules/rag-package.md §2.4。
//
// 因此顶层对契约**只做类型转发**（`export type *`，P2-8）：
//   - 客户端 `import type { RagScope } from "@apigent/rag"` 是安全的 —— 类型在
//     编译期被擦除，不会把 Node 模块拖进浏览器包；
//   - 但如果这里 `export *`，客户端就能 `import { CHUNK_LEVELS } from "@apigent/rag"`
//     拿到**值**，那条 import 会把整条管线（含 node:crypto）打进客户端包。
// 所以值一律走 `@apigent/rag/contracts`。这条结构约束由 boundaries.test.ts 钉住。
//
// 当前状态：Phase 2 进行中。`createRagService()` 已落地（P2-6），provider 的
// 具体实现随各自任务注册（P4-1 / P4-3 / P4-4 …）。
// ═══════════════════════════════════════════════════════════════════

export type * from "./contracts";
export * from "./pipeline";
export * from "./telemetry";
