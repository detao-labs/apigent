// ═══════════════════════════════════════════════════════════════════
// LLM Provider Interface
// ═══════════════════════════════════════════════════════════════════

import type { LLMFlow } from "../config";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMGenerateOptions {
  temperature?: number;
  maxTokens?: number;
}

export interface LLMProvider {
  /** Single-turn text generation (prompt → completion) */
  generate(flow: LLMFlow, prompt: string, options?: LLMGenerateOptions): Promise<string>;

  /** Multi-turn chat */
  chat(flow: LLMFlow, messages: ChatMessage[], options?: LLMGenerateOptions): Promise<string>;
}
