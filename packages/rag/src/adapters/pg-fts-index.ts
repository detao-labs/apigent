// ═══════════════════════════════════════════════════════════════════
// RAG Adapter — pg-fts 稀疏索引（P4-5，P0-3 定案的三个内置 provider）
// ═══════════════════════════════════════════════════════════════════
//
// `SparseIndex` 的生产实现：写 `knowledge_chunks.search_text` /
// `search_identifiers`，读走 `search_vector`（生成列）+ GIN 索引。三个 provider
// （`pg-fts-jieba` / `pg-fts-bigram` / `pg-fts-simple`）**共用本文件的一条读写
// 路径**，差别只在注入的 `Tokenizer` —— 「换切词方案」不该顺带换 SQL。
//
// 四条不能破的约束：
//
// 1. **索引侧与查询侧同一个分词器实例**（本适配器自己持有 `Tokenizer`）。
//    jieba 的默认 `cut` 与搜索模式 `cutForSearch` 在「发货」这类查询上命中率
//    是 0 与 11/11 的差别，而且**不报错**（P0-3 spike §4.3）。把分词关在适配器
//    内部，这条就从「纪律」变成结构保证 —— 调用方拿不到「写入用 A、查询用 B」。
// 2. **查询词元以 OR 连接**。稀疏路的定位是「宁可多召回、排序交给融合 / 精排」；
//    用 AND 只要有一个词元对不上就整条空召回（实测几乎必然发生）。
// 3. **拼 tsquery 前再过一次白名单**。切词实现已经滤过标点，但那是各自实现的
//    内部约定；`&` `|` `!` `:` `(` 一旦漏进来就不只是查不到，而是 `to_tsquery`
//    直接语法报错（整次检索 500）。白名单是 `[a-z0-9 CJK]`，与切词口径一致。
// 4. **版本收窄 + 权限过滤，全部在 `LIMIT` 之前**，与稠密侧逐条一致（P0-4）。
//    另外 `tokenizer_version` 也要过滤：口径变了以后旧行不参与召回（P0-3 的
//    「不一致 = 待重索引」），否则会得到「一部分命中、一部分静默丢失」的结果。
//
// 字段级权重（P4-5 方案 2，见迁移 0007）：
//   `search_vector = setweight(正文词元, 'C') || setweight(标识符词元, 'A')`
//   `ts_rank` 默认权重 A=1.0 / C=0.2，实测同一行的标识符命中分是正文命中的 5 倍
//   （DDL 预演：refund 0.608 vs 退款 0.122）。标识符取 `method` / `path` /
//   `identityKey` / `operationId` —— 摘要与正文（含 tags）留在 C 段。
// ═══════════════════════════════════════════════════════════════════

import {
  RagConfigError,
  RagDependencyError,
  type SqlExecutor,
  type SparseChunkRecord,
  type SparseHit,
  type SparseIndex,
  type SparseQuery,
  type Tokenizer,
} from "../contracts";
import type { RagStageFactoryContext } from "../pipeline/types";
import { tokenizerForSearchStore, type SparseTokenizerName } from "../stages";
import { contentHashOf } from "../content-hash";
import {
  chunkRowId,
  createOrganizationResolver,
  ensureChunkLinks,
  fieldsOf,
  storedMetadata,
} from "./chunk-row";

/** 内置稀疏 provider 的取值（= `rag.searchStore.provider` 的三个 FTS 值） */
export type PgFtsProviderName = SparseTokenizerName;

/** 单个查询最多保留的词元数：防止超长查询把 tsquery 撑到无法规划。 */
const MAX_QUERY_TERMS = 64;
/** 单个词元的最长字符数：CJK 长串 / 粘贴的 base64 不该整段进 tsquery。 */
const MAX_TERM_LENGTH = 64;
/** 与 Tokenizer 的口径一致：只允许 ASCII 字母数字与 CJK 表意文字。 */
const SAFE_TERM = /^[a-z0-9\u3400-\u4dbf\u4e00-\u9fff]+$/u;

export interface PgFtsIndexOptions {
  sql: SqlExecutor;
  /**
   * 切词器。**必填**：不提供默认值 —— 「默认用 jieba」会让
   * `searchStore.provider: pg-fts-bigram` 的部署用 jieba 切词、却写着 bigram 的
   * 版本串，索引元数据与实际口径不符，比缺配置更难查。
   */
  tokenizer: Tokenizer;
  /** 适配器名（错误信息 / 自检；一般就是 provider 值） */
  provider?: string;
}

