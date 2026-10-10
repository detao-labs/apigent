// ═══════════════════════════════════════════════════════════════════
// Pipeline — 对账式同步（P4-6）
// ═══════════════════════════════════════════════════════════════════
//
// 这一组用例钉住四件事，每一件都对应一个「看起来正常、实际错」的失败模式：
//   1. 删除的接口**不再被任何检索路径召回**（P4-6 的验收项）；
//   2. 删除只影响**本 commit**（内容寻址的行是跨 commit 共享的）；
//   3. **部分重索引不删除任何东西**（P4-1 的约束：那次运行的期望集合不完整）；
//   4. 同一份内容跨 commit 复用**不重算向量**，只补 link。
//
// 用内存替身 + 手写文档源跑，不连 DB：对账是**管线**的逻辑，SQL 侧只提供
// 「列出身份」「挂 link」「解除引用」三个原语（各自的适配器测试在 adapters/）。
// ═══════════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import type {
  DenseChunkLink,
  DenseIndex,
  DenseUnlinkSelector,
  Embedder,
  RagDocument,
  RagDocumentSource,
  RagScope,
  RagService,
} from "../contracts";
import { contentHashOf } from "../content-hash";
import { hierarchicalChunker } from "../stages/chunker";
import { hashEmbedder } from "../testing/hash-embedder";
import { memoryIndex } from "../testing/memory-index";
import { createStageRegistry } from "./registry";
import { createRagService } from "./service";

const REPO = "repo-reconcile";
const COMMIT_A = "commit-a";
const COMMIT_B = "commit-b";

function endpointDoc(id: string, text: string, path = id): RagDocument {
  return {
    id,
    level: "endpoint",
    lang: /[\u4e00-\u9fff]/.test(text) ? "zh" : "en",
    organizationId: "org-reconcile",
    text,
    fields: { method: "GET", path },
  };
}

const REFUND = endpointDoc("endpoint:POST:/orders/{id}/refund", "退款接口：对已支付订单发起退款。");
const SHIPMENT = endpointDoc(
  "endpoint:GET:/shipments/{id}",
  "发货单查询接口：按单号查询物流轨迹。",
);

/** 记录适配器调用：对账的**语义**只能在「发给索引的原语」这一层断言。 */
function recordingIndex(inner: DenseIndex) {
  const unlinked: DenseUnlinkSelector[] = [];
  const linked: DenseChunkLink[][] = [];

  return {
    unlinked,
    linked,
    index: {
      upsert: (records: Parameters<DenseIndex["upsert"]>[0]) => inner.upsert(records),
      search: (query: Parameters<DenseIndex["search"]>[0]) => inner.search(query),
      unlink: (selector: DenseUnlinkSelector) => {
        unlinked.push(selector);
        return inner.unlink(selector);
      },
      dropRepository: (repositoryId: string) => inner.dropRepository(repositoryId),
      size: () => inner.size(),
      listIdentities: (scope: Parameters<DenseIndex["listIdentities"]>[0]) =>
        inner.listIdentities(scope),
      link: (links: readonly DenseChunkLink[]) => {
        linked.push([...links]);
        return inner.link(links);
      },
    } satisfies DenseIndex,
  };
}

/** 只统计「送进 embedding 的文本条数」——复用是否真的省下钱，看它。 */
function countingEmbedder(): { embedder: Embedder; embeddedTexts: string[] } {
  const inner = hashEmbedder();
  const embeddedTexts: string[] = [];

  return {
    embeddedTexts,
    embedder: {
      identity: inner.identity,
      async embed(texts) {
        embeddedTexts.push(...texts);
        return inner.embed(texts);
      },
    },
  };
}

