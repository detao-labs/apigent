import { describe, it, expect } from "vitest";
import {
  ADMIN_CAPABILITIES,
  ADMIN_ROLES,
  ADMIN_ROLE_CAPABILITIES,
  adminCapabilitiesOf,
  isAdminRole,
  roleHasAdminCapability,
} from "./admin-capabilities";

describe("platform roles", () => {
  it("only knows admin_super in V0", () => {
    expect(ADMIN_ROLES).toEqual(["admin_super"]);
  });

  it("narrows unknown role strings instead of trusting them", () => {
    expect(isAdminRole("admin_super")).toBe(true);
    expect(isAdminRole("admin_member")).toBe(false);
    expect(isAdminRole("org_owner")).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole("")).toBe(false);
  });
});

describe("capability mapping", () => {
  it("gives admin_super exactly the four V0 capabilities", () => {
    expect(ADMIN_ROLE_CAPABILITIES.admin_super).toEqual([
      "admin:admins:manage",
      "admin:stats:view",
      "admin:audit:view",
      "admin:users:view",
    ]);
  });

  it("has no capability outside the declared set (catches typos in the map)", () => {
    for (const role of ADMIN_ROLES) {
      for (const capability of ADMIN_ROLE_CAPABILITIES[role]) {
        expect(ADMIN_CAPABILITIES).toContain(capability);
      }
    }
  });

  it("grants nothing to a non-admin", () => {
    expect(adminCapabilitiesOf(null)).toEqual([]);
    expect(adminCapabilitiesOf(undefined)).toEqual([]);
    expect(roleHasAdminCapability(null, "admin:audit:view")).toBe(false);
  });
});

describe("cross-system invariant (docs/tech-design.md §2.8.7)", () => {
  // 这条断言就是"平台管理员不能触碰租户数据"的机器化版本：它必须是结构性质，
  // 而不是靠代码评审。往 ADMIN_ROLE_CAPABILITIES 里塞任何 repo:*/org:* 都会红。
  it("never maps an admin role to a tenant permission", () => {
    for (const role of ADMIN_ROLES) {
      for (const capability of ADMIN_ROLE_CAPABILITIES[role]) {
        expect(capability.startsWith("admin:")).toBe(true);
        expect(capability).not.toMatch(/^(repo|org):/);
      }
    }
  });

  it("does not hand out content access by default", () => {
    expect(ADMIN_CAPABILITIES).not.toContain("admin:content:read");
    expect(roleHasAdminCapability("admin_super", "admin:content:read" as never)).toBe(false);
  });
});
