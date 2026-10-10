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

import {
  RagConfigError,
  RagDependencyError,
  type DenseChunkRecord,
  type DenseChunkIdentity,
  type DenseChunkLink,
  type DenseHit,
  type DenseIndex,
  type DenseIdentityScope,
  type DenseQuery,
  type DenseUnlinkSelector,
  type SqlExecutor,
} from "../contracts";
import { contentHashOf } from "../content-hash";
import type { RagDenseIndexFactory } from "../pipeline/types";
import {
  chunkRowId,
  createOrganizationResolver,
  ensureChunkLinks,
  fieldsOf,
  storedMetadata,
  vectorLiteral,
} from "./chunk-row";

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
  const organizationIdOf = createOrganizationResolver(sql, "pgvector");

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

        await ensureChunkLinks(sql, {
          repositoryId: record.repositoryId,
          chunkKey: record.chunkKey,
          contentHash,
          commitIds: record.commitIds,
        });
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
      // 精确到「内容」而不是「key」：同一个 key 允许有多行（内容改过就是另一行），
      // 按 key 解绑会把同一逻辑单元的新旧内容一起摘掉 —— 「改了摘要」这种最常见的
      // 更新会退化成「这个接口查不到了」。
      //
      // 行 id 由内容寻址三元组确定性推出（`chunkRowId`），所以这里不需要 join
      // knowledge_chunks 就能精确删 link；GC 再按 id 找回那些「没有任何引用」的行。
      const chunkIds =
        selector.chunks && selector.chunks.length > 0
          ? selector.chunks.map((chunk) =>
              chunkRowId(selector.repositoryId, chunk.chunkKey, chunk.contentHash),
            )
          : undefined;

      if (chunkIds) {
        await sql.query(
          `delete from knowledge_chunk_links
           where commit_id = $1 and chunk_id = any($2::text[])`,
          [selector.commitId, chunkIds],
        );
      } else {
        await sql.query(
          `delete from knowledge_chunk_links l
           using knowledge_chunks c
           where l.chunk_id = c.id and c.repository_id = $1 and l.commit_id = $2`,
          [selector.repositoryId, selector.commitId],
        );
      }

      // GC：只有当没有任何 commit 再引用时才删 chunk 行（P0-4 的防误删规则）。
      // 注意返回的是**物理删除的行数**；没有其他 commit 引用时才非零 —— 调用方
      // 若要「本次解绑了多少条内容」，应当用自己算出的差集大小。
      const gcSql = chunkIds
        ? `with gone as (
             delete from knowledge_chunks c
             where c.id = any($1::text[])
               and not exists (select 1 from knowledge_chunk_links l where l.chunk_id = c.id)
             returning 1
           )
           select count(*)::int as n from gone`
        : `with gone as (
             delete from knowledge_chunks c
             where c.repository_id = $1
               and not exists (select 1 from knowledge_chunk_links l where l.chunk_id = c.id)
             returning 1
           )
           select count(*)::int as n from gone`;
      const gcParams: unknown[] = chunkIds ? [chunkIds] : [selector.repositoryId];

      const removed = await sql.query<{ n: number }>(gcSql, gcParams);
      return removed[0]?.n ?? 0;
    },

    async listIdentities(scope: DenseIdentityScope): Promise<DenseChunkIdentity[]> {
      const params: unknown[] = [scope.repositoryId];
      const conditions = [`c.repository_id = $1`];

      if (scope.chunkKeys && scope.chunkKeys.length > 0) {
        params.push(scope.chunkKeys);
        conditions.push(`c.chunk_key = any($${params.length}::text[])`);
      }
      if (scope.commitId) {
        params.push(scope.commitId);
        conditions.push(
          `exists (select 1 from knowledge_chunk_links l
                   where l.chunk_id = c.id and l.commit_id = $${params.length})`,
        );
      }

      const rows = await sql.query<{
        chunkKey: string;
        contentHash: string;
        embeddingModel: string | null;
        commitIds: string[];
      }>(
        `select c.chunk_key as "chunkKey",
                c.content_hash as "contentHash",
                c.embedding_model as "embeddingModel",
                coalesce(array_agg(l.commit_id) filter (where l.commit_id is not null), '{}'::text[])
                  as "commitIds"
         from knowledge_chunks c
         left join knowledge_chunk_links l on l.chunk_id = c.id
         where ${conditions.join("\n           and ")}
         group by c.id`,
        params,
      );

      return rows.map((row) => ({
        chunkKey: row.chunkKey,
        contentHash: row.contentHash,
        ...(row.embeddingModel ? { embeddingModel: row.embeddingModel } : {}),
        commitIds: row.commitIds ?? [],
      }));
    },

    async link(links: readonly DenseChunkLink[]): Promise<number> {
      let created = 0;

      for (const link of links) {
        // `matched` 与 `linked` 必须分开：只回 `linked` 时「行不存在」与「link 已存在」
        // 都是 0 行，无法区分 —— 前者是 bug（以为复用了、其实没挂上，检索会静默少
        // 结果），后者是正常的重试。要求目标行**已有向量**：给一行没有向量的内容挂
        // link，等于挂上一条永远召回不到的内容。
        const rows = await sql.query<{ matched: number; linked: number }>(
          `with target as (
             select c.id from knowledge_chunks c
             where c.repository_id = $2 and c.chunk_key = $3 and c.content_hash = $4
               and c.embedding is not null
           ), inserted as (
             insert into knowledge_chunk_links (commit_id, chunk_id)
             select $1, t.id from target t
             on conflict do nothing
             returning 1
           )
           select (select count(*)::int from target) as "matched",
                  (select count(*)::int from inserted) as "linked"`,
          [link.commitId, link.repositoryId, link.chunkKey, link.contentHash],
        );

        const row = rows[0];
        if (!row || row.matched === 0) {
          throw new RagDependencyError(
            `pgvector: cannot link commit ${link.commitId} to chunk ` +
              `"${link.chunkKey}" (${link.contentHash.slice(0, 12)}…): no row with a vector ` +
              "matches that content. Reuse must be decided from listIdentities; " +
              "a missing row means the vector has to be computed.",
          );
        }
        created += row.linked;
      }

      return created;
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
