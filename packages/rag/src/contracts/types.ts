// ═══════════════════════════════════════════════════════════════════
// RAG Contracts — 类型定义
// ═══════════════════════════════════════════════════════════════════
//
// 这是四个消费端点（平台页面 / agent 运行时 / MCP / 评测）共用的契约。
// 本模块**零重依赖**：不得 import db / pg / drizzle / ai，客户端可安全引用。
//
// 三条贯穿全局的约定：
//   1. **scope 必填** —— RAG 不做鉴权，权限由调用方解析后传入（见 RagScope）。
//   2. **降级与 trace 进结果**，不只进日志 —— UI 要展示、评测要断言、MCP 要提示。
//   3. **没有 answer** —— P0-5 定案：RAG 只返回检索结果，需要答案的一方自己生成。
//
// 完整设计见 docs/modules/rag-package.md §4。
// ═══════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────
// 枚举常量（与 knowledge_chunks 的列取值保持一致，避免两处漂移）
// ───────────────────────────────────────────────────────────────────

/** chunk 层级：L0 project / L1 tag / L2 endpoint / L3 schema+rules / workflow */
export const CHUNK_LEVELS = ["project", "tag", "workflow", "endpoint", "schema", "rules"] as const;
export type ChunkLevel = (typeof CHUNK_LEVELS)[number];

/** 中英双 chunk 策略：同一内容按语言拆成独立 chunk */
export const CHUNK_LANGS = ["zh", "en"] as const;
export type ChunkLang = (typeof CHUNK_LANGS)[number];

// ───────────────────────────────────────────────────────────────────
// 检索范围
// ───────────────────────────────────────────────────────────────────

/**
 * 检索范围 —— **由调用方解析，RAG 不自己鉴权**。
 *
 * 为什么不把 RBAC 放进 RAG 包：四个调用方的权限来源完全不同（平台 session、
 * MCP 的 key owner + 仓库白名单、agent 运行时、评测没有用户）。塞进来会让评测
 * 无法复用同一条管线，还会诞生第二套授权模型。
 *
 * 代价是「调用方可能忘记传 scope」，因此字段设计为**必填** —— 类型上不存在
 * 「不传 = 全库搜索」的形态。四个调用方统一走 server 的 `resolveSearchScope()`。
 */
export interface RagScope {
  /** 必填。调用方已解析完成的可见仓库集合。空数组 = 无权限，直接返回空结果。 */
  repositoryIds: string[];
  /** 收窄到组织（可选） */
  organizationId?: string;
  /** 收窄到 Project（V1+；双层规则：project 成员 ∩ repo 权限） */
  projectId?: string;
  /**
   * 收窄到具体 **commit**（可选）。缺省 = 各仓库主版本（`versions.is_default`）
   * 的 `head_commit_id`。
   *
   * 注意是 commit 而非 version：P0-4 定案后 chunk 按内容寻址、经
   * `knowledge_chunk_links` 关联 commit，检索按 commit 收窄。
   */
  commitIds?: string[];
}

// ───────────────────────────────────────────────────────────────────
// 检索
// ───────────────────────────────────────────────────────────────────

/** 检索模式：fast 跳过查询改写；deep 允许完整管线 */
export type RetrievalMode = "fast" | "deep";

/** 实际生效的检索策略，回填给调用方用于展示与排障 */
export type RetrievalStrategy = "hybrid" | "dense" | "sparse" | "kg" | "fallback";

/** 结构化筛选条件，与权限过滤是两层 AND（各自独立生效） */
export interface RetrievalFilters {
  methods?: string[];
  tags?: string[];
  pathPrefix?: string;
}

export interface RetrieveRequest {
  query: string;
  scope: RagScope;
  /** 默认取 `rag.retrieval.fineRankTopK` */
  topK?: number;
  mode?: RetrievalMode;
  filters?: RetrievalFilters;
  /** 是否做上下文扩展（按 parent 取规则 / tag 概述），默认 true */
  expand?: boolean;
  /** 是否精排，默认 true；评测做 A/B 对照时需要关 */
  rerank?: boolean;
  /** 返回各路分数与阶段耗时，供平台调试与评测使用 */
  includeDebug?: boolean;
}

/** 命中片段：告诉用户「哪里匹配上了」 */
export interface ChunkHighlight {
  field: string;
  snippet: string;
}

/** 精排后按 parent / level 扩展出的补充上下文 */
export interface ExpandedContext {
  level: ChunkLevel;
  content: string;
}

