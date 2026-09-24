import { describe, it, expect, vi } from "vitest";
import { RagConfigError, type RagService } from "../contracts";
import {
  createRagServiceFromPackage,
  loadRagServiceFactory,
  RAG_SERVICE_FACTORY_EXPORT_NAME,
} from "./loader";
import type { RagServiceFactoryContext } from "./types";

/** 最小可用的假 RagService —— 只关心形状，不关心行为（契约只有这三个方法）。 */
function fakeService(label = "fake"): RagService & { label: string } {
  return {
    label,
    index: vi.fn(async () => ({
      chunksWritten: 0,
      chunksSkipped: 0,
      chunksDeleted: 0,
      tokens: 0,
      durationMs: 0,
    })),
    retrieve: vi.fn(async () => {
      throw new Error("not used in this test");
    }),
    health: vi.fn(async () => ({ status: "ok" as const })),
  };
}

const context = {
  deps: { sql: "handle" },
  telemetry: undefined,
  clock: () => 0,
  createTraceId: () => "trace-1",
} satisfies Omit<RagServiceFactoryContext, "options">;

describe("loadRagServiceFactory (L0)", () => {
  it("uses the agreed export name", () => {
    expect(RAG_SERVICE_FACTORY_EXPORT_NAME).toBe("createRagService");
  });

  it("loads a named export without calling it (self-check has no side effects)", async () => {
    const factory = vi.fn(() => fakeService());
    const loadModule = vi.fn(async () => ({ createRagService: factory }));

    const loaded = await loadRagServiceFactory("@acme/apigent-rag-qdrant", { loadModule });

    expect(loadModule).toHaveBeenCalledWith("@acme/apigent-rag-qdrant");
    expect(loaded).toBe(factory);
    expect(factory).not.toHaveBeenCalled();
  });

  it("accepts a default export", async () => {
    const factory = vi.fn(() => fakeService());

    const loaded = await loadRagServiceFactory("rag-service-x", {
      loadModule: async () => ({ default: factory }),
    });

    expect(loaded).toBe(factory);
  });

  it.each(["./local.ts", "../shared/impl", "/abs/impl.js", "file:/tmp/x"])(
    "rejects the file path %s without touching the loader",
    async (specifier) => {
      const loadModule = vi.fn(async () => ({}));

      await expect(loadRagServiceFactory(specifier, { loadModule })).rejects.toThrow(
        RagConfigError,
      );
      expect(loadModule).not.toHaveBeenCalled();
    },
  );

  it("reports an uninstalled package with the command that fixes it", async () => {
    const error = await loadRagServiceFactory("@acme/apigent-rag-qdrant", {
      loadModule: async () => {
        throw new Error("Cannot find module '@acme/apigent-rag-qdrant'");
      },
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RagConfigError);
    const message = (error as Error).message;
    expect(message).toContain("@acme/apigent-rag-qdrant");
    expect(message).toContain("pnpm add @acme/apigent-rag-qdrant");
    expect(message).toContain("Cannot find module");
  });

  it("lists the actual exports when the shape is wrong", async () => {
    const error = await loadRagServiceFactory("@acme/rag", {
      loadModule: async () => ({ createService: () => fakeService(), helper: 1 }),
    }).catch((e: unknown) => e);

    const message = (error as Error).message;
    expect(message).toContain("wrong export shape");
    expect(message).toContain("createRagService");
    expect(message).toContain("createService, helper");
  });

  it("rejects a module that exports nothing", async () => {
    await expect(
      loadRagServiceFactory("@acme/rag", { loadModule: async () => null }),
    ).rejects.toThrow(/exported nothing/);
  });
});

describe("createRagServiceFromPackage (L0 assembly)", () => {
  it("passes the package's own options alongside the injected context", async () => {
    let received: RagServiceFactoryContext | undefined;
    const service = fakeService("from-package");

    const created = await createRagServiceFromPackage(
      { package: "@acme/apigent-rag-qdrant", options: { endpoint: "https://rag.test" } },
      context,
      {
        loadModule: async () => ({
          createRagService: (ctx: RagServiceFactoryContext) => {
            received = ctx;
            return service;
          },
        }),
      },
    );

    expect(created).toBe(service);
    expect(received?.options).toEqual({ endpoint: "https://rag.test" });
    expect(received?.deps).toEqual({ sql: "handle" });
    expect(received?.createTraceId?.()).toBe("trace-1");
  });

  it("defaults the package options to an empty object", async () => {
    let received: RagServiceFactoryContext | undefined;

    await createRagServiceFromPackage({ package: "rag-impl" }, context, {
      loadModule: async () => ({
        createRagService: (ctx: RagServiceFactoryContext) => {
          received = ctx;
          return fakeService();
        },
      }),
    });

    expect(received?.options).toEqual({});
  });

  it("supports an async factory", async () => {
    const created = await createRagServiceFromPackage({ package: "rag-impl" }, context, {
      loadModule: async () => ({ createRagService: async () => fakeService("async") }),
    });

    expect(created).toMatchObject({ label: "async" });
  });

  it("rejects a factory that returns something that is not a RagService", async () => {
    const error = await createRagServiceFromPackage({ package: "@acme/rag" }, context, {
      // 只实现了 retrieve —— 这类包一旦放行，会在第一次索引进程里才炸。
      loadModule: async () => ({ createRagService: () => ({ retrieve: async () => null }) }),
    }).catch((e: unknown) => e);

    const message = (error as Error).message;
    expect(error).toBeInstanceOf(RagConfigError);
    expect(message).toContain("@acme/rag");
    expect(message).toContain("index");
    expect(message).toContain("health");
  });

  it("rejects a factory that returns a non-object", async () => {
    await expect(
      createRagServiceFromPackage({ package: "@acme/rag" }, context, {
        loadModule: async () => ({ createRagService: () => "nope" }),
      }),
    ).rejects.toThrow(/expected an object implementing RagService/);
  });
});
