import { describe, it, expect } from "vitest";
import { RagDependencyError, type SqlExecutor, type Tokenizer } from "../contracts";
import { cjkBigramTokenizer } from "../stages/bigram-tokenizer";
import { jiebaTokenizer } from "../stages/jieba-tokenizer";
import { pgFtsIndex, pgFtsIndexProvider, PGFTS_QUERY_TERM_LIMIT } from "./pg-fts-index";
import { pgvectorIndex } from "./pgvector-index";
import { PGVECTOR_DIMENSIONS } from "./pgvector-index";
import type { SparseChunkRecord, DenseChunkRecord } from "../contracts";

// ───────────────────────────────────────────────────────────────────
// 记录调用的假执行器（与 pgvector-index.test.ts 同一形态）
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

function record(overrides: Partial<SparseChunkRecord> = {}): SparseChunkRecord {
  return {
    chunkKey: "endpoint:POST:/orders/{id}/refund",
    repositoryId: "repo-1",
    organizationId: "org-1",
    commitIds: ["commit-1"],
    level: "endpoint",
    lang: "zh",
    text: "退款接口：对已支付订单发起退款",
    fields: { method: "POST", path: "/orders/{id}/refund" },
    metadata: { operationId: "refundOrder" },
    ...overrides,
  };
}

const query = (overrides: Partial<Parameters<ReturnType<typeof pgFtsIndex>["search"]>[0]> = {}) => {
  const tokenizer = jiebaTokenizer();
  return {
    query: "退款",
    scope: { repositoryIds: ["repo-1"], commitIds: ["commit-1"] },
    limit: 10,
    tokenizerVersion: tokenizer.version,
    ...overrides,
  };
};

// ───────────────────────────────────────────────────────────────────
// 写入
// ───────────────────────────────────────────────────────────────────