export interface RetrievedChunk {
  /** repo 内的稳定逻辑身份（不含 version / commit） */
  chunkKey: string;
  repositoryId: string;
  level: ChunkLevel;
  method?: string;
  path?: string;
  summary?: string;
  /** 最终排序分，0-1 */
  score: number;
  /** 粗排（融合）分数，便于调试与评测对比 */
  coarseScore?: number;
  /** 精排分数 */
  fineScore?: number;
  /** 为什么匹配 —— 给人看，也是上层生成答案时的依据 */
  matchReason?: string;
  highlights?: ChunkHighlight[];
  context?: ExpandedContext[];
}

/** 降级原因。降级必须进结果而不是只进日志，否则 UI 与评测都看不见。 */
export type DegradationReason =
  "embedding_unavailable" | "index_empty" | "rerank_failed" | "rewrite_failed";

export interface Degradation {
  reason: DegradationReason;
  detail?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

/** 一次检索的执行摘要。`traceId` 与日志上下文的 traceId 同源。 */
export interface RagTraceSummary {
  traceId: string;
  latencyMs: number;
  /** 阶段名 → 耗时（ms） */
  stageMs: Record<string, number>;
  llmCalls: number;
  tokens?: TokenUsage;
  costUsd?: number;
  cacheHit?: boolean;
}

export interface RetrieveResult {
  query: string;
  rewrittenQuery?: string;
  strategy: RetrievalStrategy;
  results: RetrievedChunk[];
  /** 融合后的候选总数（截断前），用于判断召回是否充足 */
  totalCandidates: number;
  degraded?: Degradation;
  trace: RagTraceSummary;
}

// ───────────────────────────────────────────────────────────────────
// 摄取
// ───────────────────────────────────────────────────────────────────

export interface IndexRequest {
  repositoryId: string;
  /** 缺省 = 该仓库主版本的 head commit */
  commitId?: string;
  /** 只重索引部分接口（identity_key） */
  endpoints?: string[];
  /** 忽略 content_hash 复用，强制重算 */
  force?: boolean;
}

export interface IndexReport {
  chunksWritten: number;
  /** 命中 content_hash 复用、跳过 embedding 的条数 */
  chunksSkipped: number;
  chunksDeleted: number;
  tokens: number;
  costUsd?: number;
  durationMs: number;
  degraded?: Degradation;
}

// ───────────────────────────────────────────────────────────────────
// 文档（摄取的输入）
// ───────────────────────────────────────────────────────────────────

/** 结构化字段，供稀疏检索加权（method / path 是高权重标识符） */
export interface RagDocumentFields {
  method?: string;
  path?: string;
  summary?: string;
  tags?: string[];
}

/**
 * 待索引文档 —— 「API 知识 → 可检索文本」的唯一定义。
 *
 * 把它做成阶段而不是散落在 SQL 里，是为了让评测能直接对「文档构建」做 A/B。
 */
export interface RagDocument {
  /** repo 内稳定的逻辑 ID，参与 chunk_key 构造 */
  id: string;
  level: ChunkLevel;
  lang: ChunkLang;
  /**
   * 该仓库所属组织的**快照**（P0-4：chunk 保留 `organization_id` 快照列）。
   * 由文档源从 `repositories.organization_id` 读出后填上 —— 索引层按它响应
   * `scope.organizationId` 的收窄，不再回表 join。
   */
  organizationId?: string;
  /** 用于向量化的正文 */
  text: string;
  fields?: RagDocumentFields;
  metadata?: Record<string, unknown>;
  /** 分层 chunk 的父节点（L3 → L2；双语 chunk 共享同一 parent） */
  parentId?: string;
}

/**
 * 文档源：把「一个 commit 的内容」变成待索引文档。
 *
 * 内置实现从 endpoints + endpoint_responses + business_contexts + components
 * 组装；它是「API 知识 → 可检索文本」的唯一权威定义，改这里等于改检索质量。
 */
export interface RagDocumentSource {
  load(req: IndexRequest, scope: { repositoryIds: string[] }): Promise<RagDocument[]>;
}

// ───────────────────────────────────────────────────────────────────
// 服务
// ───────────────────────────────────────────────────────────────────

export type RagHealthStatus = "ok" | "degraded" | "unavailable";

export interface RagHealth {
  status: RagHealthStatus;
  details?: Record<string, unknown>;
}

/**
 * 整条管线的对外接口面（L0 整体替换）。
 *
 * **没有 `answer`** —— P0-5 定案：RAG 只返回检索结果，问答由需要答案的一方
 * 拿结果自行生成。
 */
export interface RagService {
  index(req: IndexRequest): Promise<IndexReport>;
  retrieve(req: RetrieveRequest): Promise<RetrieveResult>;
  health(): Promise<RagHealth>;
}
