// ═══════════════════════════════════════════════════════════════════
// Agent Tool — 共享工具定义（前后端共用）
// ═══════════════════════════════════════════════════════════════════
//
// 工具定义（name / description / inputSchema / scope）是纯数据，放在
// packages/core 供前后端共享：
//   - server 端：按 scope=server 的工具定义组装执行器（API route）
//   - client 端：按 scope=client 的工具定义组装执行器（useChat）
// 执行器各写各的，不共享。
//
// 完整设计见 docs/modules/agent-runtime.md。
// ═══════════════════════════════════════════════════════════════════

import type { z } from "zod";

/** 工具执行环境：server = 后端执行，client = 浏览器执行 */
export type AgentToolScope = "server" | "client";

/** 工具定义（纯数据，前后端共享） */
export interface AgentToolDefinition<Input = unknown> {
  /** 机器可读名称，如 get_endpoint_spec */
  name: string;
  /** 给 LLM 看的用途说明 */
  description: string;
  /** 入参 schema（zod），两侧执行器均以此校验 */
  inputSchema: z.ZodType<Input>;
  /** 执行环境 */
  scope: AgentToolScope;
}

/** 工具执行上下文（server 端注入 session / 当前操作对象） */
export interface AgentToolContext {
  userId?: string;
  repoId?: string;
}
