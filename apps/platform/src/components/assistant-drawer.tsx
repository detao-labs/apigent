"use client";

// ═══════════════════════════════════════════════════════════════════
// AssistantDrawer — 全局 AI 助手抽屉
// ═══════════════════════════════════════════════════════════════════
//
// 由 URL 参数驱动（?assistant=1&repo=&endpoint=），在任意已登录页面可打开：
//   - 打开时快照页面上下文（get_page_context），导航不改变进行中的对话；
//   - 会话按 repo 持久化到 localStorage，重开自动恢复；
//   - 移动端为底部抽屉，桌面为右侧 440px 抽屉；
//   - ⌘J / Ctrl+J 全局切换，header 按钮唤起。
//
// 设计见 docs/modules/agent-runtime.md 与 2026-08-17 对话记录。

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Plus, Send, Sparkles, Square, X } from "lucide-react";
import { getToolName, isStaticToolUIPart, isTextUIPart } from "ai";
import type { UIMessage } from "ai";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  useIsMobile,
} from "@apigent/ui";
import { useAgentChat } from "@/hooks/use-agent-chat";
import type { AgentPageContext } from "@/hooks/use-agent-chat";
import { ASSISTANT_PARAM, buildAssistantUrl, repoIdFromPath } from "@/lib/assistant";

const STORAGE_KEY = "apigent-assistant-conversations";
const GLOBAL_KEY = "global";

interface StoredConversation {
  context: AgentPageContext;
  messages: UIMessage[];
  updatedAt: number;
}

function readConversations(): Record<string, StoredConversation> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredConversation>) : {};
  } catch {
    return {};
  }
}

function writeConversations(value: Record<string, StoredConversation>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 存储不可用（隐私模式 / 配额）时静默降级为不持久化
  }
}

/** tool part 在流式执行中的状态。 */
const RUNNING_TOOL_STATES = new Set(["input", "input-streaming", "partial-call", "call"]);

