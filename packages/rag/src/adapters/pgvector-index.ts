// ═══════════════════════════════════════════════════════════════════
// RAG Adapter — pgvector 稠密索引（P4-4）
// ═══════════════════════════════════════════════════════════════════
//
// `DenseIndex` 的生产实现：写 `knowledge_chunks` + `knowledge_chunk_links`，读走
// HNSW 余弦索引。三条不能破的约束（每条都对应一个已经踩过的坑）：
//
// 1. **过滤写在 SQL 里、在 ORDER BY / LIMIT 之前**（P0-4 的两条权限不变量）。
//    权限打 **chunk**（`repository_id = any($accessible)`）、版本打 **link**
//    （`exists (select 1 from knowledge_chunk_links …)`），两层 AND。取回后再过滤
//    会让越权行、非活跃版本挤占 `LIMIT` 配额，用户拿到的结果条数还会莫名变少。
// 2. **内容寻址**：`(repository_id, chunk_key, content_hash)` 唯一。同 key 同内容
//    命中同一行（原地更新向量），同 key 不同内容是多行 —— 于是「回滚到旧 commit」
//    不需要重索引，只改 link。`content_hash` 由正文算（sha256）。
// 3. **拿不准就抛错**：维度不符、向量缺失、id 拼不出来，一律在写入前拒绝。索引里
//    混进别的维度或错位的向量，检索看起来正常但结果全错，是最贵的 bug。
//
// 索引与算子已在迁移里定死（`vector(1024)` + HNSW + `vector_cosine_ops`），
// 所以这里用 `<=>`（余弦距离）排序、`1 - (<=>)` 作为相似度分。
// ═══════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import {
  RagConfigError,
  RagDependencyError,
  type DenseChunkRecord,
  type DenseHit,
  type DenseIndex,
  type DenseQuery,
  type DenseUnlinkSelector,
  type RagDocumentFields,
  type SqlExecutor,
} from "../contracts";
import type { RagDenseIndexFactory } from "../pipeline/types";

/** P0-2：列类型是 `vector(1024)`，写入前必须逐条校验。 */
export const PGVECTOR_DIMENSIONS = 1024;

export interface PgvectorIndexOptions {
  sql: SqlExecutor;
  /** 维度；默认 1024（P0-2）。仅测试或换模型时需要覆盖。 */
  dimensions?: number;
}

