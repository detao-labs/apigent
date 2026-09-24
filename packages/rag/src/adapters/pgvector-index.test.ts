import { describe, it, expect } from "vitest";
import {
  RagConfigError,
  RagDependencyError,
  type DenseChunkRecord,
  type SqlExecutor,
} from "../contracts";
import { PGVECTOR_DIMENSIONS, pgvectorIndex, pgvectorIndexProvider } from "./pgvector-index";

// ───────────────────────────────────────────────────────────────────
// 记录调用的假执行器：既能断言「发出什么 SQL」，也能按需返回行
// ───────────────────────────────────────────────────────────────────

interface Recorded {
  sql: string;
  params: readonly unknown[] | undefined;
}

function fakeSql(rows: unknown[][] = []) {
  const calls: Recorded[] = [];
  let index = 0;

  const sql: SqlExecutor = {
    async query<Row>(text: string, params?: readonly unknown[]): Promise<Row[]> {
      calls.push({ sql: text, params });
      return (rows[index++] ?? []) as Row[];
    },
  };

  return { sql, calls, at: (i: number) => calls[i] };
}

function record(overrides: Partial<DenseChunkRecord> = {}): DenseChunkRecord {
  return {
    chunkKey: "endpoint:POST:/orders/{id}/refund",
    repositoryId: "repo-1",
    organizationId: "org-1",
    commitIds: ["commit-1"],
    level: "endpoint",
    lang: "zh",
    text: "退款接口：对已支付订单发起退款",
    fields: { method: "POST", path: "/orders/{id}/refund", tags: ["订单"] },
    metadata: { operationId: "refundOrder" },
    vector: new Array<number>(PGVECTOR_DIMENSIONS).fill(0.1),
    embeddingModel: "qwen:text-embedding-v4",
    ...overrides,
  };
}

const query = (
  overrides: Partial<Parameters<ReturnType<typeof pgvectorIndex>["search"]>[0]> = {},
) => ({
  vector: new Array<number>(PGVECTOR_DIMENSIONS).fill(0.1),
  scope: { repositoryIds: ["repo-1"], commitIds: ["commit-1"] },
  limit: 10,
  embeddingModel: "qwen:text-embedding-v4",
  ...overrides,
});

// ───────────────────────────────────────────────────────────────────
// 写入
// ───────────────────────────────────────────────────────────────────

