// ═══════════════════════════════════════════════════════════════════
// RAG Pipeline — createRagService()
// ═══════════════════════════════════════════════════════════════════
//
// 唯一的消费入口：平台 API route、agent 工具、MCP tool、评测 harness 共用它。
//
// 「共用」的实际含意是：**评测与生产跑同一条管线**，只替换注入的 scope /
// telemetry / provider。自己写一套检索的评测器，指标不代表生产。
//
// 三条硬约束（都是为了上面这句话能成立）：
//   1. **管线只认识端口与名字** —— 不 import 任何具体实现，因此不存在「隐藏的
//      全局单例」：所有阶段都在 `createRagService()` 构造期由注入的工厂生成，
//      每次调用各得一套，测试可以只换一个阶段就改变行为。
//   2. **装配与解析在构造期完成** —— 配置里写错 provider 名字，在这里就抛
//      `RagConfigError`（列出已注册名单），而不是等第一次检索才炸（P0-6）。
//   3. **降级进结果，失败抛错误** —— 有退路时返回 `degraded`，没有退路时抛
//      `RagError` 子类。两者的边界写在各阶段注释里。
//
// ## Phase 2 的已知边界（都是有意的，不是遗漏）
//
// | 项 | 现状 | 由谁补齐 |
// |---|---|---|
// | 分块（chunker） | `RagDocument` 直接当 chunk 用 | P4-2 |
// | 稀疏召回 / 融合 / 精排 / 改写 / 上下文扩展 | 没有这些阶段 | P2-9 / P4-5 / P5-1~P5-6 |
// | `content_hash` 复用、对账式删除 | 只做 upsert，`chunksSkipped/Deleted` 恒为 0 | P4-6 |
// | `index_empty` 降级 | 不产生 —— 判断「本 scope 内无内容」需要 scope 级计数，SQL 适配器里做才便宜且正确 | P4-4 |
// | `matchReason` / `highlights` | 不填 | P5-2 / P5-3 |
// | `rerank` / `expand` / `mode: deep` 请求开关 | 无对应阶段，因此不产生行为差异 | P5-2 / P5-3 / P5-6 |
//
// 一句话总结 Phase 2 的能力：**dense-only 的「写入 → 检索」**，用来把契约钉死。
// ═══════════════════════════════════════════════════════════════════

import { randomUUID } from "node:crypto";
import {
  RagDependencyError,
  RagError,
  RagIngestError,
  type Degradation,
  type DenseChunkRecord,
  type DenseHit,
  type DenseQuery,
  type EmbedResult,
  type IndexReport,
  type IndexRequest,
  type RagHealth,
  type RagService,
  type RagTraceSummary,
  type RetrievalStrategy,
  type RetrieveRequest,
  type RetrieveResult,
  type RetrievedChunk,
} from "../contracts";
import { failOpenTelemetry } from "../telemetry/fail-open";
import { NOOP_TELEMETRY } from "../telemetry/noop";
import { DEFAULT_PIPELINE_CONFIG, type RagPipelineConfig, type RagServiceOptions } from "./types";