export function AssistantDrawer() {
  const t = useTranslations("assistant");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isMobile = useIsMobile();

  const open = searchParams.get(ASSISTANT_PARAM) === "1";

  // 打开时快照页面上下文：优先 URL 参数，其次从路径推断仓库。
  const contextRef = React.useRef<AgentPageContext>({
    url: pathname,
    repoId: searchParams.get("repo") ?? repoIdFromPath(pathname),
    endpointId: searchParams.get("endpoint") ?? undefined,
    locale,
  });

  React.useEffect(() => {
    if (!open) return;
    contextRef.current = {
      url: pathname,
      repoId: searchParams.get("repo") ?? repoIdFromPath(pathname),
      endpointId: searchParams.get("endpoint") ?? undefined,
      locale,
    };
  }, [open, pathname, searchParams, locale]);

  const chat = useAgentChat({ getPageContext: () => contextRef.current });
  const { messages, setMessages, sendMessage, stop, status, error } = chat;
  const streaming = status === "submitted" || status === "streaming";

  const [sessionKey, setSessionKey] = React.useState<string | null>(null);
  const [input, setInput] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const close = React.useCallback(() => {
    router.replace(buildAssistantUrl(pathname, window.location.search, false));
  }, [pathname, router]);

  const openAssistant = React.useCallback(() => {
    router.replace(buildAssistantUrl(pathname, window.location.search, true));
  }, [pathname, router]);

  // 打开时恢复当前 repo 的会话（没有则从空会话开始）。
  React.useEffect(() => {
    if (!open) return;
    const ctx = contextRef.current;
    const key = ctx.repoId ?? GLOBAL_KEY;
    setSessionKey(key);
    const stored = readConversations()[key];
    setMessages(stored && stored.messages.length > 0 ? stored.messages : []);
  }, [open, setMessages]);

  // 消息变化后防抖持久化。
  React.useEffect(() => {
    if (!open || !sessionKey || messages.length === 0) return;
    const timer = window.setTimeout(() => {
      const all = readConversations();
      all[sessionKey] = {
        context: contextRef.current,
        messages,
        updatedAt: Date.now(),
      };
      writeConversations(all);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [messages, open, sessionKey]);

  // 新消息 / 流式变化时滚动到底部。
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, open]);

  // ⌘J / Ctrl+J 全局切换；输入态不拦截。
  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "j") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      if (open) close();
      else openAssistant();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close, openAssistant]);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    const el = textareaRef.current;
    if (el) el.style.height = "auto";
    void sendMessage({ text });
  }

  function newChat() {
    if (sessionKey) {
      const all = readConversations();
      delete all[sessionKey];
      writeConversations(all);
    }
    setMessages([]);
  }

  function onInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.currentTarget;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  function textOf(msg: UIMessage): string {
    return msg.parts
      .filter(isTextUIPart)
      .map((part) => part.text)
      .join("");
  }

  function renderPart(part: UIMessage["parts"][number], index: number) {
    if (isTextUIPart(part)) {
      return (
        <p key={index} className="text-sm leading-relaxed whitespace-pre-wrap">
          {part.text}
        </p>
      );
    }
    if (isStaticToolUIPart(part)) {
      const running = RUNNING_TOOL_STATES.has(part.state);
      const toolName = getToolName(part);
      return (
        <div
          key={index}
          className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
        >
          {running ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
          {toolName}
          {part.state === "output-error" && " ✕"}
        </div>
      );
    }
    return null;
  }

  const suggestions = [
    { key: "overview", text: t("suggest.overview") },
    { key: "context", text: t("suggest.context") },
    { key: "compare", text: t("suggest.compare") },
  ] as const;

  const ctx = contextRef.current;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && close()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className="p-0"
        showCloseButton={false}
        style={isMobile ? { height: "85dvh", width: "100%" } : { width: "100%", maxWidth: 440 }}
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="shrink-0 border-b">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary" />
                <SheetTitle>{t("title")}</SheetTitle>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={newChat}
                  aria-label={t("newChat")}
                  title={t("newChat")}
                >
                  <Plus className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={close}
                  aria-label={t("close")}
                  title={t("close")}
                >
                  <X className="size-4" />
                </Button>
              </div>
            </div>
            <SheetDescription className="flex flex-wrap items-center gap-1.5">
              {t("description")}
              {ctx.repoId && (
                <span className="rounded-full border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">
                  {t("repoChip")}: {ctx.repoId}
                </span>
              )}
              {ctx.endpointId && (
                <span className="rounded-full border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">
                  {t("endpointChip")}: {ctx.endpointId}
                </span>
              )}
            </SheetDescription>
          </SheetHeader>

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t("emptyTitle")}</p>
                  <p className="mt-1 max-w-xs text-xs text-muted-foreground">{t("emptyHint")}</p>
                </div>
                <div className="mt-1 flex w-full max-w-xs flex-col gap-1.5">
                  {suggestions.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => void sendMessage({ text: item.text })}
                      className="rounded-lg border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                    >
                      {item.text}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) =>
                  msg.role === "user" ? (
                    <div key={msg.id} className="flex justify-end">
                      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                        {textOf(msg)}
                      </div>
                    </div>
                  ) : (
                    <div key={msg.id} className="flex flex-col gap-2">
                      {msg.parts.map((part, index) => renderPart(part, index))}
                    </div>
                  ),
                )}
                {streaming && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="size-3 animate-spin" />
                    {t("thinking")}
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="border-t border-destructive/30 bg-destructive/5 px-4 py-2 text-xs text-destructive">
              {t("errorHint")}
            </div>
          )}

          <form
            onSubmit={submit}
            className="flex shrink-0 items-end gap-2 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={onInputChange}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={t("placeholder")}
              className="max-h-40 min-h-9 w-full flex-1 resize-none rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {streaming ? (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => stop()}
                aria-label={t("stop")}
                title={t("stop")}
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-sm"
                disabled={!input.trim()}
                aria-label={t("send")}
                title={t("send")}
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
