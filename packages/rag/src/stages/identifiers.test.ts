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

  it("dedupes while preserving order (identifier weight comes from the setweight section)", () => {
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

  it("does NOT split camelCase (deliberate: changing that would require a REINDEX)", () => {
    expect(normalizeIdentifiers("refundOrder")).toEqual(["refundorder"]);
  });
});
