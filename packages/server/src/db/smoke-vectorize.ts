// ═══════════════════════════════════════════════════════════════════
// Vectorize Smoke — 冒烟验证：RAG 摄取任务生命周期（跑在真实 DB 上）
// ═══════════════════════════════════════════════════════════════════
//
// 运行： cd packages/server && pnpm exec tsx src/db/smoke-vectorize.ts
//
// 验证的是**任务层**（P4-7），不碰真实 embedding / 向量库：runner 是替身，
// 只回一个假 `IndexReport`。这样「什么时候索引、索引哪个 commit、去重、重试」
// 这几条能独立于 RAG 装配被验证（真实装配是 P6-1）。
//
// 覆盖：
//   1. 提交 → 真实 PgQueue + worker 消费 → 结果（token / 统计）落库；
//   2. 同一 (repo, commit) 的进行中任务被复用（连续触发不跑两轮）；
//   3. 未注册 runner 时自动触发是可见的 no-op，不抛错、不排队；
//   4. 失败 → 重试成功，attempts 递增，result 被新结果覆盖；
//   5. 触发失败不抛给业务调用方（索引是派生数据，不该拖垮导入 / 保存）。
//
// 会写入带 `p47` 前缀的临时行，结束前按 id 清理并打印残留计数（应为 0）。
// ═══════════════════════════════════════════════════════════════════

import { loadConfig } from "@apigent/core/config";
import type { IndexRequest } from "@apigent/rag/contracts";
import { closeDB, getPool } from "./connection";
import {
  clearVectorizeRunner,
  createVectorizeTask,
  hasVectorizeRunner,
  retryVectorizeTask,
  setVectorizeRunner,
  stopVectorizeWorker,
  triggerVectorize,
  type VectorizeRunner,
} from "../vectorize";

loadConfig();

const USER = "u-p47";
const ORG = "org-p47";
const REPO = "repo-p47";
const VERSION = "ver-p47";
const COMMIT_A = "c-p47a";
const COMMIT_B = "c-p47b";

const pool = getPool();
let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`, ok ? "" : `→ got ${JSON.stringify(actual)}`);
}

interface TaskRow {
  id: string;
  status: string;
  progress: number;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  job_id: string | null;
}

async function taskRow(taskId: string): Promise<TaskRow | undefined> {
  const { rows } = await pool.query<TaskRow>(
    `select id, status, progress, result, error, attempts, job_id
       from repository_tasks where id = $1`,
    [taskId],
  );
  return rows[0];
}

async function waitFor(taskId: string, predicate: (row: TaskRow) => boolean): Promise<TaskRow> {
  const startedAt = Date.now();
  for (;;) {
    const row = await taskRow(taskId);
    if (row && predicate(row)) return row;
    if (Date.now() - startedAt > 10_000) {
      throw new Error(`timeout waiting for task ${taskId} (last: ${JSON.stringify(row)})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

async function countTasks(repositoryId: string): Promise<number> {
  const { rows } = await pool.query<{ n: number }>(
    `select count(*)::int as n from repository_tasks
      where repository_id = $1 and task_type = 'vectorize'`,
    [repositoryId],
  );
  return rows[0]?.n ?? 0;
}

async function seed(): Promise<void> {
  await pool.query(
    `insert into users (id, email, password_hash, name) values ($1,'p47@test.local','x','p47')`,
    [USER],
  );
  await pool.query(`insert into organizations (id, name, owner_id) values ($1,'p47 org',$2)`, [
    ORG,
    USER,
  ]);
  await pool.query(
    `insert into repositories (id, organization_id, name) values ($1,$2,'p47 repo')`,
    [REPO, ORG],
  );
  await pool.query(
    `insert into versions (id, repository_id, name, is_default) values ($1,$2,'main',true)`,
    [VERSION, REPO],
  );
  for (const id of [COMMIT_A, COMMIT_B]) {
    await pool.query(
      `insert into version_commits (id, repository_id, version_id, source)
       values ($1,$2,$3,'import')`,
      [id, REPO, VERSION],
    );
  }
}

async function cleanup(): Promise<void> {
  await pool.query(
    `delete from impl_queue_jobs
      where id in (select job_id from repository_tasks
                    where repository_id = $1 and job_id is not null)`,
    [REPO],
  );
  await pool.query(`delete from repository_tasks where repository_id = $1`, [REPO]);
  await pool.query(`delete from version_commits where repository_id = $1`, [REPO]);
  await pool.query(`delete from versions where repository_id = $1`, [REPO]);
  await pool.query(`delete from repositories where id = $1`, [REPO]);
  await pool.query(`delete from organizations where id = $1`, [ORG]);
  await pool.query(`delete from users where id = $1`, [USER]);

  const { rows } = await pool.query(
    `select (select count(*) from repository_tasks where repository_id = $1) as tasks,
            (select count(*) from repositories where id = $1) as repos,
            (select count(*) from users where id = $2) as users`,
    [REPO, USER],
  );
  console.log("清理后残留:", JSON.stringify(rows[0]));
}

