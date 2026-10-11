// ═══════════════════════════════════════════════════════════════════
// Pipeline — 摄取生命周期端到端（P4-8）
// ═══════════════════════════════════════════════════════════════════
//
// 这一组按**真实使用顺序**把摄取跑一遍，而不是逐个阶段测：仓库内容变化
// （新增接口 / 改正文 / 删接口）→ 提交新 commit → 再检索。
//
// 与其他用例的分工：
//   - `service.test.ts` 逐条钉契约与错误语义；
//   - `reconcile.test.ts` 钉对账**原语**的调用语义（解绑哪一份内容、link 补在哪）；
//   - `e2e.test.ts` 钉「读路径」整链路（检索 / 降级 / trace）；
//   - 这里钉「写路径」整链路，五个场景与任务清单 P4-8 逐条对应：
//     首次全量 / 增量（含单接口部分重索引）/ 删除 / 版本切换 / 失败重试。
//
// 断言的落点是**钱与结果**：这次索引重算了几个向量（embeddedTexts 差值）、
// 写/跳过/解绑各几条（IndexReport）、以及检索现在能不能召回。
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import {
  RagIngestError,
  type DenseIndex,
  type Embedder,
  type RagDocument,
  type RagDocumentSource,
  type RagService,
} from "../contracts";
import { contentHashOf } from "../content-hash";
import { hierarchicalChunker } from "../stages/chunker";
import { hashEmbedder } from "../testing/hash-embedder";
import { memoryIndex } from "../testing/memory-index";
import { createStageRegistry } from "./registry";
import { createRagService } from "./service";

const REPO = "repo-ingest";
const ORG = "org-ingest";
const COMMIT_A = "commit-a";
const COMMIT_B = "commit-b";

function endpointDoc(id: string, text: string): RagDocument {
  return {
    id,
    level: "endpoint",
    lang: /[\u4e00-\u9fff]/.test(text) ? "zh" : "en",
    organizationId: ORG,
    text,
    fields: {
      method: id.includes("POST") ? "POST" : "GET",
      path: id.split(":")[2],
      tags: ["交易"],
    },
  };
}

const REFUND_V1 = "退款接口：对已支付订单发起退款，支持部分退款与全额退款，1-3 个工作日到账。";
const REFUND_V2 = "退款接口：对已支付订单发起退款，支持部分退款与全额退款，实时到账。";

const REFUND = endpointDoc("endpoint:POST:/orders/{id}/refund", REFUND_V1);
const SHIPMENT = endpointDoc(
  "endpoint:GET:/shipments/{id}",
  "发货单查询接口：按单号查询物流轨迹与签收状态。",
);
const INVOICE = endpointDoc(
  "endpoint:GET:/invoices/{id}",
  "发票查询接口：按发票号查询开票金额与状态。",
);

/**
 * 仓库内容（= `endpoints` 表在某一时刻的样子）。
 *
 * 按 `req.endpoints` 过滤的行为与生产文档源一致：部分重索引时，**没被点名的接口
 * 根本不出现在输出里** —— 这正是「部分重索引不能做删除对账」的原因（P4-6）。
 */
function repoSource(documents: RagDocument[]): RagDocumentSource {
  return {
    async load(req) {
      if (!req.endpoints || req.endpoints.length === 0) return structuredClone(documents);
      const wanted = new Set(req.endpoints);
      return structuredClone(documents.filter((doc) => wanted.has(doc.id)));
    },
  };
}

interface Harness {
  service: RagService;
  index: DenseIndex;
  /** 累计送进 embedding 的文本 —— 断言「这次重算了几条」要看差值，不是累计值。 */
  embeddedTexts: string[];
  /** 下一次 embedding 调用抛错（模拟 provider 不可达 / 额度用尽）。 */
  failNextEmbed: () => void;
}

function harness(documents: RagDocument[]): Harness {
  const index = memoryIndex();
  const inner = hashEmbedder();
  const embeddedTexts: string[] = [];
  let shouldFail = false;

  const embedder: Embedder = {
    identity: inner.identity,
    async embed(texts) {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("dashscope unreachable");
      }
      embeddedTexts.push(...texts);
      return inner.embed(texts);
    },
  };

  // 走真正的注册表装配（不是直接塞实例）：对账跑在管线里，替身必须从与生产
  // 同一条路径进来，否则测的不是同一段代码。
  const registry = createStageRegistry();
  registry.register("documentSource", "repo", () => repoSource(documents));
  registry.register("embedder", "hash", () => embedder);
  registry.register("denseIndex", "memory", () => index);

  const service = createRagService({
    chunker: hierarchicalChunker(),
    registry,
    providers: {
      documentSource: { name: "repo" },
      embedder: { name: "hash" },
      denseIndex: { name: "memory" },
    },
    createTraceId: () => "ingest-trace",
  });

  return { service, index, embeddedTexts, failNextEmbed: () => (shouldFail = true) };
}