describe("pgFtsIndex — 写入（切词列 + 内容寻址）", () => {
  it("写 search_text / search_identifiers / tokenizer_version 三列", async () => {
    const fake = fakeSql();
    const tokenizer = jiebaTokenizer();
    await pgFtsIndex({ sql: fake.sql, tokenizer, provider: "pg-fts-jieba" }).upsert([record()]);

    const insert = fake.at(0);
    expect(insert?.sql).toContain("insert into knowledge_chunks");
    expect(insert?.sql).toContain("on conflict (repository_id, chunk_key, content_hash) do update");

    const searchText = String(insert?.params?.[9]);
    const identifiers = String(insert?.params?.[10]);
    // jieba 的 cutForSearch 会把「退款」作为独立词元输出（默认 cut 不一定）。
    expect(searchText.split(" ")).toContain("退款");
    // 标识符来自结构化字段，且经归一化（`/orders/{id}/refund` → 三个词）。
    expect(identifiers.split(" ")).toEqual(["post", "orders", "id", "refund", "refundorder"]);
    expect(insert?.params?.[11]).toBe(tokenizer.version);
  });

  it("没有标识符字段时写空串而不是 NULL（约束要求「同写同空」）", async () => {
    const fake = fakeSql();
    await pgFtsIndex({ sql: fake.sql, tokenizer: cjkBigramTokenizer() }).upsert([
      record({ fields: undefined, metadata: undefined }),
    ]);

    expect(fake.at(0)?.params?.[10]).toBe("");
  });

  it("绝不碰 embedding 列 —— 稠密/稀疏两侧写入顺序无关", async () => {
    const fake = fakeSql();
    await pgFtsIndex({ sql: fake.sql, tokenizer: jiebaTokenizer() }).upsert([record()]);

    expect(fake.at(0)?.sql ?? "").not.toContain("embedding");
  });

  it("每个 commit 一条 link（与稠密侧共用同一段 SQL）", async () => {
    const fake = fakeSql();
    await pgFtsIndex({ sql: fake.sql, tokenizer: jiebaTokenizer() }).upsert([
      record({ commitIds: ["c1", "c2"] }),
    ]);

    const linkCalls = fake.calls.filter((call) =>
      call.sql.includes("insert into knowledge_chunk_links"),
    );
    expect(linkCalls).toHaveLength(2);
    expect(linkCalls.map((call) => call.params?.[0])).toEqual(["c1", "c2"]);
  });

  it("空正文拒绝写入（空 chunk 进索引会污染召回且看不出来）", async () => {
    const fake = fakeSql();
    await expect(
      pgFtsIndex({ sql: fake.sql, tokenizer: jiebaTokenizer() }).upsert([record({ text: "" })]),
    ).rejects.toBeInstanceOf(RagDependencyError);
  });

  it("与稠密侧算出同一行 id / content_hash（否则同一 chunk 会变成两行）", async () => {
    const sparse = fakeSql();
    const dense = fakeSql();

    await pgFtsIndex({ sql: sparse.sql, tokenizer: jiebaTokenizer() }).upsert([record()]);
    await pgvectorIndex({ sql: dense.sql }).upsert([
      {
        ...(record() as unknown as DenseChunkRecord),
        vector: new Array<number>(PGVECTOR_DIMENSIONS).fill(0.1),
        embeddingModel: "test:hash",
      },
    ]);

    expect(sparse.at(0)?.params?.[0]).toBe(dense.at(0)?.params?.[0]); // id
    expect(sparse.at(0)?.params?.[7]).toBe(dense.at(0)?.params?.[7]); // content_hash
    expect(sparse.at(0)?.params?.[8]).toBe(dense.at(0)?.params?.[8]); // metadata
  });

  it("缺 organizationId 时回表读一次并缓存（同一仓库不重复查）", async () => {
    const fake = fakeSql([
      [{ organizationId: "org-lookup" }],
      [], // chunk insert
      [], // link
      [], // 第二次 insert（缓存后不再查 org）
      [], // link
    ]);
    const index = pgFtsIndex({ sql: fake.sql, tokenizer: cjkBigramTokenizer() });

    await index.upsert([record({ organizationId: undefined, commitIds: [] })]);
    await index.upsert([record({ organizationId: undefined, commitIds: [] })]);

    expect(fake.calls.filter((call) => call.sql.includes("from repositories"))).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────
// 查询
// ───────────────────────────────────────────────────────────────────

describe("pgFtsIndex — 查询（OR tsquery + 过滤在 LIMIT 之前）", () => {
  it("词元去重后以 OR 连接（AND 会几乎必然空召回）", async () => {
    const fake = fakeSql([[]]);
    await pgFtsIndex({ sql: fake.sql, tokenizer: jiebaTokenizer() }).search(
      query({ query: "退款 退款 订单" }),
    );

    const tsquery = String(fake.at(0)?.params?.[0]);
    expect(tsquery).not.toContain("| |");
    const terms = tsquery.split(" | ");
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms).toContain("退款");
    expect(terms).toContain("订单");
  });

  it("拼进 SQL 的是参数化的 to_tsquery + ts_rank，绝不把查询串拼进 SQL", async () => {
    const fake = fakeSql([[]]);
    const text = "退款' or 1=1 --";
    await pgFtsIndex({ sql: fake.sql, tokenizer: jiebaTokenizer() }).search(query({ query: text }));

    const sql = fake.at(0)?.sql ?? "";
    expect(sql).toContain("to_tsquery('simple'::regconfig, $1)");
    expect(sql).toContain("ts_rank(c.search_vector, q.tsq)");
    expect(sql).not.toContain("or 1=1");
    // 引号 / 横线都不是词元字符，已被白名单丢掉。
    expect(String(fake.at(0)?.params?.[0])).not.toContain("'");
    expect(String(fake.at(0)?.params?.[0])).not.toContain("-");
  });

  it("分词器版本 = 查询内置版本（不一致的行视为待重索引，不参与召回）", async () => {
    const fake = fakeSql([[]]);
    const tokenizer = cjkBigramTokenizer();
    await pgFtsIndex({ sql: fake.sql, tokenizer }).search(
      query({ tokenizerVersion: tokenizer.version }),
    );

    const sql = fake.at(0)?.sql ?? "";
    expect(sql).toContain("c.tokenizer_version = $3");
    expect(fake.at(0)?.params?.[2]).toBe(tokenizer.version);
  });

  it("权限打 chunk、版本打 link，两层 AND 且都在 LIMIT 之前", async () => {
    const fake = fakeSql([[]]);
    await pgFtsIndex({ sql: fake.sql, tokenizer: jiebaTokenizer() }).search(query());

    const sql = fake.at(0)?.sql ?? "";
    expect(sql).toContain("c.repository_id = any($2::text[])");
    expect(sql).toContain("from knowledge_chunk_links l");
    expect(sql.indexOf("limit $")).toBeGreaterThan(sql.indexOf("knowledge_chunk_links"));
    expect(fake.at(0)?.params?.[3]).toEqual(["commit-1"]);
    expect(fake.at(0)?.params?.[4]).toBe(10); // limit 是最后一个参数
  });

  it("组织与结构化筛选同样进 SQL", async () => {
    const fake = fakeSql([[]]);
    await pgFtsIndex({ sql: fake.sql, tokenizer: jiebaTokenizer() }).search(
      query({
        scope: { repositoryIds: ["repo-1"], organizationId: "org-1" },
        filters: { methods: ["POST"], tags: ["订单"], pathPrefix: "/orders" },
      }),
    );

    const sql = fake.at(0)?.sql ?? "";
    expect(sql).toContain("c.organization_id = $4");
    expect(sql).toContain(`c.metadata->>'method' = any($5::text[])`);
    expect(sql).toContain(`c.metadata->'tags' ?| $6::text[]`);
    expect(sql).toContain(`c.metadata->>'path' like $7`);
  });

  it("空 scope = 无权限：直接返回空，不查库", async () => {
    const fake = fakeSql();
    const hits = await pgFtsIndex({ sql: fake.sql, tokenizer: jiebaTokenizer() }).search(
      query({ scope: { repositoryIds: [] } }),
    );

    expect(hits).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it("纯标点查询没有可拼的 tsquery：返回空而不是让 to_tsquery 报语法错", async () => {
    const fake = fakeSql();
    const hits = await pgFtsIndex({ sql: fake.sql, tokenizer: jiebaTokenizer() }).search(
      query({ query: "?!...（）" }),
    );

    expect(hits).toEqual([]);
    expect(fake.calls).toHaveLength(0);
  });

  it("词元数量有上限（超长查询不该把 tsquery 撑爆）", async () => {
    const fake = fakeSql([[]]);
    const spam: Tokenizer = {
      version: "spam@v1",
      tokenize: () => Array.from({ length: 200 }, (_, i) => `w${i}`),
      normalizeIdentifiers: () => [],
    };

    await pgFtsIndex({ sql: fake.sql, tokenizer: spam }).search(query());

    const terms = String(fake.at(0)?.params?.[0]).split(" | ");
    expect(terms).toHaveLength(PGFTS_QUERY_TERM_LIMIT);
  });

  it("命中行映射成契约（分数从字符串转 number，fields 从 metadata 还原）", async () => {
    const fake = fakeSql([
      [
        {
          chunkKey: "endpoint:POST:/orders/{id}/refund",
          repositoryId: "repo-1",
          level: "endpoint",
          lang: "zh",
          text: "退款接口",
          metadata: { method: "POST", path: "/orders/{id}/refund" },
          score: "0.42",
        },
      ],
    ]);

    const hits = await pgFtsIndex({ sql: fake.sql, tokenizer: jiebaTokenizer() }).search(query());

    expect(hits).toHaveLength(1);
    expect(hits[0]?.score).toBe(0.42);
    expect(hits[0]?.fields).toEqual({ method: "POST", path: "/orders/{id}/refund" });
  });
});

// ───────────────────────────────────────────────────────────────────
// 注册表工厂
// ───────────────────────────────────────────────────────────────────

describe("pgFtsIndexProvider", () => {
  it("deps.sql 形状不对时 fail-fast（错误信息含 provider 名与修法）", () => {
    expect(() => pgFtsIndexProvider("pg-fts-jieba")({ options: {}, deps: {} })).toThrow(
      /pg-fts-jieba/,
    );
  });

  it("构造出的适配器用的就是该 provider 的切词口径", async () => {
    const fake = fakeSql([[]]);
    const index = pgFtsIndexProvider("pg-fts-bigram")({ options: {}, deps: { sql: fake.sql } });

    await index.search(query({ query: "订单", tokenizerVersion: cjkBigramTokenizer().version }));

    expect(fake.at(0)?.params?.[2]).toBe(cjkBigramTokenizer().version);
  });
});