export function pgvectorIndex(options: PgvectorIndexOptions): DenseIndex {
  const { sql } = options;
  const dimensions = options.dimensions ?? PGVECTOR_DIMENSIONS;
  /** org 快照列的回落查询：同一仓库在一次进程生命周期内不会变 */
  const organizationByRepository = new Map<string, string>();

  async function organizationIdOf(repositoryId: string, provided?: string): Promise<string> {
    if (provided) return provided;
    const cached = organizationByRepository.get(repositoryId);
    if (cached) return cached;

    const [row] = await sql.query<{ organizationId: string }>(
      `select r.organization_id as "organizationId" from repositories r where r.id = $1`,
      [repositoryId],
    );
    if (!row?.organizationId) {
      throw new RagDependencyError(
        `pgvector: cannot resolve organization_id for repository ${repositoryId} ` +
          "(the chunk row requires the org snapshot column; pass organizationId on the record).",
      );
    }
    organizationByRepository.set(repositoryId, row.organizationId);
    return row.organizationId;
  }

  return {
    async upsert(records: DenseChunkRecord[]): Promise<void> {
      for (const record of records) {
        assertRecord(record, dimensions);

        const contentHash = contentHashOf(record.text);
        const id = chunkRowId(record.repositoryId, record.chunkKey, contentHash);
        const organizationId = await organizationIdOf(record.repositoryId, record.organizationId);

        // 内容寻址：冲突目标就是那条唯一索引 `(repository_id, chunk_key, content_hash)`。
        // 冲突时刷新向量与元数据 —— 同一份内容被重新索引（换模型、强制重算）走这里。
        await sql.query(
          `insert into knowledge_chunks
             (id, organization_id, repository_id, chunk_key, level, lang, content, content_hash,
              metadata, embedding, embedding_model, embedding_dim, embedding_updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::vector, $11, $12, now())
           on conflict (repository_id, chunk_key, content_hash) do update set
             content = excluded.content,
             level = excluded.level,
             lang = excluded.lang,
             metadata = excluded.metadata,
             embedding = excluded.embedding,
             embedding_model = excluded.embedding_model,
             embedding_dim = excluded.embedding_dim,
             embedding_updated_at = now(),
             updated_at = now()
           returning id`,
          [
            id,
            organizationId,
            record.repositoryId,
            record.chunkKey,
            record.level,
            record.lang,
            record.text,
            contentHash,
            JSON.stringify(storedMetadata(record)),
            vectorLiteral(record.vector),
            record.embeddingModel,
            record.vector.length,
          ],
        );

        for (const commitId of record.commitIds) {
          await sql.query(
            `insert into knowledge_chunk_links (commit_id, chunk_id)
             select $1, c.id from knowledge_chunks c
             where c.repository_id = $2 and c.chunk_key = $3 and c.content_hash = $4
             on conflict do nothing`,
            [commitId, record.repositoryId, record.chunkKey, contentHash],
          );
        }
      }
    },

    async search(query: DenseQuery): Promise<DenseHit[]> {
      if (query.vector.length !== dimensions) {
        throw new RagDependencyError(
          `pgvector: query vector has ${query.vector.length} dimensions, expected ${dimensions}`,
        );
      }
      // 空 scope = 无权限。不去查库（那是「授权结果」而不是故障，P0-4）。
      if (query.scope.repositoryIds.length === 0) return [];

      const params: unknown[] = [
        vectorLiteral(query.vector),
        query.scope.repositoryIds,
        query.embeddingModel,
      ];
      const conditions = [
        `c.repository_id = any($2::text[])`,
        `c.embedding_model = $3`,
        `c.embedding is not null`,
      ];

      // 版本收窄：只在 scope 指定 commit 时加。`exists` 而不是 JOIN —— 一个 chunk
      // 可能被多个 commit 引用，JOIN 会产生重复行、白白吃掉 LIMIT 配额。
      if (query.scope.commitIds && query.scope.commitIds.length > 0) {
        params.push(query.scope.commitIds);
        conditions.push(
          `exists (select 1 from knowledge_chunk_links l
                   where l.chunk_id = c.id and l.commit_id = any($${params.length}::text[]))`,
        );
      }

      if (query.scope.organizationId) {
        params.push(query.scope.organizationId);
        conditions.push(`c.organization_id = $${params.length}`);
      }

      // 相似度阈值（`rag.retrieval.minScore`）：**查询内条件**，不是后置过滤。
      // 先 LIMIT 再过滤会变成「明明有候选却返回 0 条」。
      if (query.minScore !== undefined) {
        params.push(query.minScore);
        conditions.push(`1 - (c.embedding <=> $1::vector) >= $${params.length}`);
      }

      if (query.filters?.methods && query.filters.methods.length > 0) {
        params.push(query.filters.methods);
        conditions.push(`c.metadata->>'method' = any($${params.length}::text[])`);
      }
      if (query.filters?.tags && query.filters.tags.length > 0) {
        params.push(query.filters.tags);
        conditions.push(`c.metadata->'tags' ?| $${params.length}::text[]`);
      }
      if (query.filters?.pathPrefix) {
        params.push(`${query.filters.pathPrefix}%`);
        conditions.push(`c.metadata->>'path' like $${params.length}`);
      }

      params.push(query.limit);

      const rows = await sql.query<{
        chunkKey: string;
        repositoryId: string;
        level: DenseHit["level"];
        lang: DenseHit["lang"];
        text: string;
        metadata: Record<string, unknown> | null;
        score: number | string;
      }>(
        `select c.chunk_key as "chunkKey",
                c.repository_id as "repositoryId",
                c.level,
                c.lang,
                c.content as text,
                c.metadata,
                1 - (c.embedding <=> $1::vector) as score
         from knowledge_chunks c
         where ${conditions.join("\n           and ")}
         order by c.embedding <=> $1::vector
         limit $${params.length}`,
        params,
      );

      return rows.map((row) => ({
        chunkKey: row.chunkKey,
        repositoryId: row.repositoryId,
        level: row.level,
        lang: row.lang,
        text: row.text,
        fields: fieldsOf(row.metadata),
        metadata: row.metadata ?? undefined,
        // pg 会把 real 列以字符串返回（precision 保护）：统一转成 number，避免
        // 「分数是字符串」这种只在排序时才发现的问题。
        score: Number(row.score),
      }));
    },

    async unlink(selector: DenseUnlinkSelector): Promise<number> {
      // 两条语句各自编号：link 语句用 ($1 repo, $2 commit[, $3 keys])，GC 语句用
      // ($1 repo[, $2 keys]) —— 参数数组不能共用（占位符数量对不上，PG 直接报
      // 「bind message supplies N parameters…」）。
      const linkParams: unknown[] = [selector.repositoryId, selector.commitId];
      const gcParams: unknown[] = [selector.repositoryId];
      let linkChunkFilter = "";
      let gcChunkFilter = "";
      if (selector.chunkKeys && selector.chunkKeys.length > 0) {
        linkParams.push(selector.chunkKeys);
        gcParams.push(selector.chunkKeys);
        linkChunkFilter = ` and c.chunk_key = any($3::text[])`;
        gcChunkFilter = ` and c.chunk_key = any($2::text[])`;
      }

      await sql.query(
        `delete from knowledge_chunk_links l
         using knowledge_chunks c
         where l.chunk_id = c.id
           and c.repository_id = $1
           and l.commit_id = $2${linkChunkFilter}`,
        linkParams,
      );

      // GC：只有当没有任何 commit 再引用时才删 chunk 行（P0-4 的防误删规则）。
      const removed = await sql.query<{ n: number }>(
        `with gone as (
           delete from knowledge_chunks c
           where c.repository_id = $1${gcChunkFilter}
             and not exists (select 1 from knowledge_chunk_links l where l.chunk_id = c.id)
           returning 1
         )
         select count(*)::int as n from gone`,
        gcParams,
      );

      return removed[0]?.n ?? 0;
    },

    async dropRepository(repositoryId: string): Promise<number> {
      await sql.query(
        `delete from knowledge_chunk_links l
         using knowledge_chunks c
         where l.chunk_id = c.id and c.repository_id = $1`,
        [repositoryId],
      );

      const removed = await sql.query<{ n: number }>(
        `with gone as (
           delete from knowledge_chunks where repository_id = $1 returning 1
         )
         select count(*)::int as n from gone`,
        [repositoryId],
      );

      return removed[0]?.n ?? 0;
    },

    async size(): Promise<number> {
      const [row] = await sql.query<{ n: number }>(
        `select count(*)::int as n from knowledge_chunks`,
      );
      return row?.n ?? 0;
    },
  };
}

