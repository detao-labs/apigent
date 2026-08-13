"use client";

// ═══════════════════════════════════════════════════════════════════
// useAgentChat — 前端 Agent 运行时封装
// ═══════════════════════════════════════════════════════════════════
//
// 基于 AI SDK v7 useChat：
//   - transport 指向 /api/agent/run（server tools 由后端执行）；
//   - onToolCall 分发 client tools（get_page_context / apply_edit_draft），
//     执行结果通过 addToolOutput 回传，协议自动续跑；
//   - 调用方注入页面上下文读取与草稿填充回调，hook 本身不持有 UI 状态。
//
// 完整设计见 docs/modules/agent-runtime.md。
// ═══════════════════════════════════════════════════════════════════

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useRef } from "react";
import { applyEditDraftTool } from "@apigent/core/agent";
import type { BusinessContext } from "@apigent/core/agent";

/** 页面上下文（get_page_context 的返回） */
export interface AgentPageContext {
  url: string;
  repoId?: string;
  endpointId?: string;
  locale: string;
  formDraft?: BusinessContext | null;
}

export interface UseAgentChatOptions {
  /** 流式端点，默认 /api/agent/run */
  api?: string;
  /** 读取当前页面上下文（client tool: get_page_context） */
  getPageContext?: () =>
    | AgentPageContext
    | null
    | Promise<AgentPageContext | null>;
  /** 把生成的草稿填充到前端表单（client tool: apply_edit_draft） */
  onApplyDraft?: (draft: BusinessContext) => void;
}

/** addToolOutput 的宽松签名（AI SDK 泛型工具集在运行时未知，做窄化 cast） */
type AddToolOutput = (input: {
  tool: string;
  toolCallId: string;
  output?: unknown;
  state?: "output-error";
  errorText?: string;
}) => void;

export function useAgentChat({
  api = "/api/agent/run",
  getPageContext,
  onApplyDraft,
}: UseAgentChatOptions = {}) {
  const addToolOutputRef = useRef<AddToolOutput | null>(null);

  const onToolCall = useCallback(
    (options: {
      toolCall: { toolName: string; toolCallId: string; input: unknown };
    }) => {
      const { toolCall } = options;
      const dispatch = async () => {
        switch (toolCall.toolName) {
          case "get_page_context":
            return (await getPageContext?.()) ?? null;
          case "apply_edit_draft": {
            const parsed = applyEditDraftTool.inputSchema.safeParse(toolCall.input);
            if (!parsed.success) {
              throw new Error("apply_edit_draft: 入参校验失败");
            }
            onApplyDraft?.(parsed.data.draft);
            return { ok: true };
          }
          default:
            throw new Error(`Unknown client tool: ${toolCall.toolName}`);
        }
      };
      void dispatch().then(
        (output) =>
          addToolOutputRef.current?.({
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            output,
          }),
        (err) =>
          addToolOutputRef.current?.({
            tool: toolCall.toolName,
            toolCallId: toolCall.toolCallId,
            state: "output-error",
            errorText: err instanceof Error ? err.message : String(err),
          }),
      );
    },
    [getPageContext, onApplyDraft],
  );

  const chat = useChat({
    transport: new DefaultChatTransport({ api }),
    onToolCall,
  });

  // latest-ref：onToolCall 回调里引用最新 addToolOutput
  addToolOutputRef.current = chat.addToolOutput as unknown as AddToolOutput;

  return chat;
}
