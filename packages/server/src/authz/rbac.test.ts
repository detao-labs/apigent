import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  isOrgRoleAtLeast,
  isRepoRoleAtLeast,
  orgRoleToRepoRole,
  resolveEffectiveRepoRole,
} from "./roles";

describe("orgRoleToRepoRole", () => {
  it("maps admins and owners to their implied repo role", () => {
    expect(orgRoleToRepoRole("org_owner")).toBe("repo_owner");
    expect(orgRoleToRepoRole("org_admin")).toBe("repo_admin");
  });

  it("implies nothing for plain members — repo access is explicit", () => {
    expect(orgRoleToRepoRole("org_member")).toBeNull();
    expect(orgRoleToRepoRole(null)).toBeNull();
  });
});

describe("resolveEffectiveRepoRole", () => {
  it("falls back to the org role when there is no membership row", () => {
    expect(resolveEffectiveRepoRole("org_owner", null)).toBe("repo_owner");
    expect(resolveEffectiveRepoRole("org_admin", null)).toBe("repo_admin");
  });

  it("leaves a plain org member without any repo access", () => {
    expect(resolveEffectiveRepoRole("org_member", null)).toBeNull();
  });

  it("prefers the membership role over the org role", () => {
    expect(resolveEffectiveRepoRole("org_member", "repo_owner")).toBe("repo_owner");
    expect(resolveEffectiveRepoRole("org_member", "repo_admin")).toBe("repo_admin");
  });

  it("lets an explicit row override the org role downward", () => {
    expect(resolveEffectiveRepoRole("org_admin", "repo_viewer")).toBe("repo_viewer");
    expect(resolveEffectiveRepoRole("org_owner", "repo_member")).toBe("repo_member");
    expect(resolveEffectiveRepoRole("org_admin", "repo_owner")).toBe("repo_owner");
  });

  it("supports explicit membership without org membership", () => {
    expect(resolveEffectiveRepoRole(null, "repo_viewer")).toBe("repo_viewer");
  });

  it("returns null when no access", () => {
    expect(resolveEffectiveRepoRole(null, null)).toBeNull();
  });
});

describe("role ranking guards", () => {
  it("isRepoRoleAtLeast", () => {
    expect(isRepoRoleAtLeast("repo_admin", "repo_viewer")).toBe(true);
    expect(isRepoRoleAtLeast("repo_member", "repo_admin")).toBe(false);
    expect(isRepoRoleAtLeast(null, "repo_viewer")).toBe(false);
  });

  it("isOrgRoleAtLeast", () => {
    expect(isOrgRoleAtLeast("org_owner", "org_admin")).toBe(true);
    expect(isOrgRoleAtLeast("org_member", "org_admin")).toBe(false);
    expect(isOrgRoleAtLeast(null, "org_member")).toBe(false);
  });
});

describe("ForbiddenError", () => {
  it("has name ForbiddenError", () => {
    const err = new ForbiddenError();
    expect(err.name).toBe("ForbiddenError");
    expect(err.message).toBe("Forbidden");
  });
});
