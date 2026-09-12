import { describe, it, expect } from "vitest";
import { KEY_SCOPES, SECRET_KEY_PREFIX, generateRawKey, isKeyScope } from "./service";

describe("generateRawKey", () => {
  it("uses the documented format", () => {
    const raw = generateRawKey();
    expect(raw.startsWith(SECRET_KEY_PREFIX)).toBe(true);
    // 24 字节 → 48 位十六进制
    expect(raw.slice(SECRET_KEY_PREFIX.length)).toMatch(/^[0-9a-f]{48}$/);
  });

  it("produces a distinct key every call", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateRawKey()));
    expect(keys.size).toBe(50);
  });

  it("keeps the display prefix short enough for the 20-char column", () => {
    // 展示前缀 = apigent_sk_ + 8 位；再长就超过 varchar(20) 了
    expect(SECRET_KEY_PREFIX.length + 8).toBeLessThanOrEqual(20);
  });
});

describe("scope validation", () => {
  it("accepts exactly the documented scopes", () => {
    expect(KEY_SCOPES).toEqual([
      "api:read",
      "api:write",
      "mcp:search",
      "mcp:detail",
      "mcp:context",
    ]);
    for (const scope of KEY_SCOPES) expect(isKeyScope(scope)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isKeyScope("api:delete")).toBe(false);
    expect(isKeyScope("admin:admins:manage")).toBe(false);
    expect(isKeyScope(undefined)).toBe(false);
    expect(isKeyScope("")).toBe(false);
  });
});
