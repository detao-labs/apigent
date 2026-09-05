import { describe, it, expect } from "vitest";
import { diffVersionSnapshots, type VersionSnapshot } from "./engine";

const emptySnapshot: VersionSnapshot = {
  endpoints: [],
  schemas: [],
  components: [],
};

describe("diffVersionSnapshots", () => {
  it("returns no changes for identical snapshots", () => {
    const snap: VersionSnapshot = {
      endpoints: [
        {
          method: "GET",
          path: "/pets",
          summary: "List pets",
          parameters: [],
          hasRequestBody: false,
        },
      ],
      schemas: [],
      components: [],
    };
    const result = diffVersionSnapshots(snap, snap, "v1", "v2");
    expect(result.changes).toHaveLength(0);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.modified).toBe(0);
    expect(result.breaking).toBe(0);
  });

  it("marks added endpoint as compatible", () => {
    const from = emptySnapshot;
    const to: VersionSnapshot = {
      ...emptySnapshot,
      endpoints: [
        {
          method: "POST",
          path: "/orders",
          summary: "Create order",
          parameters: [],
          hasRequestBody: true,
        },
      ],
    };
    const result = diffVersionSnapshots(from, to, "v1", "v2");
    expect(result.added).toBe(1);
    expect(result.changes[0]).toMatchObject({
      category: "endpoint",
      changeType: "added",
      breaking: false,
    });
  });

  it("marks removed endpoint as breaking", () => {
    const from: VersionSnapshot = {
      ...emptySnapshot,
      endpoints: [
        {
          method: "DELETE",
          path: "/coupons/{id}",
          parameters: [{ name: "id", in: "path", required: true }],
          hasRequestBody: false,
        },
      ],
    };
    const result = diffVersionSnapshots(from, emptySnapshot, "v1", "v2");
    expect(result.removed).toBe(1);
    expect(result.breaking).toBe(1);
    expect(result.changes[0].changeType).toBe("removed");
  });

  it("marks endpoint with a new required param as breaking", () => {
    const base: VersionSnapshot = {
      ...emptySnapshot,
      endpoints: [
        {
          method: "POST",
          path: "/refund",
          parameters: [{ name: "order_id", in: "query", required: false }],
          hasRequestBody: true,
        },
      ],
    };
    const to: VersionSnapshot = {
      ...emptySnapshot,
      endpoints: [
        {
          method: "POST",
          path: "/refund",
          parameters: [
            { name: "order_id", in: "query", required: false },
            { name: "notify_url", in: "query", required: true },
          ],
          hasRequestBody: true,
        },
      ],
    };
    const result = diffVersionSnapshots(base, to, "v1", "v2");
    expect(result.modified).toBe(1);
    expect(result.breaking).toBe(1);
    expect(result.changes[0].fieldsChanged).toContain("param:notify_url");
  });

  it("marks schema with a new required field as breaking", () => {
    const from: VersionSnapshot = {
      ...emptySnapshot,
      schemas: [
        {
          name: "Order",
          schemaRaw: {
            properties: { amount: { type: "number" } },
            required: ["amount"],
          },
        },
      ],
    };
    const to: VersionSnapshot = {
      ...emptySnapshot,
      schemas: [
        {
          name: "Order",
          schemaRaw: {
            properties: {
              amount: { type: "number" },
              notify_url: { type: "string" },
            },
            required: ["amount", "notify_url"],
          },
        },
      ],
    };
    const result = diffVersionSnapshots(from, to, "v1", "v2");
    expect(result.modified).toBe(1);
    expect(result.breaking).toBe(1);
    expect(result.changes[0].fieldsChanged).toContain("prop:notify_url");
  });

  it("marks removed schema as breaking", () => {
    const from: VersionSnapshot = {
      ...emptySnapshot,
      schemas: [{ name: "Legacy", schemaRaw: { properties: {} } }],
    };
    const result = diffVersionSnapshots(from, emptySnapshot, "v1", "v2");
    expect(result.removed).toBe(1);
    expect(result.breaking).toBe(1);
  });

  it("marks removed component as breaking and added component as compatible", () => {
    const from: VersionSnapshot = {
      ...emptySnapshot,
      components: [{ kind: "response", name: "Error", payload: { description: "err" } }],
    };
    const to: VersionSnapshot = {
      ...emptySnapshot,
      components: [{ kind: "securityScheme", name: "Bearer", payload: { scheme: "bearer" } }],
    };
    const result = diffVersionSnapshots(from, to, "v1", "v2");
    expect(result.removed).toBe(1);
    expect(result.added).toBe(1);
    expect(result.breaking).toBe(1);
  });

  it("aggregates summary counts across categories", () => {
    const from: VersionSnapshot = {
      ...emptySnapshot,
      endpoints: [
        {
          method: "GET",
          path: "/pets",
          parameters: [{ name: "limit", in: "query", required: false }],
          hasRequestBody: false,
        },
      ],
    };
    const to: VersionSnapshot = {
      ...emptySnapshot,
      endpoints: [
        {
          method: "GET",
          path: "/pets",
          parameters: [
            { name: "limit", in: "query", required: false },
            { name: "page", in: "query", required: false },
          ],
          hasRequestBody: false,
        },
        {
          method: "POST",
          path: "/orders",
          parameters: [],
          hasRequestBody: true,
        },
      ],
    };
    const result = diffVersionSnapshots(from, to, "v1", "v2");
    expect(result.added).toBe(1);
    expect(result.modified).toBe(1);
    expect(result.breaking).toBe(0);
  });
});
