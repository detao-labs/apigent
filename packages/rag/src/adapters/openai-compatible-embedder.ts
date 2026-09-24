// ═══════════════════════════════════════════════════════════════════
// RAG Adapter — OpenAI 兼容的 Embedding（P4-3）
// ═══════════════════════════════════════════════════════════════════
//
// 「文本 → 向量」的生产实现。qwen（DashScope 兼容端点）是首选，但代码针对的是
// **OpenAI 兼容协议**本身 —— openai / cohere / 自建网关都走同一条路，差别只是
// baseURL / model / dimensions（P0-1 定案：调用模型服务的能力在 `@apigent/core/ai`，
// 这里只做 RAG 专属的 embedding 语义）。
//
// 三件事必须由这一层负责，不能推给调用方：
//
// 1. **批次与并发**。单次请求塞几百条文本会被 provider 拒或超时；这里按
//    `maxBatchSize` 切批、按 `concurrency` 并发，且**保持入参顺序**（向量与文本
//    错位是致命的静默错误：A 的向量写到 B 的内容上，检索看起来正常但全是错的）。
// 2. **维度校验**（P0-2）。模型不认 `dimensions` 参数时会返回别的长度 —— 那会让
//    整列 `vector(1024)` 写入失败或（更糟）静默混入不同维度的向量。这里逐条校验并
//    抛错，绝不「先写进去再说」。
// 3. **失败要带上下文**。哪个模型、第几批、这批多少条 —— 没有这些信息的报错在
//    生产里等于没有报错。**不吞异常、不返回部分结果**：部分失败 = 索引缺一块内容，
//    而对账式同步会以为「这些内容本来就不存在」。
// ═══════════════════════════════════════════════════════════════════

import { embedMany, type EmbeddingModel } from "ai";
import {
  createOpenAICompatibleProvider,
  DASHSCOPE_COMPATIBLE_BASE_URL,
  type OpenAICompatibleTransport,
} from "@apigent/core/ai";
import { RagDependencyError, type Embedder, type EmbedResult } from "../contracts";

/** P0-2 定案：一个部署只有一个活跃模型，维度固定 1024。 */
export const EMBEDDING_DIMENSIONS = 1024;

export interface OpenAICompatibleEmbedderOptions {
  /** AI SDK 的 embedding 模型（宿主用 `createOpenAICompatibleProvider()` 造） */
  model: EmbeddingModel;
  /** 身份串，形如 `qwen:text-embedding-v4` —— 落进 `knowledge_chunks.embedding_model` */
  modelIdentity: string;
  /** provider 选项命名空间（= `createOpenAICompatible({ name })` 的 name） */
  providerOptionsName?: string;
  /** 维度；默认 1024（P0-2） */
  dimensions?: number;
  /** 单批条数上限；默认 10（DashScope 对 text-embedding-v4 的批量上限是 25，留余量） */
  maxBatchSize?: number;
  /** 并发批次数；默认 2（摄取是后台任务，避免把配额打满影响在线检索） */
  concurrency?: number;
  /** 每批的重试次数，透传给 AI SDK；默认 2 */
  maxRetries?: number;
}

/**
 * 通用实现：任意 OpenAI 兼容 provider 的 embedding，带批次 / 并发 / 校验。
 */