/** 只数**这次摄取**新算的向量数：`retrieve()` 也要算查询向量，累计值会混进它。 */
async function ingest(
  h: Harness,
  req: Parameters<RagService["index"]>[0],
): Promise<{ report: Awaited<ReturnType<RagService["index"]>>; embedded: number }> {
  const before = h.embeddedTexts.length;
  const report = await h.service.index(req);
  return { report, embedded: h.embeddedTexts.length - before };
}

async function recall(h: Harness, query: string, commitIds = [COMMIT_A]): Promise<string[]> {
  const result = await h.service.retrieve({
    query,
    scope: { repositoryIds: [REPO], commitIds },
  });
  return result.results.map((hit) => hit.chunkKey);
}

/** 某 commit 上某个 key 的**内容哈希** —— 用来区分「同一接口的旧版 / 新版正文」。 */
async function hashOf(h: Harness, chunkKey: string, commitId: string): Promise<string | undefined> {
  const identities = await h.index.listIdentities({ repositoryId: REPO, commitId });
  return identities.find((identity) => identity.chunkKey === chunkKey)?.contentHash;
}

describe("P4-8 摄取生命周期端到端", () => {
  it("首次全量：所有 chunk 都写入并挂到该 commit 上，重复跑不重算向量", async () => {
    const documents = [REFUND, SHIPMENT];
    const h = harness(documents);

    const first = await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });

    expect(first.report.chunksWritten).toBe(2);
    expect(first.report.chunksSkipped).toBe(0);
    expect(first.report.chunksDeleted).toBe(0);
    expect(first.report.tokens).toBeGreaterThan(0);
    expect(first.embedded).toBe(2);

    expect(await h.index.size()).toBe(2);
    expect(await h.index.listIdentities({ repositoryId: REPO, commitId: COMMIT_A })).toHaveLength(
      2,
    );
    expect(await recall(h, "退款")).toContain(REFUND.id);
    expect(await recall(h, "发货单")).toContain(SHIPMENT.id);

    // 同输入重复跑：全部命中复用 —— 账上表现为 0 次 embedding
    const again = await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });
    expect(again.report).toMatchObject({ chunksWritten: 0, chunksSkipped: 2, chunksDeleted: 0 });
    expect(again.embedded).toBe(0);
    expect(await h.index.size()).toBe(2);
  });

  it("增量：新增接口后全量重索引，只为新接口算向量", async () => {
    const documents = [REFUND, SHIPMENT];
    const h = harness(documents);
    await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });

    documents.push(INVOICE);
    const { report, embedded } = await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });

    // 差量计费：3 条里只有 1 条是新内容
    expect(report).toMatchObject({ chunksWritten: 1, chunksSkipped: 2, chunksDeleted: 0 });
    expect(embedded).toBe(1);
    expect(await recall(h, "发票")).toContain(INVOICE.id);
    // 未变的两条不受影响
    expect(await recall(h, "退款")).toContain(REFUND.id);
    expect(await recall(h, "发货单")).toContain(SHIPMENT.id);
  });

  it("增量（单接口部分重索引）：只碰被点名的接口，且一条都不删", async () => {
    const documents = [REFUND, SHIPMENT];
    const h = harness(documents);
    await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });

    const { report, embedded } = await ingest(h, {
      repositoryId: REPO,
      commitId: COMMIT_A,
      endpoints: [REFUND.id],
    });

    // 内容没变 → 一次 embedding 都不花；也**没有**因为「期望集合不完整」而误删
    expect(report).toMatchObject({ chunksWritten: 0, chunksSkipped: 1, chunksDeleted: 0 });
    expect(embedded).toBe(0);
    expect(await h.index.size()).toBe(2);
    expect(await h.index.listIdentities({ repositoryId: REPO, commitId: COMMIT_A })).toHaveLength(
      2,
    );
  });

  it("删除：接口从源里消失后，下一次全量重索引解除引用且不再召回", async () => {
    const documents = [REFUND, SHIPMENT];
    const h = harness(documents);
    await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });
    expect(await recall(h, "发货单")).toContain(SHIPMENT.id);

    documents.splice(documents.indexOf(SHIPMENT), 1);
    const { report, embedded } = await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });

    expect(report).toMatchObject({ chunksWritten: 0, chunksSkipped: 1, chunksDeleted: 1 });
    expect(embedded).toBe(0);
    expect(await recall(h, "发货单")).not.toContain(SHIPMENT.id);
    // 留下的接口照常召回，行数也只剩它
    expect(await recall(h, "退款")).toContain(REFUND.id);
    expect(await h.index.size()).toBe(1);
  });

  it("版本切换：内容未变时只补 link（新 commit 零重索引）", async () => {
    const documents = [REFUND, SHIPMENT];
    const h = harness(documents);
    await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });

    const { report, embedded } = await ingest(h, { repositoryId: REPO, commitId: COMMIT_B });

    expect(report).toMatchObject({ chunksWritten: 0, chunksSkipped: 2, chunksDeleted: 0 });
    expect(embedded).toBe(0);
    // 两行内容被两个 commit 共享 —— 行数不变，这才是「切版本不重索引」的收益
    expect(await h.index.size()).toBe(2);
    expect(await h.index.listIdentities({ repositoryId: REPO, commitId: COMMIT_B })).toHaveLength(
      2,
    );
    expect(await recall(h, "退款", [COMMIT_B])).toContain(REFUND.id);
  });

  it("版本切换：内容变更后新旧版本各自可召回（回滚不需要重索引）", async () => {
    const documents = [REFUND, SHIPMENT];
    const h = harness(documents);
    await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });

    // 改正文后提交新 commit：B 是一条新内容，A 上完全没动过
    documents[0] = endpointDoc(REFUND.id, REFUND_V2);
    const { report, embedded } = await ingest(h, { repositoryId: REPO, commitId: COMMIT_B });

    expect(report).toMatchObject({ chunksWritten: 1, chunksSkipped: 1, chunksDeleted: 0 });
    expect(embedded).toBe(1);
    // 同一个 key 现在有两行（内容寻址）：B 是新版，A 仍是旧版
    expect(await h.index.size()).toBe(3);
    expect(await hashOf(h, REFUND.id, COMMIT_B)).toBe(contentHashOf(REFUND_V2));
    expect(await hashOf(h, REFUND.id, COMMIT_A)).toBe(contentHashOf(REFUND_V1));

    // 「回滚」= 检索时换 scope，不产生任何写入 / embedding
    const beforeRollback = h.embeddedTexts.length;
    expect(await recall(h, "退款", [COMMIT_A])).toContain(REFUND.id);
    expect(await recall(h, "退款", [COMMIT_B])).toContain(REFUND.id);
    // 新增的只有两条**查询**向量：文档一条都没重算（否则回滚就要为整仓付一次 embedding）
    expect(h.embeddedTexts.slice(beforeRollback)).toEqual(["退款", "退款"]);
    expect(await h.index.size()).toBe(3);
  });

  it("失败重试：embedding 故障整轮失败（稳定错误码），重试后收敛且不重复写入", async () => {
    const documents = [REFUND, SHIPMENT];
    const h = harness(documents);
    await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });

    documents[0] = endpointDoc(REFUND.id, REFUND_V2);
    h.failNextEmbed();

    const failure = await ingest(h, { repositoryId: REPO, commitId: COMMIT_A }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(RagIngestError);
    expect((failure as RagIngestError).code).toBe("RAG_INGEST_FAILED");
    // 没有「部分成功」：新向量一条都没写进去。
    // 但失败发生的时点在**删除对账之后** —— 旧内容已经解绑，于是这个接口在本次
    // 提交上短暂「查不到」（不是查到错内容）。这条顺序问题是已知边界，重试即恢复；
    // 是否把 unlink 挪到 upsert 之后另议（见任务清单里的记录）。
    expect(await hashOf(h, REFUND.id, COMMIT_A)).toBeUndefined();
    expect(await recall(h, "退款")).not.toContain(REFUND.id);

    const retry = await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });

    expect(retry.report.chunksWritten).toBe(1);
    expect(retry.report.chunksSkipped).toBe(1);
    expect(retry.embedded).toBe(1);
    expect(await hashOf(h, REFUND.id, COMMIT_A)).toBe(contentHashOf(REFUND_V2));
    // 收敛：同一份内容只有一行，且下一次跑全部命中复用
    expect(await h.index.size()).toBe(2);
    const settled = await ingest(h, { repositoryId: REPO, commitId: COMMIT_A });
    expect(settled.report).toMatchObject({ chunksWritten: 0, chunksSkipped: 2 });
    expect(settled.embedded).toBe(0);
  });
});
