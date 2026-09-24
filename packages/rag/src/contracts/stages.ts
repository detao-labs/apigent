// ═══════════════════════════════════════════════════════════════════
// RAG Contracts — 阶段端口（Embedder / DenseIndex / Tokenizer）
// ═══════════════════════════════════════════════════════════════════
//
// 这里是**可替换阶段的接口面**（P0-6：`provider` 字段既能写内置枚举、也能写
// npm 包名）。第三方包把本文件所在的 `@apigent/rag/contracts` 声明为
// **peerDependency**，避免多装出多份接口副本导致的结构不兼容。
//
// 只定义**已经有实现或替身的阶段**。其余阶段随各自任务增量添加，不提前声明：
//   - SparseIndex → P4-5
//   - Reranker → P5-2；QueryRewriter → P5-5 / P5-6；Fusion / ContextExpander → P5-1 / P5-3
//
// 三条约束（与 docs/modules/rag-package.md §3.1 一致）：
//   1. 端口只收发**纯 JSON 可序列化**的值 —— 不传 ORM 行、不传数据库句柄
//      （句柄只进构造函数），不传 Buffer。这样任意阶段都能是进程外实现。
//   2. 本模块**零重依赖** —— 不得 import db / pg / drizzle / ai。
//   3. 端口不认识权限，只认识**已经解析好的 `RagScope`**（P0-4 的不变量在实现侧落地）。
// ═══════════════════════════════════════════════════════════════════

import type { ChunkLang, ChunkLevel, RagDocumentFields, RagScope, RetrievalFilters } from "./types";
import type { RagDocument } from "./types";

// ───────────────────────────────────────────────────────────────────
// 分块
// ───────────────────────────────────────────────────────────────────

/**
 * 一个 chunk = **一个逻辑身份 + 它实际承载的文档内容**。
 *
 * 为什么 key 由分块器算、而不是让调用方从 `document.id` 里猜：`chunk_key` 是对账式
 * 同步（P4-6）唯一的期望集合锚点 —— 「这个接口的 chunk 在哪」必须只有一处定义，
 * 否则「期望集合」与「实际写入的 key」会各算各的。
 *
 * `part` / `parts` 表达「同一逻辑单元被切成多块」：`parts === 1` 时并非切分，key 就是
 * 逻辑身份本身；切分后 key 为 `{id}#0`、`{id}#1`…（见 `stages/chunker.ts` 的规则）。
 */
export interface RagChunk {
  /** repo 内的稳定逻辑身份（**不含** commit / version 前缀）。对账的锚点。 */
  chunkKey: string;
  /** 该块承载的文档（切分后每块都是完整的 `RagDocument`，可独立 embedding） */
  document: RagDocument;
  /** 同一逻辑单元的块序号（0-based）；未切分为 0 */
  part: number;
  /** 同一逻辑单元被切成的总块数；未切分为 1 */
  parts: number;
}

/**
 * 分块阶段：`RagDocument[] → RagChunk[]`。
 *
 * 它是**纯计算**阶段：不读配置、不连外部资源、对同一输入必须给出同一输出
 * （同输入重复跑的幂等性是 P4-2 的验收项之一，也是对账式同步成立的前提）。
 */
export interface Chunker {
  chunk(documents: RagDocument[]): RagChunk[];
}

// ───────────────────────────────────────────────────────────────────
// 分词
// ───────────────────────────────────────────────────────────────────

/**
 * 分词阶段 —— 稀疏召回的前置。
 *
 * 它是**可替换阶段**：P0-3 定案里 `rag.searchStore.provider` 有四个取值
 * （`pg-fts-jieba` 默认 / `pg-fts-bigram` 备选 / `pg-fts-simple` / `none`），
 * 而「切什么词」正是它们之间最主要的差别。
 */
export interface Tokenizer {
  /**
   * 版本串：库版本 + 词典标识 + 分词模式 + 归一化实现版本。
   *
   * 落进 `knowledge_chunks.tokenizer_version`（P3-1），检索时校验：不一致 =
   * **必须 REINDEX**（切分口径变了，旧索引里的词元与新查询的词元对不上，
   * 表现为「静默查不到」）。所以它不是给人看的注释，是索引元数据。
   */
  readonly version: string;

  /**
   * 分词。
   *
   * **索引侧与查询侧必须用同一个实例、同一种模式。** jieba 必须用
   * `cutForSearch`（搜索模式）而不是默认的 `cut`：实测默认模式把「发货单」切成
   * 单个词元，用户查「发货」→ 命中 0，而且**不报错、不告警**（spike §4.3）。
   */
  tokenize(text: string): string[];

  /**
   * 标识符归一化：`POST /orders/{id}/refund` → `["post","orders","id","refund"]`。
   *
   * 与中文方案**无关**，但是无条件必做的（spike：不做归一化时 `path` 被 FTS
   * 切成一个 `file` token，用户写 `orders refund` 命中率 0%）。让每个稀疏
   * provider 各实现一遍必然漂移，所以它被放进端口。
   */
  normalizeIdentifiers(text: string): string[];
}

// ───────────────────────────────────────────────────────────────────
// 向量化
// ───────────────────────────────────────────────────────────────────

/**
 * 模型身份 —— P0-2 定案：随索引行落库（`embedding_model` / `embedding_dim`），
 * 检索时按它过滤，避免新旧模型的向量混在同一张表里被一起召回（静默劣化）。
 *
 * 换模型 = 全量重索引，所以这两个字段是**索引元数据**，不是运行时开关。
 */
