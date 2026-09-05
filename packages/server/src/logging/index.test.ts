import { describe, it, expect } from "vitest";
import {
  getLoggingContext,
  runWithLoggingContext,
  withRequestContext,
  withTaskContext,
} from "./index";

describe("logging context", () => {
  it("exposes context inside runWithLoggingContext and clears it after", async () => {
    const seen = await runWithLoggingContext({ reqId: "req-1", repoId: "repo_1" }, async () =>
      getLoggingContext(),
    );
    expect(seen).toMatchObject({ reqId: "req-1", repoId: "repo_1" });
    // 离开上下文后应无残留
    expect(getLoggingContext()).toEqual({});
  });

  it("withRequestContext auto-generates a reqId and keeps existing context", () => {
    runWithLoggingContext({ orgId: "org_1" }, () => {
      withRequestContext(
        () => {
          const ctx = getLoggingContext();
          expect(ctx.reqId).toBeTruthy();
          expect(ctx.reqId).toMatch(/^req_[0-9A-Za-z]{10}$/);
          expect(ctx.orgId).toBe("org_1");
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
    runWithLoggingContext({ repoId: "repo_1" }, () => {
      withTaskContext("task_1", () => {
        expect(getLoggingContext()).toMatchObject({ taskId: "task_1", repoId: "repo_1" });
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
});
