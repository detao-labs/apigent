import {
  pgTable,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  customType,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { organizations } from "./auth";
import { repositories, repoVersions } from "./repo";
import { endpoints } from "./endpoint";

// ═══════════════════════════════════════════════════════════════════
// Knowledge Chunks — RAG 检索主单元（embedding + BM25 混合检索）
// ═══════════════════════════════════════════════════════════════════
//
// 对应 docs/modules/semantic-search.agent.md §3 的 Chunk 模型：
//   - 分层 chunk：L0 project / L1 tag / L2 endpoint / L3 schema+rules
//     （workflow 为 V1+，随 Knowledge Graph 启用）
//   - 中英双 chunk：同一内容按 lang 拆成独立 chunk + 独立 embedding
//   - 检索主单元为 L2 (endpoint full)，精排后按 parent_id 扩展上下文
//
// 兼容未来 Milvus / Elasticsearch：
//   - 权限与身份字段（org_id / repo_id / version_id / endpoint_id /
//     lang / chunk_key / parent_id）全部是独立列，可 1:1 映射为
//     Milvus scalar fields 或 ES document fields；
//   - chunk_key 是跨系统稳定 ID（repo 内唯一），同步/导出按它幂等 upsert；
//   - 富元数据放 metadata jsonb（Milvus JSON field / ES flattened）；
//   - search_vector 是 PG 专属（tsvector），ES 接管稀疏检索后可移除。
//
// 混合检索（BM25 + embedding）：
//   - embedding vector(1024) + HNSW (vector_cosine_ops) → dense 召回
//   - search_vector tsvector + GIN → PG FTS 稀疏召回（ts_rank 近似 BM25，
//     真实 BM25 后续由 ES / pg_search 提供，检索服务层抽象隔离）
//   - 两路结果在 retrieval service 用 RRF 融合（rag.fusionMethod）
//
// 注意：维度 1024 与默认 embedding 模型 text-embedding-v4 对齐；
// 更换不同维度模型需要迁移。
// ═══════════════════════════════════════════════════════════════════

/** tsvector 列（PostgreSQL 全文检索，drizzle 无内置类型） */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    /** 冗余 org 快照 — 检索前权限过滤；repo 迁移 org 后保持 snapshot 语义 */
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    repoId: text("repo_id")
      .notNull()
      .references(() => repositories.id),
    /** 所属 OpenAPI 版本（project/usage-context chunk 可为空） */
    versionId: text("version_id").references(() => repoVersions.id),
    /** endpoint 级 chunk 关联（L2/L3） */
    endpointId: text("endpoint_id").references(() => endpoints.id),
    /** 分层 chunk 的父节点（L3 → L2；双语 chunk 共享同一 parent） */
    parentId: text("parent_id").references((): AnyPgColumn => knowledgeChunks.id),
    /**
     * 跨系统稳定 ID（repo 内唯一），如
     * `{version}:{level}:{method}:{path}:{lang}` — Milvus/ES 同步按它 upsert
     */
    chunkKey: varchar("chunk_key", { length: 512 }).notNull(),
    /** 层级：project | tag | workflow | endpoint | schema | rules */
    level: varchar("level", { length: 20 }).notNull(),
    /** 语言：zh | en（中英双 chunk 策略，见 semantic-search.agent.md §3.4） */
    lang: varchar("lang", { length: 10 }).notNull().default("en"),
    content: text("content").notNull(),
    /** content 的哈希（SHA-256）— 变更检测 / 去重 */
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    /** 富元数据：tag / method / path / direction / workflow_id / token 数等 */
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    /** dense 向量（text-embedding-v4, 1024 维）；sparse-only 模式可为空，支持延迟回填 */
    embedding: vector("embedding", { dimensions: 1024 }),
    /** PG 全文检索向量（BM25 近似）；ES 接管后移除 */
    searchVector: tsvector("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // 幂等同步锚点：repo 内 chunk_key 唯一
    uniqueIndex("knowledge_chunks_repo_key_idx").on(table.repoId, table.chunkKey),
    // 权限过滤（org 级查询）
    index("knowledge_chunks_org_idx").on(table.orgId),
    // endpoint 级检索 / 上下文扩展
    index("knowledge_chunks_endpoint_idx").on(table.endpointId),
    // 精排后按 parent 加载上下文（L3 → L2）
    index("knowledge_chunks_parent_idx").on(table.parentId),
    // 稀疏召回：tsvector + GIN
    index("knowledge_chunks_search_vector_gin_idx").using("gin", table.searchVector),
    // 稠密召回：HNSW 余弦索引
    index("knowledge_chunks_embedding_hnsw_idx").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);
