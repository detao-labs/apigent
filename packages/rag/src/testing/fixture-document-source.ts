// ═══════════════════════════════════════════════════════════════════
// Testing — fixtureDocumentSource（固定语料文档源）
// ═══════════════════════════════════════════════════════════════════
//
// `RagDocumentSource` 的确定性替身：一份手写的小语料，覆盖
// **中英双语、分层 parent、跨仓库、跨组织** 四种形态，让 Phase 2 的端到端
// 检索、Phase 7 的评测、以及权限不变量测试都不必连数据库。
//
// 语料的设计意图（不是随手写的示例）：
//   - 中文领域词 `退款` / `发货单` / `优惠券` —— P0-3 spike 用的就是这类词，
//     用来验证分词与召回（「发货」必须能命中「发货单」）；
//   - 同一接口的中英双 chunk 共享 `parentId` —— 验证双语策略与上下文扩展；
//   - `repo-legacy` 里有一条 `退款` 文档，属于**另一个组织** —— 用来钉住
//     「scope 里没有的仓库，一条都查不出来」这条权限不变量。
//
// 两处有意的近似（都写在这里，避免读者以为替身与生产同语义）：
//   1. 忽略 `IndexRequest.endpoints`（部分重索引）—— 返回全集是**安全方向**的
//      近似：期望集合是超集，对账式同步不会因此误删任何 chunk；
//   2. `load()` 会校验 `scope.repositoryIds`，越权的 repo 直接返回空
//      （生产里这一步由调用方保证，替身顺手把它变成可断言的行为）。
// ═══════════════════════════════════════════════════════════════════

import type { RagDocument, RagDocumentSource, IndexRequest } from "../contracts";

export const FIXTURE_ORG_MAIN = "org-demo";
export const FIXTURE_ORG_OTHER = "org-other";

export const FIXTURE_REPO_CHECKOUT = "repo-checkout";
export const FIXTURE_REPO_BILLING = "repo-billing";
export const FIXTURE_REPO_LEGACY = "repo-legacy";

/** 固定语料，按 repositoryId 分组。 */
export const FIXTURE_DOCUMENTS: Record<string, RagDocument[]> = {
  [FIXTURE_REPO_CHECKOUT]: [
    {
      id: "tag:orders",
      level: "tag",
      lang: "zh",
      organizationId: FIXTURE_ORG_MAIN,
      text: "订单能力：覆盖下单、支付、退款、发货单与优惠券核销。",
      metadata: { tag: "订单" },
    },
    {
      id: "tag:orders:en",
      level: "tag",
      lang: "en",
      organizationId: FIXTURE_ORG_MAIN,
      text: "Order capabilities: create, pay, refund, shipment and coupon redemption.",
      metadata: { tag: "orders" },
    },
    {
      id: "endpoint:POST:/orders/{id}/refund",
      level: "endpoint",
      lang: "zh",
      organizationId: FIXTURE_ORG_MAIN,
      parentId: "tag:orders",
      text: "退款接口：对已支付的订单发起退款，支持部分退款与全额退款。退款到账时间取决于支付渠道，通常 1-3 个工作日。",
      fields: {
        method: "POST",
        path: "/orders/{id}/refund",
        summary: "发起退款",
        tags: ["订单", "退款"],
      },
      metadata: { operationId: "refundOrder" },
    },
    {
      id: "endpoint:POST:/orders/{id}/refund:en",
      level: "endpoint",
      lang: "en",
      organizationId: FIXTURE_ORG_MAIN,
      parentId: "tag:orders:en",
      text: "Refund endpoint: refunds a paid order. Supports partial and full refunds.",
      fields: {
        method: "POST",
        path: "/orders/{id}/refund",
        summary: "Create a refund",
        tags: ["orders", "refund"],
      },
      metadata: { operationId: "refundOrder" },
    },
    {
      id: "endpoint:GET:/shipments/{id}",
      level: "endpoint",
      lang: "zh",
      organizationId: FIXTURE_ORG_MAIN,
      parentId: "tag:orders",
      text: "发货单查询接口：按发货单号查询物流轨迹与签收状态。",
      fields: {
        method: "GET",
        path: "/shipments/{id}",
        summary: "查询发货单",
        tags: ["订单", "发货单"],
      },
      metadata: { operationId: "getShipment" },
    },
    {
      id: "endpoint:POST:/coupons/{id}/redeem",
      level: "endpoint",
      lang: "zh",
      organizationId: FIXTURE_ORG_MAIN,
      parentId: "tag:orders",
      text: "优惠券核销接口：校验优惠券有效性并核销，返回本单抵扣金额。",
      fields: {
        method: "POST",
        path: "/coupons/{id}/redeem",
        summary: "核销优惠券",
        tags: ["订单", "优惠券"],
      },
      metadata: { operationId: "redeemCoupon" },
    },
  ],
  [FIXTURE_REPO_BILLING]: [
    {
      id: "endpoint:GET:/invoices/{id}",
      level: "endpoint",
      lang: "zh",
      organizationId: FIXTURE_ORG_MAIN,
      text: "账单查询接口：查询账单明细、应付金额与开票状态。",
      fields: {
        method: "GET",
        path: "/invoices/{id}",
        summary: "查询账单",
        tags: ["账单"],
      },
      metadata: { operationId: "getInvoice" },
    },
  ],
  [FIXTURE_REPO_LEGACY]: [
    {
      id: "endpoint:GET:/legacy/refund",
      level: "endpoint",
      lang: "en",
      organizationId: FIXTURE_ORG_OTHER,
      text: "Legacy refund endpoint: the deprecated refund flow, kept for old integrations.",
      fields: {
        method: "GET",
        path: "/legacy/refund",
        summary: "Legacy refund",
        tags: ["legacy", "refund"],
      },
      metadata: { operationId: "legacyRefund" },
    },
  ],
};

export interface FixtureDocumentSourceOptions {
  /** 覆盖默认语料（按 repositoryId 分组）。 */
  documentsByRepository?: Record<string, RagDocument[]>;
  /**
   * 注入失败，用于测**摄取错误路径**。
   *
   * 注意区分：摄取失败是**抛错**（`RagIngestError` / 原样透出），不是降级 ——
   * 降级是检索侧的概念（`RetrieveResult.degraded`），因为检索有「退而求其次的
   * 结果」可返回，而摄取没有。
   */
  error?: Error;
}

export function fixtureDocumentSource(
  options: FixtureDocumentSourceOptions = {},
): RagDocumentSource {
  const corpus = options.documentsByRepository ?? FIXTURE_DOCUMENTS;

  return {
    async load(req: IndexRequest, scope: { repositoryIds: string[] }): Promise<RagDocument[]> {
      if (options.error) throw options.error;
      if (!scope.repositoryIds.includes(req.repositoryId)) return [];
      // 返回深拷贝：调用方（chunker / embedder）改了文档不会污染下一次 load。
      return structuredClone(corpus[req.repositoryId] ?? []);
    },
  };
}