async function main(): Promise<void> {
  await seed();

  // runner 替身：`gate` 模式卡住不返回，用来稳定地观察「进行中」状态。
  let mode: "gate" | "fail" | "ok" = "gate";
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const calls: IndexRequest[] = [];

  const runner = (async (request: IndexRequest) => {
    calls.push({ ...request });
    if (mode === "gate") await gate;
    if (mode === "fail") throw new Error("embedding provider unreachable");
    return { chunksWritten: 7, chunksSkipped: 3, chunksDeleted: 1, tokens: 1234, durationMs: 42 };
  }) satisfies VectorizeRunner;

  setVectorizeRunner(runner);

  // ── 1. 提交 → 被 worker 消费 → 结果落库 ──────────────────────────
  const first = await createVectorizeTask(REPO, USER, { trigger: "manual", commitId: COMMIT_A });
  check("提交后是 queued", first.status, "queued");

  const running = await waitFor(first.taskId, (row) => row.status === "running");
  check("worker 消费后进入 running 且回填 jobId", typeof running.job_id === "string", true);

  // ── 2. 去重：同一 (repo, commit) 的进行中任务被复用 ───────────────
  const duplicate = await createVectorizeTask(REPO, USER, {
    trigger: "context_saved",
    commitId: COMMIT_A,
  });
  check("同 (repo, commit) 复用同一个任务", duplicate.taskId, first.taskId);
  check("没有排出第二个任务（连续触发不跑两轮）", await countTasks(REPO), 1);

  releaseGate();
  const succeeded = await waitFor(first.taskId, (row) => row.status === "succeeded");
  check("成功后 progress = 100", succeeded.progress, 100);
  check("result 落库（含 token / 成本口径）", succeeded.result, {
    commitId: COMMIT_A,
    chunksWritten: 7,
    chunksSkipped: 3,
    chunksDeleted: 1,
    tokens: 1234,
    durationMs: 42,
  });
  check("runner 收到的是任务里的 commit", calls[0]?.commitId, COMMIT_A);

  // ── 3. 未注册 runner：自动触发只跳过 ─────────────────────────────
  clearVectorizeRunner();
  check("clearVectorizeRunner 之后 hasVectorizeRunner 为 false", hasVectorizeRunner(), false);
  await triggerVectorize(REPO, USER, { trigger: "import", commitId: COMMIT_B });
  check("未启用时不排队（no-op 且留痕）", await countTasks(REPO), 1);

  // ── 4. 失败 → 重试 ──────────────────────────────────────────────
  mode = "fail";
  setVectorizeRunner((async (request: IndexRequest) => {
    calls.push({ ...request });
    if (mode === "fail") throw new Error("embedding provider unreachable");
    return { chunksWritten: 2, chunksSkipped: 0, chunksDeleted: 0, tokens: 99, durationMs: 7 };
  }) satisfies VectorizeRunner);
  const failing = await createVectorizeTask(REPO, USER, { trigger: "manual", commitId: COMMIT_B });
  const failed = await waitFor(failing.taskId, (row) => row.status === "failed");
  check("失败原因可见", failed.error, "embedding provider unreachable");

  mode = "ok";
  const retried = await retryVectorizeTask(REPO, failing.taskId);
  check("重试把任务复位为 queued", retried.status, "queued");
  const retriedDone = await waitFor(failing.taskId, (row) => row.status === "succeeded");
  check("attempts 递增", retriedDone.attempts, 2);
  check("result 被新结果覆盖", retriedDone.result?.tokens, 99);

  // ── 5. 触发失败不打断业务调用方 ──────────────────────────────────
  let threw = false;
  try {
    await triggerVectorize("repo-p47-missing", USER, { trigger: "import" });
  } catch {
    threw = true;
  }
  check("triggerVectorize 不把失败抛给调用方", threw, false);
  check("失败的触发不留垃圾任务", await countTasks("repo-p47-missing"), 0);
}

void main()
  .catch((err) => {
    console.error(err);
    failures += 1;
  })
  .finally(async () => {
    await stopVectorizeWorker();
    await cleanup().catch((err) => console.error("cleanup failed", err));
    await closeDB();
    if (failures > 0) process.exit(1);
  });
