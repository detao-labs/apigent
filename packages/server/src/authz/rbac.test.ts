import { describe, expect, it } from "vitest";
import {
  ForbiddenError,
  isOrgRoleAtLeast,
  isRepoRoleAtLeast,
  orgRoleToRepoRole,
  resolveEffectiveRepoRole,
} from "./roles";

describe("orgRoleToRepoRole", () => {
  it("maps org roles to inherited repo roles", () => {
    expect(orgRoleToRepoRole("org_owner")).toBe("repo_admin");
    expect(orgRoleToRepoRole("org_admin")).toBe("repo_editor");
    expect(orgRoleToRepoRole("org_member")).toBe("repo_viewer");
  });
});

describe("resolveEffectiveRepoRole", () => {
  it("inherits from org role when no override", () => {
    expect(resolveEffectiveRepoRole("org_owner", null)).toBe("repo_admin");
    expect(resolveEffectiveRepoRole("org_admin", null)).toBe("repo_editor");
    expect(resolveEffectiveRepoRole("org_member", null)).toBe("repo_viewer");
  });

  it("applies override when higher than inherited", () => {
    expect(resolveEffectiveRepoRole("org_member", "repo_admin")).toBe("repo_admin");
    expect(resolveEffectiveRepoRole("org_member", "repo_editor")).toBe("repo_editor");
  });

  it("keeps inherited when override is lower", () => {
    expect(resolveEffectiveRepoRole("org_admin", "repo_viewer")).toBe("repo_editor");
  });

  it("supports explicit override without org membership", () => {
    expect(resolveEffectiveRepoRole(null, "repo_viewer")).toBe("repo_viewer");
  });

  it("returns null when no access", () => {
    expect(resolveEffectiveRepoRole(null, null)).toBeNull();
  });
});

describe("role ranking guards", () => {
  it("isRepoRoleAtLeast", () => {
    expect(isRepoRoleAtLeast("repo_admin", "repo_viewer")).toBe(true);
    expect(isRepoRoleAtLeast("repo_editor", "repo_admin")).toBe(false);
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
