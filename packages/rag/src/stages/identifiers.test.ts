import { describe, it, expect } from "vitest";
import { normalizeIdentifiers } from "./identifiers";

describe("normalizeIdentifiers", () => {
  it("splits a path + method into lowercase terms", () => {
    expect(normalizeIdentifiers("POST /orders/{id}/refund")).toEqual([
      "post",
      "orders",
      "id",
      "refund",
    ]);
  });

  it("keeps CJK path segments whole", () => {
    expect(normalizeIdentifiers("GET /订单/{id}/发货单")).toEqual(["get", "订单", "id", "发货单"]);
  });

  it("dedupes while preserving order (标识符权重来自 setweight 区段，不靠词频)", () => {
    expect(normalizeIdentifiers("refund refund REFUND order")).toEqual(["refund", "order"]);
  });

  it("returns an empty list for separators and whitespace only", () => {
    expect(normalizeIdentifiers("  /{}_-:.  ")).toEqual([]);
  });

  it("normalises dashes, underscores and dots used by operationIds", () => {
    expect(normalizeIdentifiers("refund.order-v2_final")).toEqual([
      "refund",
      "order",
      "v2",
      "final",
    ]);
  });

  it("does NOT split camelCase（有意不做，见文件头；要加就得改口径并 REINDEX）", () => {
    expect(normalizeIdentifiers("refundOrder")).toEqual(["refundorder"]);
  });
});
