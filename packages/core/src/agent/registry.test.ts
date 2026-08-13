import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AgentToolRegistry } from "./registry";

const pingTool = {
  name: "ping",
  description: "Returns pong.",
  inputSchema: z.object({}).strict(),
  scope: "server" as const,
};

describe("AgentToolRegistry", () => {
  it("registers and lists definitions", () => {
    const registry = new AgentToolRegistry();
    registry.register(pingTool);

    expect(registry.has("ping")).toBe(true);
    expect(registry.get("ping")).toEqual(pingTool);
    expect(registry.list()).toHaveLength(1);
  });

  it("throws when registering the same name twice", () => {
    const registry = new AgentToolRegistry();
    registry.register(pingTool);
    expect(() => registry.register(pingTool)).toThrow(/already registered/);
  });

  it("stores and returns executors", async () => {
    const registry = new AgentToolRegistry();
    const executor = async () => ({ result: "pong" });
    registry.register(pingTool, executor);

    expect(registry.getExecutor("ping")).toBe(executor);
    expect(registry.getExecutor("missing")).toBeUndefined();
  });
});