export function createRagService(options: RagServiceOptions): RagService {
  const { registry, providers } = options;
  const config: RagPipelineConfig = { ...DEFAULT_PIPELINE_CONFIG, ...options.config };
  const clock = options.clock ?? Date.now;
  const createTraceId = options.createTraceId ?? (() => randomUUID());
  const telemetry = failOpenTelemetry(options.telemetry ?? NOOP_TELEMETRY);
  // 分块器由宿主要求注入（不做「缺省 = 不分块」的兜底）：管线只认识端口，内置实现
  // 由注册方给（先例见 eslint.config.mjs 的 ragPipelineImportRestrictions）。
  const chunker = options.chunker;
  const deps = options.deps ?? {};

  // ── 装配（= P0-6 的启动期自检落点）────────────────────────────────
  // 名字写错、工厂抛错、形状不对，都在这里失败：调用方拿到的是启动期错误，
  // 而不是「跑了两小时才发现检索一直返回空」。
  const documentSource = registry.resolve(
    "documentSource",
    providers.documentSource.name,
  )({
    options: providers.documentSource.options ?? {},
    deps,
  });
  const embedder = registry.resolve(
    "embedder",
    providers.embedder.name,
  )({
    options: providers.embedder.options ?? {},
    deps,
  });
  const denseIndex = registry.resolve(
    "denseIndex",
    providers.denseIndex.name,
  )({
    options: providers.denseIndex.options ?? {},
    deps,
  });

  const providerNames = {
    documentSource: providers.documentSource.name,
    embedder: providers.embedder.name,
    denseIndex: providers.denseIndex.name,
  };

  // ── 摄取（写路径）─────────────────────────────────────────────────

  async function index(req: IndexRequest): Promise<IndexReport> {
    const startedAt = clock();
    const span = telemetry.startSpan("rag.index");
    const stageMs: Record<string, number> = {};
    let tokens = 0;

    try {
      const docs = await documentSource.load(req, { repositoryIds: [req.repositoryId] });
      // 文档 → chunk（P4-2）：超长文档在这里被切成多块，并由 chunker 给出对账用的
      // `chunkKey`（`document.id`，切分后带 `#n` 后缀）。没有 chunker 注入时用
      // `hierarchicalChunker()` —— 它是 `rag.chunkStrategy` 的缺省值。
      const chunks = chunker.chunk(docs);
      span.setAttribute("resultCount", chunks.length);

      const embedStartedAt = clock();
      const embedded = await embedDocuments(chunks.map((chunk) => chunk.document.text));
      stageMs["index.embed"] = clock() - embedStartedAt;
      const vectors = embedded.vectors;
      tokens = embedded.tokens ?? 0;

      if (vectors.length !== chunks.length) {
        // 向量与文档错位是**致命的静默错误**：会把 A 的向量写到 B 的内容上，
        // 检索结果看起来正常但全是错的。所以这里必须 fail-fast。
        throw new RagIngestError(
          `embedder returned ${vectors.length} vectors for ${chunks.length} chunks`,
        );
      }

      const records: DenseChunkRecord[] = chunks.map((chunk, i) => ({
        chunkKey: chunk.chunkKey,
        repositoryId: req.repositoryId,
        organizationId: chunk.document.organizationId,
        // `commitId` 缺省时不写 link —— 该 chunk 在按 commit 收窄的检索里**查不到**
        // （fail-closed）。「缺省 = 主版本 head」需要读 DB，是 P4-7 的职责。
        commitIds: req.commitId ? [req.commitId] : [],
        level: chunk.document.level,
        lang: chunk.document.lang,
        text: chunk.document.text,
        fields: chunk.document.fields,
        metadata: {
          ...chunk.document.metadata,
          // 切分信息进 metadata（不进 chunk_key）：排障时要能回答「这条为什么只有半截」
          ...(chunk.parts > 1 ? { part: chunk.part, parts: chunk.parts } : {}),
        },
        vector: vectors[i],
        embeddingModel: embedder.identity.model,
      }));

      if (records.length > 0) await denseIndex.upsert(records);
      span.end("ok");

      return {
        chunksWritten: records.length,
        // content_hash 复用与对账式删除是 P4-6；在此之前这两个计数恒为 0，
        // 而不是假装有值。
        chunksSkipped: 0,
        chunksDeleted: 0,
        tokens,
        durationMs: clock() - startedAt,
      };
    } catch (error) {
      span.end("error");
      throw asIngestError(req.repositoryId, error);
    }
  }

  /** 单独包一层，是为了让「向量化失败」的 span 状态只在一处收口。 */
  async function embedDocuments(texts: string[]): Promise<EmbedResult> {
    if (texts.length === 0) return { vectors: [] };

    const embedSpan = telemetry.startSpan("index.embed", {
      model: embedder.identity.model,
    });
    try {
      const embedded = await embedder.embed(texts);
      embedSpan.setAttribute("resultCount", embedded.vectors.length);
      embedSpan.end("ok");
      return embedded;
    } catch (error) {
      embedSpan.end("error");
      throw error;
    }
  }

  // ── 检索（读路径）─────────────────────────────────────────────────

  async function retrieve(req: RetrieveRequest): Promise<RetrieveResult> {
    const startedAt = clock();
    const traceId = createTraceId();
    const topK = Math.max(1, req.topK ?? config.topK);
    // 粗排规模至少要够 topK，否则「要 20 条却只召回 30 条再截 20」没问题、
    // 但 topK 超过 coarseRankTopK 时会静默少返回。
    const coarseLimit = Math.max(config.coarseRankTopK, topK);

    const span = telemetry.startSpan("rag.query", {
      repositoryCount: req.scope.repositoryIds.length,
      mode: req.mode ?? "fast",
      topK,
      ...(config.recordQueryText ? { query: req.query } : {}),
    });

    const stageMs: Record<string, number> = {};
    let results: RetrievedChunk[] = [];
    let totalCandidates = 0;
    let tokens = 0;
    let degraded: Degradation | undefined;
    // Phase 2 只有稠密一路，所以策略恒为 dense；退到没有结果可返回时才标 fallback。
    let strategy: RetrievalStrategy = "dense";

    // 空 scope = 无权限。这是**授权结果**而不是故障：返回空结果，不打降级标记。
    if (req.scope.repositoryIds.length > 0) {
      const denseStartedAt = clock();
      const denseSpan = telemetry.startSpan("retrieve.dense", {
        model: embedder.identity.model,
      });

      const embedded = await embedQuery(req.query);
      if (embedded.ok) {
        tokens = embedded.tokens;
        // 索引故障**在这里冒泡**（不吞成降级）：Phase 2 只有稠密一路，
        // 向量库不可用就没有任何退路，属于 `RagDependencyError`。
        // P5-1 加入稀疏一路之后，这里会变成「降级到 sparse 结果」的返回路径。
        const hits = await searchDense({
          vector: embedded.vector,
          scope: req.scope,
          limit: coarseLimit,
          filters: req.filters,
          embeddingModel: embedder.identity.model,
        });
        denseSpan.setAttribute("resultCount", hits.length);
        denseSpan.end("ok");

        totalCandidates = hits.length;
        results = hits.slice(0, topK).map(toRetrievedChunk);
      } else {
        denseSpan.end("error");
        // 向量化失败有退路（返回空结果 + 降级标记）：UI 能解释「为什么是空的」，
        // MCP 客户端能提示，评测能把它计入 fallback_rate，而不是整条请求 500。
        degraded = { reason: "embedding_unavailable", detail: messageOf(embedded.error) };
        strategy = "fallback";
        telemetry.recordDegradation("embedding_unavailable", {
          model: embedder.identity.model,
        });
      }

      stageMs["retrieve.dense"] = clock() - denseStartedAt;
    }

    const latencyMs = clock() - startedAt;
    const trace: RagTraceSummary = {
      traceId,
      latencyMs,
      stageMs,
      // embedding 不算 LLM 调用：`llmCalls` 统计的是改写 / 生成这类语言模型调用。
      llmCalls: 0,
      ...(tokens > 0 ? { tokens: { input: tokens, output: 0 } } : {}),
    };

    span.setAttribute("resultCount", results.length);
    span.setAttribute("empty", results.length === 0);
    span.setAttribute("fallback", degraded !== undefined);
    span.end("ok");

    // 三个 gauge 是「每查询一个样本」的形态，聚合交给后端。
    telemetry.recordMetric("rag.query.latency", latencyMs);
    telemetry.recordMetric("rag.recall.empty_rate", results.length === 0 ? 1 : 0);
    telemetry.recordMetric("rag.fallback_rate", degraded ? 1 : 0);

    return {
      query: req.query,
      strategy,
      results,
      totalCandidates,
      ...(degraded ? { degraded } : {}),
      trace,
    };
  }

  /** 单独包一层：把「向量化失败」变成返回值，其余错误照旧冒泡。 */
  async function embedQuery(
    query: string,
  ): Promise<{ ok: true; vector: number[]; tokens: number } | { ok: false; error: unknown }> {
    try {
      const embedded = await embedder.embed([query]);
      const vector = embedded.vectors[0];
      if (!vector) {
        return { ok: false, error: new RagDependencyError("embedder returned no query vector") };
      }
      return { ok: true, vector, tokens: embedded.tokens ?? 0 };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * 稠密检索失败 → `RagDependencyError`。
   *
   * 包一层是为了**统一错误码**：第三方向量库会把自家的错误类型抛出来，
   * 而调用方（API route / MCP tool）需要的是稳定的 `code`。
   */
  async function searchDense(query: DenseQuery): Promise<DenseHit[]> {
    try {
      return await denseIndex.search(query);
    } catch (error) {
      if (error instanceof RagError) throw error;
      throw new RagDependencyError(`dense retrieval failed: ${messageOf(error)}`, {
        cause: error,
      });
    }
  }

  // ── 健康检查 ─────────────────────────────────────────────────────

  async function health(): Promise<RagHealth> {
    try {
      const chunks = await denseIndex.size();
      return {
        // 索引为空 = 还不能服务检索，但组件本身是通的 —— 这是一个需要被看见的
        // 中间态，所以报 degraded 而不是 ok。
        status: chunks > 0 ? "ok" : "degraded",
        details: {
          chunks,
          embedder: embedder.identity.model,
          embeddingDim: embedder.identity.dim,
          providers: providerNames,
          config: { topK: config.topK, coarseRankTopK: config.coarseRankTopK },
        },
      };
    } catch (error) {
      // 健康检查自己绝不能抛：它存在的意义就是在故障时仍能回答。
      return { status: "unavailable", details: { error: messageOf(error) } };
    }
  }

  return { index, retrieve, health };
}

// ───────────────────────────────────────────────────────────────────
// 内部工具
// ───────────────────────────────────────────────────────────────────

/**
 * `DenseHit` → 对外契约。
 *
 * 分数映射 `(-1..1) → (0..1)`：契约承诺 `score` 是 0-1，而余弦原值可以是负数。
 * 这个单调映射只是**单路占位**，P5-1 的融合阶段会用它自己的分数取代。
 */
function toRetrievedChunk(hit: DenseHit): RetrievedChunk {
  return {
    chunkKey: hit.chunkKey,
    repositoryId: hit.repositoryId,
    level: hit.level,
    method: hit.fields?.method,
    path: hit.fields?.path,
    summary: hit.fields?.summary,
    score: (hit.score + 1) / 2,
    coarseScore: hit.score,
  };
}

/** 摄取失败一律带稳定的 `code`，调用方（API route / 任务队列）不必解析 message。 */
function asIngestError(repositoryId: string, error: unknown): Error {
  if (error instanceof RagError) return error;
  return new RagIngestError(`failed to index repository ${repositoryId}: ${messageOf(error)}`, {
    cause: error,
  });
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
