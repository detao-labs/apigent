import { describe, it, expect } from "vitest";
import type { RagDocument } from "../contracts";
import {
  fixtureDocumentSource,
  FIXTURE_REPO_CHECKOUT,
  FIXTURE_REPO_LEGACY,
} from "./fixture-document-source";

const scope = (...repositoryIds: string[]) => ({ repositoryIds });

describe("fixtureDocumentSource", () => {
  it("returns the fixtures of the requested repository", async () => {
    const source = fixtureDocumentSource();

    const docs = await source.load(
      { repositoryId: FIXTURE_REPO_CHECKOUT },
      scope(FIXTURE_REPO_CHECKOUT),
    );

    expect(docs.length).toBeGreaterThan(0);
    expect(docs.every((doc) => doc.organizationId === "org-demo")).toBe(true);
    expect(docs.some((doc) => doc.lang === "en")).toBe(true);
    expect(docs.some((doc) => doc.parentId)).toBe(true);
  });

  it("returns nothing for a repository outside the given scope", async () => {
    const source = fixtureDocumentSource();

    const docs = await source.load(
      { repositoryId: FIXTURE_REPO_LEGACY },
      scope(FIXTURE_REPO_CHECKOUT),
    );

    expect(docs).toEqual([]);
  });

  it("returns nothing for an unknown repository", async () => {
    const source = fixtureDocumentSource();

    expect(await source.load({ repositoryId: "repo-unknown" }, scope("repo-unknown"))).toEqual([]);
  });

  it("returns a deep copy so callers cannot pollute the corpus", async () => {
    const source = fixtureDocumentSource();

    const first = await source.load(
      { repositoryId: FIXTURE_REPO_CHECKOUT },
      scope(FIXTURE_REPO_CHECKOUT),
    );
    first[0].text = "被调用方改掉了";
    first[0].fields?.tags?.push("污染");

    const second = await source.load(
      { repositoryId: FIXTURE_REPO_CHECKOUT },
      scope(FIXTURE_REPO_CHECKOUT),
    );
    expect(second[0].text).not.toBe("被调用方改掉了");
    expect(second[0].fields?.tags ?? []).not.toContain("污染");
  });

  it("ignores IndexRequest.endpoints（返回全集是安全方向的近似）", async () => {
    const source = fixtureDocumentSource();

    const partial = await source.load(
      { repositoryId: FIXTURE_REPO_CHECKOUT, endpoints: ["endpoint:GET:/shipments/{id}"] },
      scope(FIXTURE_REPO_CHECKOUT),
    );
    const full = await source.load(
      { repositoryId: FIXTURE_REPO_CHECKOUT },
      scope(FIXTURE_REPO_CHECKOUT),
    );

    expect(partial).toEqual(full);
  });

  it("accepts a custom corpus", async () => {
    const custom: RagDocument = {
      id: "endpoint:GET:/ping",
      level: "endpoint",
      lang: "en",
      text: "Ping endpoint",
    };
    const source = fixtureDocumentSource({ documentsByRepository: { "repo-x": [custom] } });

    expect(await source.load({ repositoryId: "repo-x" }, scope("repo-x"))).toEqual([custom]);
    expect(
      await source.load({ repositoryId: FIXTURE_REPO_CHECKOUT }, scope(FIXTURE_REPO_CHECKOUT)),
    ).toEqual([]);
  });

  it("propagates an injected error so ingest failure paths are testable", async () => {
    const source = fixtureDocumentSource({ error: new Error("source down") });

    await expect(
      source.load({ repositoryId: FIXTURE_REPO_CHECKOUT }, scope(FIXTURE_REPO_CHECKOUT)),
    ).rejects.toThrow("source down");
  });
});