/**
 * `DenseIndexFactory` 形态的包装：注册表按名字注册它。
 *
 * 这里的 `deps.sql` 与 document source 共用同一个端口实例（同一个连接池）。
 */
export const pgvectorIndexProvider: RagDenseIndexFactory = (ctx) => {
  const sql = ctx.deps.sql;
  if (sql === null || typeof sql !== "object" || typeof (sql as SqlExecutor).query !== "function") {
    throw new RagConfigError(
      'rag: provider "pgvector" needs a SqlExecutor in deps.sql ' +
        "(an object with a query(sql, params) method); see docs/modules/rag-package.md §2.3.",
    );
  }
  return pgvectorIndex({ sql: sql as SqlExecutor });
};

// ───────────────────────────────────────────────────────────────────
// 内部
// ───────────────────────────────────────────────────────────────────

function assertRecord(record: DenseChunkRecord, dimensions: number): void {
  if (record.vector.length !== dimensions) {
    throw new RagDependencyError(
      `pgvector: refusing to write chunk "${record.chunkKey}" with a ` +
        `${record.vector.length}-dimensional vector (expected ${dimensions})`,
    );
  }
  if (!record.embeddingModel) {
    throw new RagDependencyError(
      `pgvector: chunk "${record.chunkKey}" has no embedding_model — without it the row ` +
        "cannot be filtered by the active model (P0-2).",
    );
  }
  if (record.text.length === 0) {
    throw new RagDependencyError(`pgvector: chunk "${record.chunkKey}" has empty content`);
  }
}

/** 正文的 sha256 —— 内容寻址里的「同内容」判定。 */
function contentHashOf(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * 行主键。确定性 id 让 upsert 幂等，也让排障时能直接从 (repo, key, hash) 反推 id。
 * 长度上限与 `text` 列无关（text 无上限），但保持紧凑便于日志阅读。
 */
function chunkRowId(repositoryId: string, chunkKey: string, contentHash: string): string {
  return createHash("sha256")
    .update(`${repositoryId}\u0000${chunkKey}\u0000${contentHash}`, "utf8")
    .digest("hex");
}

/**
 * 落库的 metadata：把稠密记录上的 `fields`（method / path / tags / summary）**摊平**到
 * 顶层，因为 `RetrievalFilters` 要在 SQL 里按它们过滤（`metadata->>'method'`）。
 * 表里没有 method / path 列，这是唯一能「过滤仍在 SQL 内」的存法。
 */
function storedMetadata(record: DenseChunkRecord): Record<string, unknown> {
  return { ...record.metadata, ...record.fields };
}

function fieldsOf(metadata: Record<string, unknown> | null): RagDocumentFields | undefined {
  if (!metadata) return undefined;
  const fields: RagDocumentFields = {};
  if (typeof metadata.method === "string") fields.method = metadata.method;
  if (typeof metadata.path === "string") fields.path = metadata.path;
  if (typeof metadata.summary === "string") fields.summary = metadata.summary;
  if (Array.isArray(metadata.tags)) {
    fields.tags = metadata.tags.filter((tag): tag is string => typeof tag === "string");
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/** pgvector 的字面量形式：`[0.1,0.2,…]`，配合 SQL 里的 `::vector` 转型。 */
function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}
