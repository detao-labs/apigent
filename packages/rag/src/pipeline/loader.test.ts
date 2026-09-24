import { describe, it, expect, vi } from "vitest";
import { RagConfigError, type DenseIndex, type Embedder } from "../contracts";
import { fixtureDocumentSource } from "../testing/fixture-document-source";
import { hashEmbedder } from "../testing/hash-embedder";
import { memoryIndex } from "../testing/memory-index";
import { loadStageFactory, preloadStageProviders } from "./loader";
import { createStageRegistry } from "./registry";
import type { RagProviderSelection, RagStageRegistry } from "./types";

function embedderModule(): unknown {
  return { createEmbedder: () => hashEmbedder() };
}

function defaultOnlyModule(): unknown {
  return { default: () => hashEmbedder() };
}

function selection(overrides: Partial<Record<keyof RagProviderSelection, string>> = {}) {
  return {
    documentSource: { name: overrides.documentSource ?? "fixture" },
    embedder: { name: overrides.embedder ?? "hash" },
    denseIndex: { name: overrides.denseIndex ?? "memory" },
  } satisfies RagProviderSelection;
}

function builtinRegistry(): RagStageRegistry {
  const registry = createStageRegistry();
  registry.register("documentSource", "fixture", () => fixtureDocumentSource());
  registry.register("embedder", "hash", () => hashEmbedder());
  registry.register("denseIndex", "memory", () => memoryIndex());
  return registry;
}

describe("loadStageFactory", () => {
  it("returns a registered built-in without touching the module loader", async () => {
    const registry = builtinRegistry();
    const loadModule = vi.fn(async () => embedderModule());

    const factory = await loadStageFactory(registry, "embedder", "hash", { loadModule });

    expect(loadModule).not.toHaveBeenCalled();
    expect(factory).toBe(registry.resolve("embedder", "hash"));
  });

  it("loads a package by name via the named export and registers it", async () => {
    const registry = createStageRegistry();
    const loadModule = vi.fn(async () => embedderModule());

    const factory = await loadStageFactory(registry, "embedder", "@acme/rag-embedder", {
      loadModule,
    });

    expect(loadModule).toHaveBeenCalledWith("@acme/rag-embedder");
    expect(factory({ options: {}, deps: {} })).toMatchObject({ identity: { model: "test:hash" } });
    expect(registry.has("embedder", "@acme/rag-embedder")).toBe(true);
  });

  it("does not import the same package twice (the second resolve hits the registry)", async () => {
    const registry = createStageRegistry();
    const loadModule = vi.fn(async () => embedderModule());

    await loadStageFactory(registry, "embedder", "@acme/rag-embedder", { loadModule });
    await loadStageFactory(registry, "embedder", "@acme/rag-embedder", { loadModule });

    expect(loadModule).toHaveBeenCalledTimes(1);
  });

  it("accepts a default-exported factory", async () => {
    const registry = createStageRegistry();

    const factory = await loadStageFactory(registry, "embedder", "rag-embedder-x", {
      loadModule: async () => defaultOnlyModule(),
    });

    expect((factory({ options: {}, deps: {} }) as Embedder).identity.model).toBe("test:hash");
  });

  it("uses the per-stage export name (denseIndex → createDenseIndex)", async () => {
    const registry = createStageRegistry();

    const factory = await loadStageFactory(registry, "denseIndex", "@acme/rag-index", {
      loadModule: async () => ({ createDenseIndex: () => memoryIndex() }),
    });

    const index = factory({ options: {}, deps: {} }) as DenseIndex;
    await expect(index.size()).resolves.toBe(0);
  });

  it("reports the expected and actual exports when the shape is wrong", async () => {
    const registry = createStageRegistry();

    const attempt = loadStageFactory(registry, "embedder", "@acme/wrong-shape", {
      loadModule: async () => ({ something: 1, other: 2 }),
    });

    await expect(attempt).rejects.toBeInstanceOf(RagConfigError);
    await expect(attempt).rejects.toThrow(
      /expected a named export `createEmbedder` or a `default`/,
    );
    await expect(attempt).rejects.toThrow(/but found \[something, other\]/);
  });

  it("rejects a module that exports nothing usable", async () => {
    const registry = createStageRegistry();

    await expect(
      loadStageFactory(registry, "embedder", "@acme/empty", { loadModule: async () => null }),
    ).rejects.toThrow(/exported nothing/);
  });

  it("wraps a failed import into a readable config error naming the package", async () => {
    const registry = createStageRegistry();

    const attempt = loadStageFactory(registry, "embedder", "@acme/missing", {
      loadModule: async () => {
        throw new Error("Cannot find module '@acme/missing'");
      },
    });

    await expect(attempt).rejects.toBeInstanceOf(RagConfigError);
    await expect(attempt).rejects.toThrow(/failed to load provider package "@acme\/missing"/);
    await expect(attempt).rejects.toThrow(/Cannot find module/);
  });
});

describe("loadStageFactory — rejects file paths (P0-6)", () => {
  const pathLikeNames = [
    "./local-embedder.ts",
    "../shared/embedder",
    "/abs/path/embedder.js",
    "C:\\providers\\embedder.js",
    "file:/tmp/embedder.ts",
  ];

  for (const name of pathLikeNames) {
    it(`rejects ${name} without calling the loader`, async () => {
      const registry = createStageRegistry();
      const loadModule = vi.fn(async () => embedderModule());

      const attempt = loadStageFactory(registry, "embedder", name, { loadModule });

      await expect(attempt).rejects.toBeInstanceOf(RagConfigError);
      await expect(attempt).rejects.toThrow(/File paths are not supported/);
      await expect(attempt).rejects.toThrow(/Registered: \(none\)/);
      expect(loadModule).not.toHaveBeenCalled();
    });
  }
});

describe("preloadStageProviders (startup self-check)", () => {
  it("reports built-ins as registry and packages as package", async () => {
    const registry = builtinRegistry();
    const loadModule = vi.fn(async (specifier: string) => {
      if (specifier === "@acme/rag-index") return { createDenseIndex: () => memoryIndex() };
      throw new Error(`unexpected ${specifier}`);
    });

    const preloaded = await preloadStageProviders(
      registry,
      selection({ denseIndex: "@acme/rag-index" }),
      { loadModule },
    );

    expect(preloaded).toEqual([
      { kind: "documentSource", name: "fixture", source: "registry" },
      { kind: "embedder", name: "hash", source: "registry" },
      { kind: "denseIndex", name: "@acme/rag-index", source: "package" },
    ]);
  });

  it("fails the whole preload when one provider is unusable (startup signal)", async () => {
    const registry = builtinRegistry();

    await expect(
      preloadStageProviders(registry, selection({ embedder: "@acme/not-installed" }), {
        loadModule: async () => {
          throw new Error("Cannot find module '@acme/not-installed'");
        },
      }),
    ).rejects.toBeInstanceOf(RagConfigError);
  });

  it("leaves the service constructible afterwards (no second import needed)", async () => {
    const registry = builtinRegistry();
    const loadModule = vi.fn(async () => ({ createEmbedder: () => hashEmbedder() }));

    await preloadStageProviders(registry, selection({ embedder: "@acme/rag-embedder" }), {
      loadModule,
    });
    // 自检已经把包注册进 registry，装配期只走注册表
    const factory = registry.resolve("embedder", "@acme/rag-embedder");

    expect(factory({ options: {}, deps: {} })).toMatchObject({ identity: { model: "test:hash" } });
    expect(loadModule).toHaveBeenCalledTimes(1);
  });
});
