// ═══════════════════════════════════════════════════════════════════
// Agent Tool Registry — 工具注册表
// ═══════════════════════════════════════════════════════════════════
//
// server 端持有：注册工具定义 + 执行器，route 以注册表为白名单，
// 只暴露已注册的工具，不接受任意工具名。
// ═══════════════════════════════════════════════════════════════════

import type { AgentToolContext, AgentToolDefinition } from "./types";

export type AgentToolExecutor<Input = unknown, Output = unknown> = (
  ctx: AgentToolContext,
  input: Input,
) => Promise<Output>;

type AnyToolExecutor = (
  ctx: AgentToolContext,
  input: unknown,
) => Promise<unknown>;

export class AgentToolRegistry {
  private definitions = new Map<string, AgentToolDefinition>();
  private executors = new Map<string, AnyToolExecutor>();

  register<Input, Output>(
    definition: AgentToolDefinition<Input>,
    executor?: AgentToolExecutor<Input, Output>,
  ): this {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Agent tool '${definition.name}' is already registered.`);
    }
    this.definitions.set(definition.name, definition);
    if (executor) {
      this.executors.set(
        definition.name,
        executor as unknown as AnyToolExecutor,
      );
    }
    return this;
  }

  list(): AgentToolDefinition[] {
    return [...this.definitions.values()];
  }

  get(name: string): AgentToolDefinition | undefined {
    return this.definitions.get(name);
  }

  getExecutor(name: string): AnyToolExecutor | undefined {
    return this.executors.get(name);
  }

  has(name: string): boolean {
    return this.definitions.has(name);
  }
}
