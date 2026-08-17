// ═══════════════════════════════════════════════════════════════════
// Stub LLM Provider — Dev Only (Throws on Use)
// ═══════════════════════════════════════════════════════════════════

import type { LLMFlow } from "../../config";
import type { LLMProvider, ChatMessage, LLMGenerateOptions } from "../../types";

export class StubLLMProvider implements LLMProvider {
  private message =
    "LLM provider not configured. Set llm.provider in apigent.config.yaml and provide the API key in .env.";

  async generate(_flow: LLMFlow, _prompt: string, _options?: LLMGenerateOptions): Promise<string> {
    throw new Error(this.message);
  }

  async chat(
    _flow: LLMFlow,
    _messages: ChatMessage[],
    _options?: LLMGenerateOptions,
  ): Promise<string> {
    throw new Error(this.message);
  }
}
