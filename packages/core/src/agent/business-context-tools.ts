// ═══════════════════════════════════════════════════════════════════
// Business Context Tools — 业务上下文场景的 V0 工具定义
// ═══════════════════════════════════════════════════════════════════
//
// 只含定义（schema / description / scope），不含执行器。
// server 端在 /api/agent/run 注册 scope=server 的执行器；
// 前端在 useChat 注册 scope=client 的执行器。
//
// 模式映射：
//   交互（编辑）   get_page_context → get_endpoint_spec → generate_context → apply_edit_draft
//   自动（确认）   get_page_context → get_endpoint_spec → generate_context → save_business_context
// ═══════════════════════════════════════════════════════════════════

import { z } from "zod";
import type { AgentToolDefinition } from "./types";

/** constraints.type 枚举 */
export const CONSTRAINT_TYPES = [
  "precondition",
  "time_limit",
  "permission",
  "format",
  "business_rule",
  "other",
] as const;

/** 业务上下文草稿（与 business_contexts 表字段对应，UI 用 camelCase） */
export const BusinessContextSchema = z
  .object({
    capabilityName: z.string(),
    intent: z.string(),
    constraints: z.array(
      z.object({
        type: z.enum(CONSTRAINT_TYPES),
        rule: z.string(),
      }),
    ),
    sideEffects: z.array(z.string()),
    usageScenarios: z.array(z.string()),
    confidence: z.number().min(0).max(1),
    needsReview: z.boolean(),
  });
// 注：不启用 strict —— LLM 输出可能携带额外字段（如 reasoning/description），
// zod 默认 strip 掉未知键，保证批量生成与前端表单校验的一致性。

export type BusinessContext = z.infer<typeof BusinessContextSchema>;

export const getPageContextTool: AgentToolDefinition<Record<string, never>> = {
  name: "get_page_context",
  description:
    "获取当前页面的上下文：当前 URL、仓库 ID、接口 ID、界面语言、表单草稿。在读取任何前端状态前先调用本工具。",
  inputSchema: z.object({}).strict(),
  scope: "client",
};

export const getEndpointSpecTool: AgentToolDefinition<{
  repoId: string;
  endpointId: string;
}> = {
  name: "get_endpoint_spec",
  description:
    "根据仓库 ID 和接口 ID 获取接口的完整技术模型（方法、路径、参数、请求体、响应）。前端只有摘要，需要完整数据时调用。",
  inputSchema: z
    .object({
      repoId: z.string().min(1),
      endpointId: z.string().min(1),
    })
    .strict(),
  scope: "server",
};

export const generateContextTool: AgentToolDefinition<{
  repoId: string;
  endpointId: string;
  language?: "auto" | "zh" | "en";
}> = {
  name: "generate_context",
  description:
    "为指定接口生成结构化业务上下文草稿（能力名称、意图、约束、副作用、使用场景、置信度）。不落库，返回草稿供前端填充或保存。",
  inputSchema: z
    .object({
      repoId: z.string().min(1),
      endpointId: z.string().min(1),
      language: z.enum(["auto", "zh", "en"]).default("auto").optional(),
    })
    .strict(),
  scope: "server",
};

export const applyEditDraftTool: AgentToolDefinition<{ draft: BusinessContext }> = {
  name: "apply_edit_draft",
  description:
    "把生成的结构化业务上下文草稿填充到前端编辑表单中，用户可查看、修改和撤销。",
  inputSchema: z
    .object({
      draft: BusinessContextSchema,
    })
    .strict(),
  scope: "client",
};

export const saveBusinessContextTool: AgentToolDefinition<{
  repoId: string;
  endpointId: string;
  context: BusinessContext;
}> = {
  name: "save_business_context",
  description:
    "把业务上下文保存到数据库（写入 business_contexts），标记来源为 AI 生成或人工编辑，并触发站内通知。",
  inputSchema: z
    .object({
      repoId: z.string().min(1),
      endpointId: z.string().min(1),
      context: BusinessContextSchema,
    })
    .strict(),
  scope: "server",
};

/** 业务上下文场景的全部工具定义 */
export const BUSINESS_CONTEXT_TOOLS: AgentToolDefinition[] = [
  getPageContextTool,
  getEndpointSpecTool,
  generateContextTool,
  applyEditDraftTool,
  saveBusinessContextTool,
];
