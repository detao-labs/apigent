// ═══════════════════════════════════════════════════════════════════
// Adapters — `knowledge_chunks` 行身份与元数据的**唯一**计算处
// ═══════════════════════════════════════════════════════════════════
//
// 稠密索引（`pgvector-index`）与稀疏索引（`pg-fts-index`）写的是**同一批行**：
// 稠密侧填 `embedding*`，稀疏侧填 `search_text` / `search_identifiers`。要让两侧
// 落到同一行，就必须对「行主键」「内容哈希」「落库 metadata」给出完全一致的答案。
//
// 放在这里而不是各写一份：这两个值一旦不一致，症状是**索引里出现两行内容相同的
// chunk**（一行有向量、一行有分词），检索时各召回一半、去重逻辑失效，而且两份
// 代码看起来都没错 —— 属于最难查的一类。所以只留一处实现，两边 import。
//
// （P4-4 的 `pgvector-index.ts` 里原本是私有函数，本次抽出来是为了 P4-5 复用，
// 逻辑未改；参数顺序 / SQL 形态保持原样，既有测试是这次重构的回归网。）
// ═══════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import { RagDependencyError, type RagDocumentFields, type SqlExecutor } from "../contracts";

/**
 * 行主键。确定性 id 让 upsert 幂等，也让排障时能直接从 (repo, key, hash) 反推 id。
 * 长度上限与 `text` 列无关（text 无上限），但保持紧凑便于日志阅读。
 */
export function chunkRowId(repositoryId: string, chunkKey: string, contentHash: string): string {
  return createHash("sha256")
    .update(`${repositoryId}\u0000${chunkKey}\u0000${contentHash}`, "utf8")
    .digest("hex");
}

/**
 * 落库的 metadata：把记录上的 `fields`（method / path / tags / summary）**摊平**到
 * 顶层，因为 `RetrievalFilters` 要在 SQL 里按它们过滤（`metadata->>'method'`）。
 * 表里没有 method / path 列，这是唯一能「过滤仍在 SQL 内」的存法。
 */
export function storedMetadata(record: {
  metadata?: Record<string, unknown>;
  fields?: RagDocumentFields;
}): Record<string, unknown> {
  return { ...record.metadata, ...record.fields };
}

export function fieldsOf(metadata: Record<string, unknown> | null): RagDocumentFields | undefined {
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

/**
 * org 快照列的回落查询：记录上没带 `organizationId` 时回表读一次，并在进程内缓存
 * ——同一仓库在一次进程生命周期内不会换组织。
 */
export function createOrganizationResolver(
  sql: SqlExecutor,
  /** 出错信息里的适配器名（`pgvector` / `pg-fts-jieba` …），便于定位是哪条写入路径 */
  label: string,
): (repositoryId: string, provided?: string) => Promise<string> {
  const cache = new Map<string, string>();

  return async function organizationIdOf(repositoryId, provided) {
    if (provided) return provided;
    const cached = cache.get(repositoryId);
    if (cached) return cached;

    const [row] = await sql.query<{ organizationId: string }>(
      `select r.organization_id as "organizationId" from repositories r where r.id = $1`,
      [repositoryId],
    );
    if (!row?.organizationId) {
      throw new RagDependencyError(
        `${label}: cannot resolve organization_id for repository ${repositoryId} ` +
          "(the chunk row requires the org snapshot column; pass organizationId on the record).",
      );
    }
    cache.set(repositoryId, row.organizationId);
    return row.organizationId;
  };
}

/** pgvector 的字面量形式：`[0.1,0.2,…]`，配合 SQL 里的 `::vector` 转型。 */
export function vectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/**
 * 把「这个 chunk 被哪些 commit 引用」写进 `knowledge_chunk_links`（幂等）。
 *
 * 用 `insert … select …` 而不是 `values`：chunk 行刚由 upsert 建出（或已存在），
 * 按内容寻址三元组回查它的 id，避免把 id 的计算规则抄进第二处。
 */
export async function ensureChunkLinks(
  sql: SqlExecutor,
  link: {
    repositoryId: string;
    chunkKey: string;
    contentHash: string;
    commitIds: readonly string[];
  },
): Promise<void> {
  for (const commitId of link.commitIds) {
    await sql.query(
      `insert into knowledge_chunk_links (commit_id, chunk_id)
       select $1, c.id from knowledge_chunks c
       where c.repository_id = $2 and c.chunk_key = $3 and c.content_hash = $4
       on conflict do nothing`,
      [commitId, link.repositoryId, link.chunkKey, link.contentHash],
    );
  }
}
