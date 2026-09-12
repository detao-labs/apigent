import { describe, it, expect } from "vitest";
import { AdminMemberError, canRevokeAdmin } from "./service";

describe("canRevokeAdmin", () => {
  // 这条规则是死锁防线：撤销最后一个管理员之后，没有任何人能再授予管理员，
  // 只能回命令行用 `admin:grant` 救场。
  it("refuses to leave the deployment without an admin", () => {
    expect(canRevokeAdmin(0)).toBe(false);
    expect(canRevokeAdmin(1)).toBe(false);
  });

  it("allows revoking as long as one admin remains", () => {
    expect(canRevokeAdmin(2)).toBe(true);
    expect(canRevokeAdmin(5)).toBe(true);
  });
});

describe("AdminMemberError", () => {
  it("carries a machine-readable code", () => {
    const err = new AdminMemberError("last-admin");
    expect(err.code).toBe("last-admin");
    expect(err.name).toBe("AdminMemberError");
    expect(err).toBeInstanceOf(Error);
  });
});
