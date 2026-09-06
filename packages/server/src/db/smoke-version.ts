// ═══════════════════════════════════════════════════════════════════
// Versioning Smoke — 冒烟验证：新导入/版本管道（跑在真实 DB 上）
// ═══════════════════════════════════════════════════════════════════
//
// 运行： cd packages/server && pnpm exec tsx src/db/smoke-version.ts
// (对本地已迁移的 DB 执行，会创建一条测试仓库与导入记录)
// ═══════════════════════════════════════════════════════════════════

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { loadConfig } from "@apigent/core/config";
import { getDB } from "./connection";
import { generateId } from "../id";
import { executeImportTask } from "../imports/executor";
import {
  rollbackVersionSteps,
  getDefaultVersionId,
  listVersions,
  compareVersions,
} from "../versions/service";
import {
  organizations,
  repositories,
  users,
  versions,
  versionCommits,
  versionEntityLinks,
  endpoints,
  dataModels,
  repoTasks,
} from "../db";
import { eq, and } from "drizzle-orm";

function ok(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"} - ${name}${detail ? ` :: ${detail}` : ""}`);
}

const SPEC_V1 = `openapi: 3.1.0
info: { title: Smoke API, version: v1 }
paths:
  /users:
    get:
      operationId: listUsers
      summary: List users
      responses:
        "200": { description: OK }
  /users/{id}:
    get:
      operationId: getUser
      summary: Get user
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200": { description: OK }
  /orders:
    get:
      operationId: listOrders
      summary: List orders
      responses:
        "200": { description: OK }
components:
  schemas:
    User:
      type: object
      properties:
        id: { type: string }
`;

const SPEC_V2 = `openapi: 3.1.0
info: { title: Smoke API, version: v2 }
paths:
  /users:
    get:
      operationId: listUsers
      summary: List users
      responses:
        "200": { description: OK }
  /users/{id}:
    get:
      operationId: getUser
      summary: Get user
      parameters:
        - { name: id, in: path, required: true, schema: { type: string } }
      responses:
        "200": { description: OK }
  /orders:
    get:
      operationId: listOrders
      summary: List orders (with param)
      parameters:
        - { name: q, in: query, schema: { type: string } }
      responses:
        "200": { description: OK }
`;

const SPEC_V3 = `openapi: 3.1.0
info: { title: Smoke API, version: v3 }
paths:
  /orders:
    get:
      operationId: listOrders
      summary: List orders only
      responses:
        "200": { description: OK }
`;

async function queueImport(repoId: string, versionId: string, mode: "full" | "partial", content: string) {
  const db = getDB();
  const tmp = await mkdir(path.join(os.tmpdir(), "apigent-smoke"), { recursive: true });
  void tmp;
  const specPath = path.join(os.tmpdir(), "apigent-smoke", `${generateId("task")}.yaml`);
  await writeFile(specPath, content, "utf8");
  const taskId = generateId("task");
  await db.insert(repoTasks).values({
    id: taskId,
    repoId,
    userId: (await db.select({ id: users.id }).from(users).limit(1))[0]?.id ?? "",
    taskType: "import",
    status: "queued",
    payload: { specPath, mode, versionId },
  });
  await executeImportTask(taskId);
  return taskId;
}