function buildService(options: { documents: RagDocument[]; source?: RagDocumentSource }): {
  service: RagService;
  index: DenseIndex;
  recorder: ReturnType<typeof recordingIndex>;
  embeddedTexts: string[];
} {
  const recorder = recordingIndex(memoryIndex());
  const { embedder, embeddedTexts } = countingEmbedder();
  const source: RagDocumentSource =
    options.source ??
    ({
      async load() {
        return structuredClone(options.documents);
      },
    } satisfies RagDocumentSource);

  // 装配走真正的注册表（不是直接塞实例）：P4-6 的对账跑在管线里，替身必须从
  // 与生产同一条装配路径进来，否则测的不是同一段代码。
  const registry = createStageRegistry();
  registry.register("documentSource", "fixture", () => source);
  registry.register("embedder", "hash", () => embedder);
  registry.register("denseIndex", "memory", () => recorder.index);

  const service = createRagService({
    registry,
    providers: {
      documentSource: { name: "fixture" },
      embedder: { name: "hash" },
      denseIndex: { name: "memory" },
    },
    chunker: hierarchicalChunker(),
    deps: {},
  });

  return { service, index: recorder.index, recorder, embeddedTexts };
}

const scope = (commitIds = [COMMIT_A]): RagScope => ({ repositoryIds: [REPO], commitIds });

async function recall(service: RagService, query: string, commitIds?: string[]): Promise<string[]> {
  const result = await service.retrieve({ query, scope: scope(commitIds) });
  return result.results.map((hit) => hit.chunkKey);
}

/**
 * 只数**这次摄取**送进 embedding 的文本。
 *
 * 不能直接看累计值：`retrieve()` 也要算查询向量，累计值里混着它。用调用前后的
 * 差值，量的才是「这次索引重算了多少条」。
 */
async function indexWith(
  service: RagService,
  req: Parameters<RagService["index"]>[0],
  embeddedTexts: string[],
): Promise<{ report: Awaited<ReturnType<RagService["index"]>>; embedded: number }> {
  const before = embeddedTexts.length;
  const report = await service.index(req);
  return { report, embedded: embeddedTexts.length - before };
}

