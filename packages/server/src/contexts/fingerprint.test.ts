import { describe, expect, it } from "vitest";
import { computeEndpointFingerprint, endpointKey } from "./fingerprint";

describe("endpointKey", () => {
  it("prefers operationId over method + path", () => {
    expect(
      endpointKey({ operationId: "getOrders", method: "GET", path: "/orders" }),
    ).toBe("getOrders");
    expect(
      endpointKey({ operationId: null, method: "POST", path: "/orders" }),
    ).toBe("POST /orders");
  });
});

describe("computeEndpointFingerprint", () => {
  const base = {
    operationId: null,
    method: "GET",
    path: "/orders",
    summary: "List orders",
    description: null,
    parameters: [],
    requestSchema: null,
    responses: [],
  };

  it("is stable for identical input", () => {
    expect(computeEndpointFingerprint(base)).toBe(
      computeEndpointFingerprint({ ...base }),
    );
  });

  it("changes when the schema changes", () => {
    const changed = {
      ...base,
      requestSchema: { type: "object", properties: { a: { type: "string" } } },
    };
    expect(computeEndpointFingerprint(changed)).not.toBe(
      computeEndpointFingerprint(base),
    );
  });

  it("is insensitive to response ordering", () => {
    const a = {
      ...base,
      responses: [
        { statusCode: "200", contentType: "application/json", schema: { a: 1 } },
        { statusCode: "400", contentType: null, schema: null },
      ],
    };
    const b = {
      ...base,
      responses: [
        { statusCode: "400", contentType: null, schema: null },
        { statusCode: "200", contentType: "application/json", schema: { a: 1 } },
      ],
    };
    expect(computeEndpointFingerprint(a)).toBe(
      computeEndpointFingerprint(b),
    );
  });
});
