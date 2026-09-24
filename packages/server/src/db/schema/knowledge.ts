import {
  pgTable,
  varchar,
  text,
  jsonb,
  integer,
  timestamp,
  index,
  uniqueIndex,
  primaryKey,
  customType,
  vector,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations } from "./organization";
import { repositories } from "./repository";
import { versionCommits } from "./version";
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
//   - 权限与身份字段（organization_id / repository_id / endpoint_id / lang /
//     chunk_key / content_hash / parent_id）全部是独立列，可 1:1 映射为
//     Milvus scalar fields 或 ES document fields；
//   - chunk_key 是跨系统稳定 ID（repo 内唯一），同步/导出按它幂等 upsert；
//   - 富元数据放 metadata jsonb（Milvus JSON field / ES flattened）；
//   - search_vector 是 PG 专属（tsvector），ES 接管稀疏检索后可移除。
//
// 内容寻址（P0-4 定案，P3-4 迁移落地）：
//   - chunk 是**版本无关**的内容块，同 `endpoints`；「哪个 commit 用哪些 chunk」
//     由 `knowledge_chunk_links` 承担（与 `version_entity_links` 同构）。因此本表
//     没有 version_id：挂它等于在一个已做内容寻址的系统里按版本复制行 —— 50 个
//     commit 就是 50 份几乎相同的 chunk。
//   - 唯一键是 **`(repository_id, chunk_key, content_hash)`**：同一逻辑单元
//     （chunk_key）内容变了就是新行，内容没变则复用旧行 —— 行数只随**去重后的
//     内容量**增长；回滚 / 切分支**零重索引**（只改 head_commit_id）。
//   - `repository_id` 留在 chunk 上是**权限不变量的地基**：权限过滤打 chunk、
//     版本过滤打 link，两层 AND，绝不做跨仓库内容共享（否则权限基准消失）。
//
// 混合检索（BM25 + embedding）：
//   - embedding vector(1024) + HNSW (vector_cosine_ops) → dense 召回
//   - search_vector tsvector + GIN → PG FTS 稀疏召回（ts_rank 近似 BM25，
//     真实 BM25 后续由 ES / pg_search 提供，检索服务层抽象隔离）
//   - 两路结果在 retrieval service 用 RRF 融合（rag.fusionMethod）
//
// 生产者身份（P0-2 / P0-3 定案，P3-1 迁移落地）：
//   - embedding 的三个伴生列（embedding_model / embedding_dim /
//     embedding_updated_at）记录「这行向量是谁产的」。检索按当前模型过滤，
//     不匹配的行视为待重索引、不参与召回 —— 新旧向量混表检索是**静默劣化**，
//     必须由结构排除。
//   - tokenizer_version 记录 search_vector 是哪个分词器版本产出的（库版本 +
//     词典 + 模式 + 归一化版本），口径变了必须 REINDEX，不能拿新旧词元互查。
//   - 换 embedding 模型 = 换维度 = 重建 HNSW 索引 = 全量重索引；这三件事是
//     同一件 DDL 期决策，不是运行时开关。
//   - 时机红利：该表当前 0 行，本迁移零成本、无需回填。
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
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repositories.id),
    /** endpoint 级 chunk 关联（L2/L3） */
    endpointId: text("endpoint_id").references(() => endpoints.id),
    /** 分层 chunk 的父节点（L3 → L2；双语 chunk 共享同一 parent） */
    parentId: text("parent_id").references((): AnyPgColumn => knowledgeChunks.id),
    /**
     * 跨系统稳定 ID（repo 内唯一），如
     * `{level}:{method}:{path}:{lang}` — Milvus/ES 同步按它 upsert。
     *
     * **不含 version**（P0-4）：同一逻辑单元跨版本保持同一个 key，版本关系由
     * `knowledge_chunk_links` 表达；带上 version 会让「回滚零重索引」不成立。
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
    /**
     * 产出该向量的模型身份（形如 `qwen:text-embedding-v4`）。
     *
     * 检索侧 `WHERE embedding_model = $current`；不匹配的行是「待重索引」，
     * 不参与召回。与 embedding 同 NULL —— 不存在「有向量但不知道谁产的」。
     */
    embeddingModel: varchar("embedding_model", { length: 128 }),
    /** 向量维度快照（当前恒为 1024；换维度要改列类型 + 重建索引 + 全量重索引） */
    embeddingDim: integer("embedding_dim"),
    /** 该向量最后一次写入时间 —— 换模型后据此统计/展示待重索引规模 */
    embeddingUpdatedAt: timestamp("embedding_updated_at", { withTimezone: true }),
    /**
     * 应用侧切好词的检索文本（P0-3 定案）—— jieba `cutForSearch` 的词元 +
     * 标识符归一化结果，由 `@apigent/rag` 的 sparse 写入路径拼好。
     *
     * 为什么把分词放在应用侧、又单独存一列：数据库没有中文分词（spike 实测
     * `to_tsvector('english')` 对中文近乎失效），而直接把词元拼进 `content`
     * 会毁掉原文。单独一列换来两件事：① `search_vector` 可以由它**确定性**
     * 派生；② 排障时 `select search_text` 就能看到「切成了什么」。
     */
    searchText: text("search_text"),
    /**
     * PG 全文检索向量（`ts_rank` 近似 BM25）；ES 接管后移除。
     *
     * **生成列**，由 `search_text` 派生：分词在应用侧、tsvector 在 DB 侧确定性
     * 生成，没有「应用写完正文、向量还没更新」的窗口期。一参形式
     * `to_tsvector(text)` 依赖 GUC 且是 STABLE，**不能**用于生成列，必须显式写
     * `to_tsvector('simple'::regconfig, …)`（spike §4 实测）。`simple` 而不是
     * `english`：中文本来就不靠 PG 的 parser，且 english 的 stemming 会改动英文
     * 标识符。
     */
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple'::regconfig, "search_text")`,
    ),
    /**
     * 产出 search_vector 的分词器版本（P0-3：库版本 + 词典标识 + 分词模式 +
     * 归一化实现版本，见 `@apigent/rag` 的 `Tokenizer.version`）。
     *
     * 检索时校验：不一致 = 必须 REINDEX（切分口径变了，旧索引的词元与新查询的
     * 词元对不上，表现为静默查不到）。`searchStore.provider: none` 的部署可以为空。
     */
    tokenizerVersion: varchar("tokenizer_version", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    // 内容寻址的幂等锚点：repo 内「同一逻辑单元 + 同一内容」唯一。
    // 同一 (repository_id, chunk_key) 允许有多行（内容不同 = 多个历史内容块），
    // 所以它同时是查询锚点 —— WHERE repository_id = $1 AND chunk_key = ANY($2)
    // 走这个唯一索引的**前缀**即可，因此没有再补一条 (repository_id, chunk_key)
    // 的非唯一索引（那是纯冗余：写放大与空间都白付）。
    uniqueIndex("knowledge_chunks_repository_key_hash_idx").on(
      table.repositoryId,
      table.chunkKey,
      table.contentHash,
    ),
    // 权限过滤（org 级查询）
    index("knowledge_chunks_organization_idx").on(table.organizationId),
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
    // 「待重索引」统计与按模型过滤（P0-2）：WHERE embedding_model <> $current
    index("knowledge_chunks_embedding_model_idx").on(table.embeddingModel),
    // 向量身份必须成套出现 —— 有向量就必须知道是谁产的、维度和时间。
    // 这是「新旧模型向量混表」在 SQL 层面的排除，不依赖应用层自觉。
    check(
      "knowledge_chunks_embedding_identity_check",
      sql`(${table.embedding} IS NULL) = (${table.embeddingModel} IS NULL)
        AND (${table.embedding} IS NULL) = (${table.embeddingDim} IS NULL)
        AND (${table.embedding} IS NULL) = (${table.embeddingUpdatedAt} IS NULL)`,
    ),
    // 分词身份同理：切了词就必须知道用哪个分词器版本切的，否则 P0-3 的
    // 「版本不一致 → 拒绝检索 / 强制重索引」没有依据（P3-2 定下 search_text
    // 形态后才成立，所以这条约束在本次迁移加入，而不是 P3-1）。
    check(
      "knowledge_chunks_tokenizer_identity_check",
      sql`(${table.searchText} IS NULL) = (${table.tokenizerVersion} IS NULL)`,
    ),
  ],
);