describe("pgvectorIndex — 写入（内容寻址 + link）", () => {
  it("按 (repository_id, chunk_key, content_hash) 做冲突目标（内容寻址的锚点）", async () => {
    const fake = fakeSql();
    await pgvectorIndex({ sql: fake.sql }).upsert([record()]);

    const insert = fake.at(0);
    expect(insert?.sql).toContain("insert into knowledge_chunks");
    expect(insert?.sql).toContain("on conflict (repository_id, chunk_key, content_hash) do update");
    // 向量以字面量 + ::vector 传入，绝不拼进 SQL
    expect(insert?.params?.[9]).toMatch(/^\[0\.1,0\.1,/);
  });

  it("content_hash 由正文决定：同 key 不同内容得到不同的 hash 与 id", async () => {
    const fake = fakeSql();
    const index = pgvectorIndex({ sql: fake.sql });

    await index.upsert([record()]);
    await index.upsert([record({ text: "改过的正文" })]);

    const firstHash = fake.at(0)?.params?.[7];
    const secondHash = fake.at(2)?.params?.[7];
    expect(firstHash).not.toBe(secondHash);
    expect(fake.at(0)?.params?.[0]).not.toBe(fake.at(2)?.params?.[0]);
  });

  it("同一份内容重复写入 → 同一个 id 与 hash（幂等的基础）", async () => {
    const fake = fakeSql();
    const index = pgvectorIndex({ sql: fake.sql });

    await index.upsert([record()]);
    await index.upsert([record()]);

    expect(fake.at(0)?.params?.[0]).toBe(fake.at(2)?.params?.[0]);
    expect(fake.at(0)?.params?.[7]).toBe(fake.at(2)?.params?.[7]);
  });

  it("每个 commit 一条 link（内容寻址 + 多 commit 复用同一行）", async () => {
    const fake = fakeSql();
    await pgvectorIndex({ sql: fake.sql }).upsert([record({ commitIds: ["c1", "c2"] })]);

    const linkCalls = fake.calls.filter((call) =>
      call.sql.includes("insert into knowledge_chunk_links"),
    );
    expect(linkCalls).toHaveLength(2);
    expect(linkCalls.map((call) => call.params?.[0])).toEqual(["c1", "c2"]);
    expect(linkCalls[0]?.sql).toContain("on conflict do nothing");
  });

  it("fields 摊平进 metadata（否则 method/tag 过滤没法在 SQL 里做）", async () => {
    const fake = fakeSql();
    await pgvectorIndex({ sql: fake.sql }).upsert([record()]);

    const metadata = JSON.parse(String(fake.at(0)?.params?.[8])) as Record<string, unknown>;
    expect(metadata).toMatchObject({
      operationId: "refundOrder", // 原 metadata 保留
      method: "POST",
      path: "/orders/{id}/refund",
      tags: ["订单"],
    });
  });

  it("organizationId 缺失时回落到查库，并缓存（同一仓库只查一次）", async () => {
    const fake = fakeSql([[{ organizationId: "org-from-db" }]]);
    const index = pgvectorIndex({ sql: fake.sql });

    await index.upsert([record({ organizationId: undefined })]);
    await index.upsert([record({ organizationId: undefined, text: "另一段内容" })]);

    const lookups = fake.calls.filter((call) => call.sql.includes("from repositories"));
    expect(lookups).toHaveLength(1);
    // 第 0 次是回落查询，第 1 次才是 insert —— insert 的第 2 个参数是 org 快照。
    expect(fake.at(1)?.sql).toContain("insert into knowledge_chunks");
    expect(fake.at(1)?.params?.[1]).toBe("org-from-db");
  });

  it("仓库不存在且没给 organizationId → 明确报错（不能静默写坏快照列）", async () => {
    const fake = fakeSql([[]]);

    await expect(
      pgvectorIndex({ sql: fake.sql }).upsert([record({ organizationId: undefined })]),
    ).rejects.toThrow(/cannot resolve organization_id/);
  });
});

// ───────────────────────────────────────────────────────────────────
// 写入前的校验（P0-2）
// ───────────────────────────────────────────────────────────────────

describe("pgvectorIndex — 写入校验", () => {
  it("维度不符 → 拒绝写入", async () => {
    const fake = fakeSql();
    const index = pgvectorIndex({ sql: fake.sql });

    await expect(index.upsert([record({ vector: [0.1, 0.2] })])).rejects.toThrow(
      RagDependencyError,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("缺 embedding_model → 拒绝（否则 P0-2 的按模型过滤失去依据）", async () => {
    const fake = fakeSql();

    await expect(
      pgvectorIndex({ sql: fake.sql }).upsert([record({ embeddingModel: "" })]),
    ).rejects.toThrow(/no embedding_model/);
  });

  it("空正文 → 拒绝", async () => {
    const fake = fakeSql();

    await expect(pgvectorIndex({ sql: fake.sql }).upsert([record({ text: "" })])).rejects.toThrow(
      /empty content/,
    );
  });
});

// ───────────────────────────────────────────────────────────────────
// 检索：过滤必须在 SQL 里（P0-4）
// ───────────────────────────────────────────────────────────────────

describe("pgvectorIndex — 检索（过滤写在 SQL 里）", () => {
  it("权限打 chunk、版本打 link，且都在 ORDER BY / LIMIT 之前", async () => {
    const fake = fakeSql([[]]);
    await pgvectorIndex({ sql: fake.sql }).search(query());

    const sql = fake.at(0)?.sql ?? "";
    const whereIndex = sql.indexOf("where");
    const orderIndex = sql.indexOf("order by");
    const limitIndex = sql.indexOf("limit");

    expect(sql).toContain("c.repository_id = any($2::text[])");
    expect(sql).toContain("exists (select 1 from knowledge_chunk_links l");
    expect(whereIndex).toBeLessThan(orderIndex);
    expect(orderIndex).toBeLessThan(limitIndex);
    // 不是「取回再过滤」：没有任何子查询把结果先捞出来
    expect(sql).not.toContain("select * from (select");
  });

  it("空 scope → 直接返回空，不发 SQL（无权限是授权结果，不是故障）", async () => {
    const fake = fakeSql();
    const hits = await pgvectorIndex({ sql: fake.sql }).search(
      query({ scope: { repositoryIds: [] } }),
    );

    expect(hits).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it("不指定 commit → 不加 link 条件（按仓库全量召回）", async () => {
    const fake = fakeSql([[]]);
    await pgvectorIndex({ sql: fake.sql }).search(query({ scope: { repositoryIds: ["repo-1"] } }));

    expect(fake.at(0)?.sql).not.toContain("knowledge_chunk_links");
  });

  it("minScore → 成为查询内的相似度条件（不是后置过滤）", async () => {
    const fake = fakeSql([[]]);
    await pgvectorIndex({ sql: fake.sql }).search(query({ minScore: 0.45 }));

    const sql = fake.at(0)?.sql ?? "";
    expect(sql).toContain("1 - (c.embedding <=> $1::vector) >= $5");
    expect(fake.at(0)?.params?.[4]).toBe(0.45);
  });

  it("filters 也进 SQL：methods / tags / pathPrefix", async () => {
    const fake = fakeSql([[]]);
    await pgvectorIndex({ sql: fake.sql }).search(
      query({ filters: { methods: ["POST"], tags: ["订单"], pathPrefix: "/orders" } }),
    );

    const sql = fake.at(0)?.sql ?? "";
    expect(sql).toContain(`c.metadata->>'method' = any($`);
    expect(sql).toContain(`c.metadata->'tags' ?| $`);
    expect(sql).toContain(`c.metadata->>'path' like $`);
    expect(fake.at(0)?.params).toContain("/orders%");
  });

  it("只召回当前 embedding 模型的行（P0-2：不匹配的行视为待重索引）", async () => {
    const fake = fakeSql([[]]);
    await pgvectorIndex({ sql: fake.sql }).search(query());

    expect(fake.at(0)?.sql).toContain("c.embedding_model = $3");
    expect(fake.at(0)?.params?.[2]).toBe("qwen:text-embedding-v4");
  });

  it("把行映射成 DenseHit：分数转 number、fields 从 metadata 还原", async () => {
    const fake = fakeSql([
      [
        {
          chunkKey: "endpoint:POST:/orders",
          repositoryId: "repo-1",
          level: "endpoint",
          lang: "zh",
          text: "正文",
          metadata: { method: "POST", path: "/orders", tags: ["订单"], operationId: "x" },
          score: "0.87",
        },
      ],
    ]);

    const hits = await pgvectorIndex({ sql: fake.sql }).search(query());

    expect(hits[0]).toMatchObject({
      chunkKey: "endpoint:POST:/orders",
      score: 0.87,
      fields: { method: "POST", path: "/orders", tags: ["订单"] },
    });
  });

  it("查询向量维度不符 → 报错（不查库）", async () => {
    const fake = fakeSql();

    await expect(
      pgvectorIndex({ sql: fake.sql }).search(
        query({ scope: { repositoryIds: ["repo-1"] }, vector: [1, 2, 3] }),
      ),
    ).rejects.toThrow(/query vector has 3 dimensions/);
    expect(fake.calls).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────
// unlink / GC / drop / size
// ───────────────────────────────────────────────────────────────────

describe("pgvectorIndex — 解除引用与 GC", () => {
  it("unlink 先删 link，再 GC 无引用的 chunk，返回被删的行数", async () => {
    const fake = fakeSql([[], [{ n: 3 }]]);
    const removed = await pgvectorIndex({ sql: fake.sql }).unlink({
      repositoryId: "repo-1",
      commitId: "commit-1",
    });

    expect(fake.at(0)?.sql).toContain("delete from knowledge_chunk_links l");
    // GC 必须带 NOT EXISTS 防误删（P0-4：仍被别的 commit 引用的行不能删）
    expect(fake.at(1)?.sql).toContain("not exists (select 1 from knowledge_chunk_links");
    expect(removed).toBe(3);
  });

  it("unlink 指定 chunkKeys → 收窄到这些 key（部分重索引用）", async () => {
    const fake = fakeSql([[], [{ n: 1 }]]);
    await pgvectorIndex({ sql: fake.sql }).unlink({
      repositoryId: "repo-1",
      commitId: "commit-1",
      chunkKeys: ["endpoint:POST:/a"],
    });

    // link 语句与 GC 语句的参数编号各自独立 —— 参数数组不能共用（真库实测：共用会
    // 报「bind message supplies 2 parameters, but prepared statement requires 1」）。
    expect(fake.at(0)?.sql).toContain("c.chunk_key = any($3::text[])");
    expect(fake.at(0)?.params).toEqual(["repo-1", "commit-1", ["endpoint:POST:/a"]]);
    expect(fake.at(1)?.sql).toContain("c.chunk_key = any($2::text[])");
    expect(fake.at(1)?.params).toEqual(["repo-1", ["endpoint:POST:/a"]]);
  });

  it("dropRepository 先删 link 再删 chunk", async () => {
    const fake = fakeSql([[], [{ n: 7 }]]);
    const removed = await pgvectorIndex({ sql: fake.sql }).dropRepository("repo-1");

    expect(fake.at(0)?.sql).toContain("delete from knowledge_chunk_links l");
    expect(fake.at(1)?.sql).toContain("delete from knowledge_chunks where repository_id = $1");
    expect(removed).toBe(7);
  });

  it("size 返回 chunk 行数", async () => {
    const fake = fakeSql([[{ n: 42 }]]);

    expect(await pgvectorIndex({ sql: fake.sql }).size()).toBe(42);
  });
});

describe("pgvectorIndexProvider", () => {
  it("从 deps.sql 取句柄", () => {
    const fake = fakeSql();

    expect(pgvectorIndexProvider({ options: {}, deps: { sql: fake.sql } })).toBeDefined();
  });

  it("deps 里没有 SqlExecutor → 启动期可读错误", () => {
    expect(() => pgvectorIndexProvider({ options: {}, deps: {} })).toThrow(RagConfigError);
    expect(() => pgvectorIndexProvider({ options: {}, deps: {} })).toThrow(/deps\.sql/);
  });
});