export function pgFtsIndex(options: PgFtsIndexOptions): SparseIndex {
  const { sql, tokenizer } = options;
  const label = options.provider ?? "pg-fts";
  const organizationIdOf = createOrganizationResolver(sql, label);

  return {
    async upsert(records: SparseChunkRecord[]): Promise<void> {
      for (const record of records) {
        assertRecord(record, label);

        const contentHash = contentHashOf(record.text);
        const id = chunkRowId(record.repositoryId, record.chunkKey, contentHash);
        const organizationId = await organizationIdOf(record.repositoryId, record.organizationId);
        const searchText = tokenizer.tokenize(record.text).join(" ");
        const searchIdentifiers = identifierText(record, tokenizer);

        // 只写稀疏三列 + 业务列，**不碰 embedding\*** —— 稠密侧与稀疏侧可以任意
        // 顺序写同一行，后写的不会抹掉先写的（P4-4 的 upsert 同理不碰 search_text）。
        await sql.query(
          `insert into knowledge_chunks
             (id, organization_id, repository_id, chunk_key, level, lang, content, content_hash,
              metadata, search_text, search_identifiers, tokenizer_version)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
           on conflict (repository_id, chunk_key, content_hash) do update set
             content = excluded.content,
             level = excluded.level,
             lang = excluded.lang,
             metadata = excluded.metadata,
             search_text = excluded.search_text,
             search_identifiers = excluded.search_identifiers,
             tokenizer_version = excluded.tokenizer_version,
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
            searchText,
            searchIdentifiers,
            tokenizer.version,
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

    async search(query: SparseQuery): Promise<SparseHit[]> {
      // 空 scope = 无权限。不去查库（那是「授权结果」而不是故障，P0-4）。
      if (query.scope.repositoryIds.length === 0) return [];

      const terms = queryTerms(tokenizer.tokenize(query.query));
      // 全是标点 / 空白（或查询串为空）→ 没有 tsquery 可拼。返回空而不是抛错：
      // 这类查询对稠密路同样无意义，让它走「空召回」路径更诚实。
      if (terms.length === 0) return [];

      const params: unknown[] = [
        terms.join(" | "),
        query.scope.repositoryIds,
        query.tokenizerVersion,
      ];
      const conditions = [`c.repository_id = any($2::text[])`, `c.tokenizer_version = $3`];

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
        level: SparseHit["level"];
        lang: SparseHit["lang"];
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
                ts_rank(c.search_vector, q.tsq) as score
         from knowledge_chunks c
         cross join to_tsquery('simple'::regconfig, $1) as q(tsq)
         where c.search_vector @@ q.tsq
           and ${conditions.join("\n           and ")}
         order by score desc, c.chunk_key
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
        // ts_rank 返回 real → pg 以字符串返回（precision 保护），统一转 number。
        score: Number(row.score),
      }));
    },
  };
}

/**
 * 注册表工厂形态的包装：给一个 provider 值，返回「按名字注册」的工厂。分词器在
 * **构造期**就按 provider 定死，避免运行期再解析一次配置。
 *
 * 注册进 `RagStageRegistry` 的稀疏槽位是 P5-1 的事（本任务只交付契约与适配器）
 * —— 那里才会把 `RagStageKind` 扩到稀疏路，并把 dense + sparse 并行接起来。
 */
export function pgFtsIndexProvider(
  provider: PgFtsProviderName,
): (ctx: RagStageFactoryContext) => SparseIndex {
  return (ctx) => {
    const sql = ctx.deps.sql;
    if (
      sql === null ||
      typeof sql !== "object" ||
      typeof (sql as SqlExecutor).query !== "function"
    ) {
      throw new RagConfigError(
        `rag: provider "${provider}" needs a SqlExecutor in deps.sql ` +
          "(an object with a query(sql, params) method); see docs/modules/rag-package.md §2.3.",
      );
    }
    return pgFtsIndex({
      sql: sql as SqlExecutor,
      tokenizer: tokenizerForSearchStore(provider),
      provider,
    });
  };
}

// ───────────────────────────────────────────────────────────────────
// 内部
// ───────────────────────────────────────────────────────────────────

function assertRecord(record: SparseChunkRecord, label: string): void {
  if (record.text.length === 0) {
    throw new RagDependencyError(`${label}: chunk "${record.chunkKey}" has empty content`);
  }
}

/**
 * 标识符区段（weight A）。取结构化字段而不是正文里的词频：
 * `method` / `path` / `identityKey`（`POST /orders/{id}/refund`）/ `operationId`。
 *
 * 有意不取 `tags` / `summary`：它们是人类标签与自然语言，进 A 段会让「订单」这类
 * 高频词把大量 chunk 拉到同分，反而稀释 path 命中的区分度。它们留在正文（C 段）。
 */
function identifierText(record: SparseChunkRecord, tokenizer: Tokenizer): string {
  const pieces: string[] = [];
  const { fields, metadata } = record;

  if (fields?.method) pieces.push(fields.method);
  if (fields?.path) pieces.push(fields.path);
  const identityKey = metadata?.identityKey;
  if (typeof identityKey === "string") pieces.push(identityKey);
  const operationId = metadata?.operationId;
  if (typeof operationId === "string") pieces.push(operationId);

  return queryTerms(pieces.flatMap((piece) => tokenizer.normalizeIdentifiers(piece))).join(" ");
}

/**
 * 词元清洗：白名单 + 长度上限 + 去重保序 + 总量上限。
 *
 * 去重不只是省事：`to_tsquery('a | a | a')` 让该词元在 rank 里被重复计数，
 * 等于给「用户重复写同一个词」发奖励（与字段权重串味）。重复词的权重应由
 * `setweight` 决定，不由输入决定。
 */
function queryTerms(tokens: readonly string[]): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const token of tokens) {
    const term = token.normalize("NFC").toLowerCase();
    if (term.length === 0 || term.length > MAX_TERM_LENGTH) continue;
    if (!SAFE_TERM.test(term) || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_QUERY_TERMS) break;
  }

  return terms;
}

/** 测试引用：断言「查询词元数被截断」时用它，避免测试里再写一遍 64。 */
export const PGFTS_QUERY_TERM_LIMIT = MAX_QUERY_TERMS;