export interface EmbeddingIdentity {
  /** 形如 `qwen:text-embedding-v4`；测试替身为 `test:hash` */
  model: string;
  /** 向量维度。P0-2 定案固定 1024（provider 负责截断 / 补齐到该维度） */
  dim: number;
}

export interface EmbedResult {
  /** 与入参 `texts` **等长同序**。长度不一致属于实现 bug，调用方应校验。 */
  vectors: number[][];
  /** provider 报告的实际用量；测试替身给的是估算值。落进 IndexReport / trace.tokens */
  tokens?: number;
}

/**
 * 向量化阶段。
 *
 * `identity` 是属性而不是方法：它在一次部署内不变，摄取时读一次写进每一行，
 * 检索时读一次作为过滤条件。
 */
export interface Embedder {
  readonly identity: EmbeddingIdentity;
  embed(texts: string[]): Promise<EmbedResult>;
}

// ───────────────────────────────────────────────────────────────────
// 稠密索引
// ───────────────────────────────────────────────────────────────────

/**
 * 稠密索引里的一条记录 —— 内存等价于「一行 `knowledge_chunks` + 它的 link 行」。
 *
 * 为什么 `commitIds` 在记录上而不在单独的 links 结构里：P0-4 定案是
 * **chunk 内容寻址 + `knowledge_chunk_links` 关联 commit**，即同一份内容被多个
 * commit 复用时只有一行 chunk、多行 link。内存实现把 links 折叠成数组表达同一
 * 语义：`unlink()` 就是删 link，最后一个 link 消失时才 GC 记录本身。
 */
export interface DenseChunkRecord {
  /** repo 内的稳定逻辑身份（**不含** commit / version 前缀） */
  chunkKey: string;
  repositoryId: string;
  /**
   * 该仓库所属组织的**快照**（P0-4：chunk 保留 `repository_id` /
   * `organization_id` 快照列）。`scope.organizationId` 的收窄打在它上面。
   */
  organizationId?: string;
  /** 引用该 chunk 的 commit 集合（= `knowledge_chunk_links`） */
  commitIds: string[];
  level: ChunkLevel;
  lang: ChunkLang;
  /** 原始正文（不是分词后的 search_text） */
  text: string;
  fields?: RagDocumentFields;
  metadata?: Record<string, unknown>;
  vector: number[];
  /** 产出该向量的模型身份（= `Embedder.identity.model`），检索按它过滤 */
  embeddingModel: string;
}

export interface DenseQuery {
  vector: number[];
  scope: RagScope;
  limit: number;
  /**
   * 最低余弦相似度（`rag.retrieval.minScore`）。
   *
   * 不传 = 不设阈值（默认）。**由检索侧从配置注入**（P5-1），不是调用方 filters 的
   * 一部分 —— 阈值是部署策略，不是这一次查询的过滤条件。实现必须把它做成
   * **查询内的 SQL 条件**（`ORDER BY` / `LIMIT` 之前），不能取回后再过滤。
   */
  minScore?: number;
  filters?: RetrievalFilters;
  /** 只召回该模型产出的向量；不匹配的行视为待重索引，不参与召回（P0-2） */
  embeddingModel: string;
}

export interface DenseHit {
  chunkKey: string;
  repositoryId: string;
  level: ChunkLevel;
  lang: ChunkLang;
  text: string;
  fields?: RagDocumentFields;
  metadata?: Record<string, unknown>;
  /** 原始相似度（余弦，范围 -1..1）；0-1 归一化由融合阶段（P5-1）负责 */
  score: number;
}

export interface DenseUnlinkSelector {
  repositoryId: string;
  /** 要解除引用的 commit */
  commitId: string;
  /** 不传 = 该 commit 的全部 link */
  chunkKeys?: string[];
}

/**
 * 稠密索引阶段。内置实现：`pgvector`（P4-4）/ `memory`（P2-5 替身）。
 *
 * 过滤语义（P0-4 的两条权限不变量，实现侧必须守住）：
 *   - **权限打在 chunk 上**：`scope.repositoryIds` 是调用方解析好的可见集合，
 *     空数组 = 无权限 = 零结果（不存在「不传即全库」的形态）；
 *   - **版本打在 link 上**：`scope.commitIds` 只做收窄，不承担任何权限语义；
 *   - 两者与 `filters` 在同一查询内 AND，且**都在排序与 limit 之前** ——
 *     不得退化为「取回后再过滤」。
 */
export interface DenseIndex {
  /**
   * 写入或更新。
   *
   * 同一 `(repositoryId, chunkKey)` 是一条记录：再次 upsert 覆盖内容与向量，
   * 并**合并** `commitIds`（该内容可能同时被新旧 commit 引用）。
   * 向量长度必须与索引既有维度一致，不一致直接抛错（P0-2：不允许混维度）。
   */
  upsert(records: DenseChunkRecord[]): Promise<void>;
  search(query: DenseQuery): Promise<DenseHit[]>;
  /**
   * 解除某个 commit 对 chunk 的引用（= 删 `knowledge_chunk_links` 行）。
   * 记录在**没有任何 commit 引用时**才被移除 —— 这是 P0-4 的 GC 规则，
   * 防止误删仍被其他 commit 引用的内容。返回受影响的记录数。
   */
  unlink(selector: DenseUnlinkSelector): Promise<number>;
  /** 删除整个仓库的记录（仓库删除 / 强制全量重建）。返回移除的记录数。 */
  dropRepository(repositoryId: string): Promise<number>;
  /** 记录数（健康检查与对账断言用） */
  size(): Promise<number>;
}
