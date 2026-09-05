// ═══════════════════════════════════════════════════════════════════
// Agent Runtime — /api/agent/run 流式对话入口
// ═══════════════════════════════════════════════════════════════════
//
// AI SDK streamText 驱动：
//   - 只暴露 AgentToolRegistry 内已注册的 server 工具（白名单）；
//   - server 工具在后端执行（session 校验 + 现有 service）；
//   - client 工具不在此执行，由前端 useChat 处理（协议自动回传）。
//
// 完整设计见 docs/modules/agent-runtime.md。
// ═══════════════════════════════════════════════════════════════════

import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  tool,
  zodSchema,
} from "ai";
import type { ToolSet, UIMessage } from "ai";
import { NextResponse } from "next/server";
import {
  AgentToolRegistry,
  getEndpointSpecTool,
  saveBusinessContextTool,
} from "@apigent/core/agent";
import { createAIModel } from "@/lib/ai";
import { getRepoEndpoints } from "@/services/repos";
import { saveEndpointContext } from "@/services/contexts";
import { withRoute } from "@/lib/route";
import { generateId } from "@apigent/server/id";

/** 业务上下文助手系统提示（V0；多语言化留给 i18n 阶段） */
const SYSTEM_PROMPT = `你是 Apigent 平台的 API 业务上下文助手，帮助用户为接口生成、编辑和保存业务上下文（能力名称、意图、约束、副作用、使用场景）。

规则：
- 先调用 get_page_context 获取当前页面状态；需要完整技术数据时调用 get_endpoint_spec；
- 生成结构化草稿后：编辑模式调用 apply_edit_draft 填充前端表单；自动模式调用 save_business_context 保存；
- 不得编造接口信息；数据不足时向用户说明并请求确认；
- capability_name 用简洁的业务名词；intent 用一句话说明接口做什么；constraints 只列后端强制的规则；
- 语言跟随用户输入，未指定时默认中文。`;

/** server 工具注册表（进程级单例；V0 只注册已实现执行器的工具） */
const registry = new AgentToolRegistry();

registry.register(getEndpointSpecTool, async (ctx, input) => {
  if (!ctx.userId) throw new Error("unauthorized");
  const endpoints = await getRepoEndpoints(input.repoId, ctx.userId);
  const endpoint = endpoints.find((ep) => ep.id === input.endpointId);
  if (!endpoint) {
    throw new Error(`Endpoint not found: ${input.endpointId}`);
  }
  return endpoint;
});

registry.register(saveBusinessContextTool, async (ctx, input) => {
  if (!ctx.userId) throw new Error("unauthorized");
  await saveEndpointContext(input.repoId, input.endpointId, input.context, {
    source: "ai",
  });
  return { ok: true };
});

/**
 * 归一化入参消息为 UIMessage 格式。
 * useChat 原生发送 UIMessage（id + parts）；外部/冒烟请求可能是简单
 * { role, content } 格式，这里兼容两种。
 */
function normalizeMessages(messages: unknown[]): UIMessage[] {
  return messages.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      throw new Error("invalid message");
    }
    const msg = raw as Record<string, unknown>;
    if (Array.isArray(msg.parts)) {
      return msg as unknown as UIMessage;
    }
    const role = msg.role === "assistant" || msg.role === "system" ? msg.role : "user";
    return {
      id: typeof msg.id === "string" ? msg.id : generateId("msg"),
      role,
      parts: [
        {
          type: "text",
          text: typeof msg.content === "string" ? msg.content : "",
        },
      ],
    } as unknown as UIMessage;
  });
}

export const POST = withRoute({ auth: true }, async ({ request, user }) => {
  let body: { messages?: unknown };
  try {
    body = (await request.json()) as { messages?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  // 白名单：只暴露注册表内已注册执行器的 server 工具
  const serverTools: ToolSet = {};
  for (const def of registry.list()) {
    if (def.scope !== "server") continue;
    const executor = registry.getExecutor(def.name);
    if (!executor) continue;
    serverTools[def.name] = tool({
      description: def.description,
      inputSchema: zodSchema(def.inputSchema),
      execute: async (input: unknown) => executor({ userId: user.id }, input),
    });
  }

  const result = streamText({
    model: createAIModel("business_context"),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(normalizeMessages(body.messages), {
      tools: serverTools,
    }),
    tools: serverTools,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream, tools: serverTools }),
  });
});
