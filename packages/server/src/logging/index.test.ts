import { describe, it, expect } from "vitest";
import {
  getLoggingContext,
  runWithLoggingContext,
  withRequestContext,
  withTaskContext,
} from "./index";

describe("logging context", () => {
  it("exposes context inside runWithLoggingContext and clears it after", async () => {
    const seen = await runWithLoggingContext({ reqId: "req-1", repositoryId: "repo_1" }, async () =>
      getLoggingContext(),
    );
    expect(seen).toMatchObject({ reqId: "req-1", repositoryId: "repo_1" });
    // 离开上下文后应无残留
    expect(getLoggingContext()).toEqual({});
  });

  it("withRequestContext auto-generates a reqId and keeps existing context", () => {
    runWithLoggingContext({ organizationId: "org_1" }, () => {
      withRequestContext(
        () => {
          const ctx = getLoggingContext();
          expect(ctx.reqId).toBeTruthy();
          expect(ctx.reqId).toMatch(/^req_[0-9A-Za-z]{10}$/);
          expect(ctx.organizationId).toBe("org_1");
        },
        { userId: "usr_1" },
      );
    });
  });

  it("withRequestContext reuses an existing reqId from the outer context", () => {
    runWithLoggingContext({ reqId: "outer" }, () => {
      withRequestContext(() => {
        expect(getLoggingContext().reqId).toBe("outer");
      });
    });
  });

  it("withTaskContext sets taskId and preserves the existing context", () => {
    runWithLoggingContext({ repositoryId: "repo_1" }, () => {
      withTaskContext("task_1", () => {
        expect(getLoggingContext()).toMatchObject({ taskId: "task_1", repositoryId: "repo_1" });
      });
    });
  });

  it("nested contexts are isolated (parent not polluted by child)", () => {
    runWithLoggingContext({ reqId: "parent" }, () => {
      withTaskContext("child-task", () => {
        expect(getLoggingContext().taskId).toBe("child-task");
      });
      expect(getLoggingContext().taskId).toBeUndefined();
      expect(getLoggingContext().reqId).toBe("parent");
    });
  });

  describe("traceId", () => {
    it("falls back to the generated reqId inside a request context", () => {
      withRequestContext(() => {
        const ctx = getLoggingContext();
        expect(ctx.traceId).toBeTruthy();
        expect(ctx.traceId).toBe(ctx.reqId);
      });
    });

    it("falls back to the taskId inside a task context", () => {
      withTaskContext("task_trace", () => {
        expect(getLoggingContext().traceId).toBe("task_trace");
      });
    });

    it("keeps the outer traceId when a task runs inside a request", () => {
      withRequestContext(() => {
        const requestTrace = getLoggingContext().traceId;
        withTaskContext("task_1", () => {
          const ctx = getLoggingContext();
          // 一次操作只有一条链路：任务不新起 trace，只补充 taskId
          expect(ctx.traceId).toBe(requestTrace);
          expect(ctx.taskId).toBe("task_1");
        });
      });
    });

    it("lets an explicit traceId override the fallback", () => {
      withRequestContext(
        () => {
          expect(getLoggingContext().traceId).toBe("trace-explicit");
        },
        { traceId: "trace-explicit" },
      );
    });
  });
});
