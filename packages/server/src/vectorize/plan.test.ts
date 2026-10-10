import { describe, it, expect } from "vitest";
import {
  findReusableVectorizeTask,
  isVectorizeTaskActive,
  toVectorizeSummary,
  type VectorizeTaskCandidate,
} from "./plan";

const candidate = (overrides: Partial<VectorizeTaskCandidate> = {}): VectorizeTaskCandidate => ({
  taskId: "task-1",
  status: "queued",
  commitId: "commit-1",
  ...overrides,
});

describe("isVectorizeTaskActive", () => {
  it("只有 queued / running 算进行中", () => {
    expect(isVectorizeTaskActive("queued")).toBe(true);
    expect(isVectorizeTaskActive("running")).toBe(true);
    expect(isVectorizeTaskActive("succeeded")).toBe(false);
    expect(isVectorizeTaskActive("failed")).toBe(false);
  });
});

describe("findReusableVectorizeTask（去重规则）", () => {
  it("同一 (repo, commit) 有进行中的任务 → 复用它（触发是幂等的）", () => {
    const found = findReusableVectorizeTask([candidate()], "commit-1");

    expect(found?.taskId).toBe("task-1");
  });

  it("commit 不同不复用（两次导入各自索引自己的 commit）", () => {
    expect(findReusableVectorizeTask([candidate()], "commit-2")).toBeUndefined();
  });

  it("已结束的任务不复用：新一轮触发该产生新一轮索引", () => {
    for (const status of ["succeeded", "failed"]) {
      expect(findReusableVectorizeTask([candidate({ status })], "commit-1")).toBeUndefined();
    }
  });

  it("多个候选里挑那个匹配且进行中的", () => {
    const found = findReusableVectorizeTask(
      [
        candidate({ taskId: "other-commit", commitId: "commit-9" }),
        candidate({ taskId: "finished", status: "succeeded" }),
        candidate({ taskId: "active", status: "running" }),
      ],
      "commit-1",
    );

    expect(found?.taskId).toBe("active");
  });

  it("没有候选（首次索引）→ 不复用", () => {
    expect(findReusableVectorizeTask([], "commit-1")).toBeUndefined();
  });
});

describe("toVectorizeSummary", () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    id: "task-1",
    status: "succeeded",
    progress: 100,
    payload: { trigger: "import", commitId: "commit-1" },
    result: null,
    error: null,
    versionId: "commit-1",
    createdAt: new Date("2026-10-10T00:00:00Z"),
    finishedAt: new Date("2026-10-10T00:00:05Z"),
    ...overrides,
  });

  it("没有 result 时统计为 0，而不是 undefined（前端与日志都不该看到空洞）", () => {
    const summary = toVectorizeSummary(row());

    expect(summary).toMatchObject({
      taskId: "task-1",
      status: "succeeded",
      chunksWritten: 0,
      chunksSkipped: 0,
      chunksDeleted: 0,
      tokens: 0,
      costUsd: null,
      durationMs: null,
      commitId: "commit-1",
    });
  });

  it("执行后以 result 为准（含 token / 成本 / 实际 commit）", () => {
    const summary = toVectorizeSummary(
      row({
        result: {
          commitId: "commit-2",
          chunksWritten: 12,
          chunksSkipped: 30,
          chunksDeleted: 3,
          tokens: 4567,
          costUsd: 0.0021,
          durationMs: 1234,
        },
      }),
    );

    expect(summary).toMatchObject({
      commitId: "commit-2",
      chunksWritten: 12,
      chunksSkipped: 30,
      chunksDeleted: 3,
      tokens: 4567,
      costUsd: 0.0021,
      durationMs: 1234,
    });
  });

  it("payload 缺 trigger / commitId 时有兜底（历史行不会让摘要崩）", () => {
    const summary = toVectorizeSummary(row({ payload: null, versionId: null, result: null }));

    expect(summary.trigger).toBe("manual");
    expect(summary.commitId).toBeNull();
  });
});