describe("P4-6 对账式同步", () => {
  it("删除接口后该 chunk 不再被召回（验收项），未变内容原样保留", async () => {
    const documents = [REFUND, SHIPMENT];
    const { service, embeddedTexts } = buildService({ documents });

    const first = await indexWith(
      service,
      { repositoryId: REPO, commitId: COMMIT_A },
      embeddedTexts,
    );
    expect(await recall(service, "发货单")).toContain(SHIPMENT.id);
    // 首次全量：两条都送进 embedding
    expect(first.embedded).toBe(2);

    documents.splice(documents.indexOf(SHIPMENT), 1);
    const { report, embedded } = await indexWith(
      service,
      { repositoryId: REPO, commitId: COMMIT_A },
      embeddedTexts,
    );

    expect(report.chunksDeleted).toBe(1);
    expect(report.chunksWritten).toBe(0);
    expect(report.chunksSkipped).toBe(1);
    // 这次一条都没送进 embedding —— 删除不该顺带重算未变内容
    expect(embedded).toBe(0);
    expect(await recall(service, "发货单")).not.toContain(SHIPMENT.id);
    expect(await recall(service, "退款")).toContain(REFUND.id);
  });

  it("删除只解除本 commit 的引用：另一个 commit 仍能召回（内容寻址的共享行）", async () => {
    const documents = [REFUND, SHIPMENT];
    const { service, index } = buildService({ documents });

    await service.index({ repositoryId: REPO, commitId: COMMIT_A });
    await service.index({ repositoryId: REPO, commitId: COMMIT_B });
    // 同一个 (key, hash) 被两个 commit 引用 → 仍然只有一行
    expect(await index.size()).toBe(2);

    documents.splice(documents.indexOf(SHIPMENT), 1);
    const report = await service.index({ repositoryId: REPO, commitId: COMMIT_B });

    expect(report.chunksDeleted).toBe(1);
    // B 上查不到，A 上照样查得到 —— 行被 A 的 link 保住了（GC 只在末位引用消失时发生）
    expect(await recall(service, "发货单", [COMMIT_B])).not.toContain(SHIPMENT.id);
    expect(await recall(service, "发货单", [COMMIT_A])).toContain(SHIPMENT.id);
    expect(await index.size()).toBe(2);
  });

  it("内容变更（同 key 新 hash）只解绑旧内容，不解绑整个 key", async () => {
    const documents = [REFUND];
    const { service, recorder } = buildService({ documents });

    await service.index({ repositoryId: REPO, commitId: COMMIT_A });
    const oldHash = contentHashOf(REFUND.text);

    documents[0] = endpointDoc(REFUND.id, "退款接口：支持部分退款与全额退款，1-3 个工作日到账。");
    const report = await service.index({ repositoryId: REPO, commitId: COMMIT_A });

    expect(report.chunksWritten).toBe(1);
    expect(report.chunksDeleted).toBe(1);
    // 解绑的是**旧内容**（key+hash），这正是「改了摘要」能安全生效的原因
    const unlinked = recorder.unlinked.at(-1);
    expect(unlinked?.chunks).toEqual([{ chunkKey: REFUND.id, contentHash: oldHash }]);
  });

  it("部分重索引不删除任何东西（期望集合不完整，差集必然误删）", async () => {
    // 这个源**真的**按 req.endpoints 过滤 —— 与生产 doc source 一致：被删掉的接口
    // 不会出现在输出里，所以拿它做差集就会把「没被重索引的接口」误判成已删除。
    const source: RagDocumentSource = {
      async load(req) {
        const all = [REFUND, SHIPMENT];
        if (!req.endpoints || req.endpoints.length === 0) return structuredClone(all);
        return structuredClone(all.filter((doc) => req.endpoints?.includes(doc.id)));
      },
    };
    const { service, recorder } = buildService({ documents: [], source });

    await service.index({ repositoryId: REPO, commitId: COMMIT_A });
    const report = await service.index({
      repositoryId: REPO,
      commitId: COMMIT_A,
      endpoints: [REFUND.id],
    });

    expect(report.chunksDeleted).toBe(0);
    expect(recorder.unlinked).toHaveLength(0);
    // SHIPMENT 这次根本没参与索引，但它一条都还在
    expect(await recall(service, "发货单")).toContain(SHIPMENT.id);
  });

  it("跨 commit 复用：只补 link、不重算向量", async () => {
    const documents = [REFUND, SHIPMENT];
    const { service, recorder, embeddedTexts, index } = buildService({ documents });

    const first = await indexWith(
      service,
      { repositoryId: REPO, commitId: COMMIT_A },
      embeddedTexts,
    );
    expect(first.embedded).toBe(2);

    const { report, embedded } = await indexWith(
      service,
      { repositoryId: REPO, commitId: COMMIT_B },
      embeddedTexts,
    );

    expect(report.chunksWritten).toBe(0);
    expect(report.chunksSkipped).toBe(2);
    expect(embedded).toBe(0); // 一个新向量都没算
    expect(recorder.linked.at(-1)).toHaveLength(2);
    expect(await index.size()).toBe(2);
    // B 也能召回了 —— 之所以成立，靠的就是那两条新 link
    expect(await recall(service, "退款", [COMMIT_B])).toContain(REFUND.id);
    expect(await index.listIdentities({ repositoryId: REPO, commitId: COMMIT_B })).toHaveLength(2);
  });

  it("不带 commitId：只做复用判断，不写 link、也不做删除对账", async () => {
    const documents = [REFUND, SHIPMENT];
    const { service, recorder, index } = buildService({ documents });

    const first = await service.index({ repositoryId: REPO });
    const second = await service.index({ repositoryId: REPO });

    expect(first.chunksWritten).toBe(2);
    expect(second.chunksSkipped).toBe(2);
    expect(recorder.linked).toHaveLength(0);
    expect(recorder.unlinked).toHaveLength(0);
    // 没有 link = 任何按 commit 收窄的检索都查不到（fail-closed，P0-4）
    expect(await recall(service, "退款")).toEqual([]);
    expect(await index.listIdentities({ repositoryId: REPO, commitId: COMMIT_A })).toEqual([]);
  });
});