async function main() {
  loadConfig();
  const db = getDB();
  const headOf = async () =>
    (await db.select({ head: versions.headCommitId }).from(versions).where(eq(versions.id, versionId)))[0]?.head ?? "";
  const commitCount = async () =>
    (await db.select().from(versionCommits).where(eq(versionCommits.versionId, versionId))).length;

  // 测试用户 / 组织
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) throw new Error("no user; run db:seed first");
  const orgId = generateId("org");
  await db.insert(organizations).values({ id: orgId, name: "Smoke Org", ownerId: user.id });

  // 仓库 + 默认 main
  const repoId = generateId("repo");
  await db.insert(repositories).values({ id: repoId, orgId, name: "Smoke Repo" });
  const versionId = generateId("version");
  await db.insert(versions).values({ id: versionId, repoId, name: "main", isDefault: true, headCommitId: null });

  // 导入 1（全量）
  await queueImport(repoId, versionId, "full", SPEC_V1);
  const commit1Id = await headOf();
  const links1 = await db
    .select()
    .from(versionEntityLinks)
    .where(eq(versionEntityLinks.commitId, commit1Id));
  const blobs1 = await db.select().from(endpoints).where(eq(endpoints.repoId, repoId));
  ok("import1 creates 1 commit on main", (await commitCount()) === 1, `${await commitCount()}`);
  ok("import1 has 3 endpoint links", links1.filter((l) => l.entityType === "endpoint").length === 3);
  ok("import1 has 3 endpoint blobs", blobs1.length === 3, `${blobs1.length}`);
  const head1 = (await getDefaultVersionId(repoId)) === versionId;
  ok("main is default", head1);
  const dmBlobs = await db.select().from(dataModels).where(eq(dataModels.repoId, repoId));
  ok("import1 created 1 data model blob (User)", dmBlobs.length === 1, `${dmBlobs.length}`);

  // 导入 2（增量）：2 未变复用 + 1 修改 → 新增 1 blob
  await queueImport(repoId, versionId, "partial", SPEC_V2);
  const commit2Id = await headOf();
  const links2 = await db.select().from(versionEntityLinks).where(eq(versionEntityLinks.commitId, commit2Id));
  const blobs2 = await db.select().from(endpoints).where(eq(endpoints.repoId, repoId));
  ok("import2 creates a 2nd commit", (await commitCount()) === 2, `${await commitCount()}`);
  ok("import2 has 3 endpoint links", links2.filter((l) => l.entityType === "endpoint").length === 3);
  ok("import2 reuses 2 blobs (total 4 distinct blobs)", blobs2.length === 4, `${blobs2.length}`);
  const reused = links2.filter((l) => l.entityType === "endpoint").filter((l) =>
    blobs1.some((b) => b.id === l.entityId),
  ).length;
  ok("import2 reuses unchanged blobs (≥2)", reused >= 2, `reused=${reused}`);

  // 导入 3（全量，删掉 /users 与 /users/{id}）
  await queueImport(repoId, versionId, "full", SPEC_V3);
  const commit3Id = await headOf();
  const links3 = await db.select().from(versionEntityLinks).where(eq(versionEntityLinks.commitId, commit3Id));
  ok("import3 creates a 3rd commit", (await commitCount()) === 3, `${await commitCount()}`);
  ok("import3 (full) leaves 1 endpoint link", links3.filter((l) => l.entityType === "endpoint").length === 1);
  const [c3] = await db.select().from(versionCommits).where(eq(versionCommits.id, commit3Id));
  const removed =
    ((c3?.changeSummary as { removed?: string[] } | null)?.removed ?? []).includes("listUsers");
  ok("import3 changeSummary.removed includes listUsers", removed);

  // diff commit1 → commit2
  const diff = await compareVersions(repoId, commit1Id, commit2Id);
  ok("compareVersions commit1→2 reports modified", diff.modified >= 1, `modified=${diff.modified}`);

  // 回滚（移 head 1 步）
  const newHead = await rollbackVersionSteps(repoId, versionId, 1);
  const headRow = await db
    .select({ headCommitId: versions.headCommitId })
    .from(versions)
    .where(eq(versions.id, versionId));
  ok("rollback moves head to parent commit", headRow[0]?.headCommitId === newHead, `${headRow[0]?.headCommitId}`);

  const versionsList = await listVersions(repoId);
  ok("listVersions returns smoke repo", versionsList.length === 1, `${versionsList.length}`);

  console.log("done");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE_FAIL", err);
  process.exit(1);
});