export function openAICompatibleEmbedder(options: OpenAICompatibleEmbedderOptions): Embedder {
  const dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  const maxBatchSize = options.maxBatchSize ?? 10;
  const concurrency = options.concurrency ?? 2;
  const maxRetries = options.maxRetries ?? 2;
  const identity = { model: options.modelIdentity, dim: dimensions };

  if (maxBatchSize < 1) {
    throw new RagDependencyError("embedder: maxBatchSize must be >= 1");
  }
  if (concurrency < 1) {
    throw new RagDependencyError("embedder: concurrency must be >= 1");
  }

  return {
    identity,

    async embed(texts: string[]): Promise<EmbedResult> {
      if (texts.length === 0) return { vectors: [], tokens: 0 };

      const batches = chunk(texts, maxBatchSize);
      const results = await mapWithConcurrency(batches, concurrency, async (batch, batchIndex) => {
        try {
          const response = await embedMany({
            model: options.model,
            values: batch,
            maxRetries,
            ...(options.providerOptionsName
              ? { providerOptions: { [options.providerOptionsName]: { dimensions } } }
              : {}),
          });
          return { embeddings: response.embeddings, tokens: response.usage?.tokens ?? 0 };
        } catch (error) {
          // 带上「模型 + 第几批 + 本批条数」：否则线上只能看到一句 provider 的原文。
          throw new RagDependencyError(
            `embedder: ${identity.model} failed on batch ${batchIndex + 1}/${batches.length} ` +
              `(${batch.length} texts). ` +
              `Underlying error: ${messageOf(error)}`,
            { cause: error },
          );
        }
      });

      // 顺序：批次结果按批序拼回 —— 并发只影响执行顺序，不影响返回顺序。
      const vectors: number[][] = [];
      let tokens = 0;
      for (const [batchIndex, result] of results.entries()) {
        const expected = batches[batchIndex]?.length ?? 0;
        if (result.embeddings.length !== expected) {
          throw new RagDependencyError(
            `embedder: ${identity.model} returned ${result.embeddings.length} vectors for ` +
              `${expected} texts (batch ${batchIndex + 1}/${batches.length}); ` +
              "refusing to continue because vector/text misalignment silently corrupts the index.",
          );
        }
        for (const vector of result.embeddings) {
          if (vector.length !== dimensions) {
            throw new RagDependencyError(
              `embedder: ${identity.model} returned a ${vector.length}-dimensional vector, ` +
                `expected ${dimensions} (P0-2 pins the dimension; a mismatched model must not ` +
                "be indexed silently).",
            );
          }
          vectors.push(vector);
        }
        tokens += result.tokens;
      }

      return { vectors, tokens };
    },
  };
}

export interface QwenEmbedderOptions {
  apiKey?: string;
  /** 默认 DashScope 的 OpenAI 兼容端点 */
  baseUrl?: string;
  /** 默认 `text-embedding-v4`（原生 1024 维，与 P0-2 的固定维度对齐） */
  model?: string;
  dimensions?: number;
  maxBatchSize?: number;
  concurrency?: number;
  maxRetries?: number;
}

/** qwen（DashScope 兼容端点）的 embedding —— 项目默认。 */
export function qwenEmbedder(options: QwenEmbedderOptions = {}): Embedder {
  const modelId = options.model ?? "text-embedding-v4";
  const transport: OpenAICompatibleTransport = {
    name: "qwen",
    baseURL: options.baseUrl ?? DASHSCOPE_COMPATIBLE_BASE_URL,
    apiKey: options.apiKey,
  };

  const provider = createOpenAICompatibleProvider(transport);

  return openAICompatibleEmbedder({
    model: provider.embeddingModel(modelId),
    modelIdentity: `qwen:${modelId}`,
    providerOptionsName: transport.name,
    ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }),
    ...(options.maxBatchSize === undefined ? {} : { maxBatchSize: options.maxBatchSize }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    ...(options.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
  });
}

// ───────────────────────────────────────────────────────────────────
// 内部
// ───────────────────────────────────────────────────────────────────

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    batches.push(items.slice(offset, offset + size));
  }
  return batches;
}

/**
 * 有界并发 map：结果顺序与入参一致（与 `Promise.all` 相同），但同时在飞的 promise
 * 不超过 `concurrency` 个。
 *
 * 为什么不用 `Promise.all` 分批跑：那样每批之间会有一次「等最慢的那个」的抖动，
 * 而且并发度其实是 batchSize × concurrency。这里是自己起 worker 的经典写法，
 * 依赖 AI SDK 的 `maxRetries` 负责重试。
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      const item = items[index] as T;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
