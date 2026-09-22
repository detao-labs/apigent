import { describe, it, expect } from "vitest";
import { RagConfigError, type DenseIndex } from "../contracts";
import { memoryIndex } from "../testing/memory-index";
import { createStageRegistry } from "./registry";

function fakeDenseIndex(): DenseIndex {
  return memoryIndex();
}

describe("createStageRegistry", () => {
  it("resolves a registered factory by its configured name", () => {
    const registry = createStageRegistry();
    const factory = () => fakeDenseIndex();

    registry.register("denseIndex", "memory", factory);

    expect(registry.resolve("denseIndex", "memory")).toBe(factory);
    expect(registry.has("denseIndex", "memory")).toBe(true);
  });

  it("fails fast on an unknown name and lists what is registered", () => {
    const registry = createStageRegistry();
    registry.register("embedder", "hash", () => ({
      identity: { model: "test:hash", dim: 8 },
      embed: async () => ({ vectors: [] }),
    }));

    expect(() => registry.resolve("embedder", "qwen")).toThrow(RagConfigError);
    expect(() => registry.resolve("embedder", "qwen")).toThrow(/已注册：hash/);
  });

  it("says so explicitly when nothing has been registered yet", () => {
    const registry = createStageRegistry();

    expect(() => registry.resolve("denseIndex", "pgvector")).toThrow(/没有任何已注册实现/);
  });

  it("keeps stages in separate tables (npm 包名不会跨阶段误用)", () => {
    const registry = createStageRegistry();
    registry.register("embedder", "shared-name", () => ({
      identity: { model: "test:hash", dim: 8 },
      embed: async () => ({ vectors: [] }),
    }));

    expect(registry.has("embedder", "shared-name")).toBe(true);
    expect(registry.has("denseIndex", "shared-name")).toBe(false);
  });

  it("lets a later registration override an earlier one (外部包覆盖内置)", () => {
    const registry = createStageRegistry();
    const builtin = () => fakeDenseIndex();
    const external = () => fakeDenseIndex();

    registry.register("denseIndex", "memory", builtin);
    registry.register("denseIndex", "memory", external);

    expect(registry.resolve("denseIndex", "memory")).toBe(external);
    expect(registry.names("denseIndex")).toEqual(["memory"]);
  });
});