// ═══════════════════════════════════════════════════════════════════
// Knowledge Chunk Links — 版本树（commit → chunk）
// ═══════════════════════════════════════════════════════════════════
//
// 与 `version_entity_links` 同构：commit 是「哪个版本」，chunk 是版本无关的内容块。
// 未变的内容跨 commit 复用同一行 chunk，所以回滚 / 切主分支只改 `versions.head_commit_id`，
// **零重索引**。
//
// 检索侧的两层过滤（P0-4 不变量，务必守住）：
//   - 权限层：`WHERE c.repository_id = ANY($accessibleRepos)` —— 打在 **chunk** 上；
//   - 版本层：`JOIN knowledge_chunk_links l ON l.commit_id = ANY($commits)` —— 只做
//     **收窄**，不承担任何权限语义。
//   两层在同一 SQL、`ORDER BY … LIMIT` 之前 → 仍是**检索前过滤**，没有「先取回
//   再过滤」的越权窗口，也不会把 20 条配额浪费在越权 / 非活跃行上。
//
// 索引的两点说明：
//   1. 主键 `(commit_id, chunk_id)` 的 btree 已能服务 `commit_id = $1`（前缀），
//      所以**不再**单列建 `(commit_id)` 索引（纯冗余）；
//   2. 反方向 `chunk_id` 是**真的需要**索引的：对账式 GC 要判断「这个 chunk 还有
//      没有别的 commit 引用」（`NOT EXISTS (SELECT 1 FROM links WHERE chunk_id = …)`），
//      没有它每次 GC 都是对 links 的顺序扫描。
export const knowledgeChunkLinks = pgTable(
  "knowledge_chunk_links",
  {
    commitId: text("commit_id")
      .notNull()
      .references(() => versionCommits.id),
    chunkId: text("chunk_id")
      .notNull()
      .references(() => knowledgeChunks.id),
  },
  (table) => [
    primaryKey({ columns: [table.commitId, table.chunkId] }),
    index("knowledge_chunk_links_chunk_idx").on(table.chunkId),
  ],
);
