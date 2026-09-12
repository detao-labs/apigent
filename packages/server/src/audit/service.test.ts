import { describe, it, expect } from "vitest";
import { OPERATION_TYPES } from "./types";
import { recordOperation } from "./service";

/** 记录 insert().values() 收到的最小假事务句柄。 */
function fakeTx() {
  const inserted: Record<string, unknown>[] = [];
  const tx = {
    insert: () => ({
      values: async (value: Record<string, unknown>) => {
        inserted.push(value);
      },
    }),
  };
  return { tx, inserted };
}

describe("recordOperation", () => {
  it("fills nulls for optional fields and defaults summary to an empty object", async () => {
    const { tx, inserted } = fakeTx();

    const id = await recordOperation(tx as never, {
      operationType: "member.invite",
      resourceType: "organization_member",
    });

    expect(id.startsWith("log_")).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      id,
      operationType: "member.invite",
      resourceType: "organization_member",
      resourceId: null,
      actorId: null,
      organizationId: null,
      repositoryId: null,
      summary: {},
    });
  });

  it("keeps the caller's ids and structured summary verbatim", async () => {
    const { tx, inserted } = fakeTx();
    const summary = { targetEmail: "a@example.com", from: "repo_viewer", to: "repo_admin" };

    await recordOperation(tx as never, {
      operationType: "repo.member_role_change",
      resourceType: "repository_member",
      resourceId: "usr_aaaaaaaaaa",
      actorId: "usr_bbbbbbbbbb",
      organizationId: "org_cccccccccc",
      repositoryId: "repo_dddddddddd",
      summary,
    });

    expect(inserted[0]).toMatchObject({
      operationType: "repo.member_role_change",
      resourceType: "repository_member",
      resourceId: "usr_aaaaaaaaaa",
      actorId: "usr_bbbbbbbbbb",
      organizationId: "org_cccccccccc",
      repositoryId: "repo_dddddddddd",
      summary,
    });
  });

  it("writes a distinct id per call", async () => {
    const { tx, inserted } = fakeTx();
    await recordOperation(tx as never, {
      operationType: "org.create",
      resourceType: "organization",
    });
    await recordOperation(tx as never, {
      operationType: "org.create",
      resourceType: "organization",
    });
    expect(inserted[0]!.id).not.toBe(inserted[1]!.id);
  });
});

describe("OPERATION_TYPES", () => {
  it("covers every V0 'must record' event from the audit plan", () => {
    // 顺序即 docs/modules/audit-log.md 的事件清单；重命名或漏删会让这里失败。
    expect(OPERATION_TYPES).toEqual([
      "org.create",
      "repo.create",
      "org.delete",
      "repo.delete",
      "member.invite",
      "member.role_change",
      "member.remove",
      "repo.member_add",
      "repo.member_role_change",
      "repo.member_remove",
      "org.transfer",
      "admin.grant",
      "admin.revoke",
      "admin.login",
      "admin.user_disable",
      "admin.user_enable",
      "admin.user_delete",
    ]);
  });
});
