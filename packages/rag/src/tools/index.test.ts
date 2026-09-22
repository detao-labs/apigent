import { describe, it, expect } from "vitest";
import type { AgentToolDefinition } from "@apigent/core/agent";
import { RAG_TOOLS, SEARCH_APIS_INPUT, searchApisTool } from "./index";
import type { SearchApisInput } from "./index";

describe("search_apis tool definition", () => {
  it("accepts a minimal query and applies no scope narrowing", () => {
    const parsed = SEARCH_APIS_INPUT.parse({ query: "退款接口" });
    expect(parsed).toEqual({ query: "退款接口" });
  });

  it("accepts the optional narrowing fields", () => {
    const parsed = SEARCH_APIS_INPUT.parse({
      query: "refund",
      repositoryId: "repo_1",
      organizationId: "org_1",
      projectId: "prj_1",
      topK: 5,
      mode: "deep",
    });
    expect(parsed.topK).toBe(5);
    expect(parsed.mode).toBe("deep");
  });

  it("rejects an empty query", () => {
    expect(() => SEARCH_APIS_INPUT.parse({ query: "" })).toThrow();
  });

  it("rejects unknown keys (strict schema)", () => {
    expect(() => SEARCH_APIS_INPUT.parse({ query: "x", unexpected: 1 })).toThrow();
  });

  it("caps topK so a caller cannot ask for everything", () => {
    expect(() => SEARCH_APIS_INPUT.parse({ query: "x", topK: 500 })).toThrow();
  });

  it("uses camelCase for parameters (only the tool name is snake_case)", () => {
    // 规则见 CLAUDE.md → External Surface Naming：工具名 snake_case、参数名 camelCase。
    expect(SEARCH_APIS_INPUT.parse({ query: "x", repositoryId: "repo_1" }).repositoryId).toBe(
      "repo_1",
    );
    expect(() => SEARCH_APIS_INPUT.parse({ query: "x", repository_id: "repo_1" })).toThrow();
  });

  it("is a server-scoped tool named search_apis", () => {
    expect(searchApisTool.name).toBe("search_apis");
    expect(searchApisTool.scope).toBe("server");
    expect(searchApisTool.description).toBeTruthy();
  });

  it("exposes no ask_apis tool (P0-5: no answer generation)", () => {
    expect(RAG_TOOLS.map((t) => t.name)).toEqual(["search_apis"]);
  });

  it("is structurally compatible with AgentToolDefinition", () => {
    // 编译期断言（本测试的作用就在这里）：工具定义无需让 `tools` 模块依赖 core，
    // 也能被 `AgentToolRegistry.register()` 接受 —— 两边只共享形状约定。
    const asAgentTool: AgentToolDefinition<SearchApisInput> = searchApisTool;
    expect(asAgentTool.name).toBe("search_apis");
    expect(asAgentTool.scope).toBe("server");
  });
});
