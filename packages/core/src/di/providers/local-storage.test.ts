import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalStorageProvider } from "./local-storage";

describe("LocalStorageProvider", () => {
  let baseDir: string;
  let provider: LocalStorageProvider;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "apigent-storage-"));
    provider = new LocalStorageProvider(baseDir);
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it("saves and reads a file", async () => {
    await provider.save("specs/openapi.json", Buffer.from("{}"));
    expect(await provider.exists("specs/openapi.json")).toBe(true);
    expect((await provider.read("specs/openapi.json")).toString()).toBe("{}");
  });

  it("lists files under a prefix", async () => {
    await provider.save("a/b.txt", Buffer.from("1"));
    await provider.save("a/c.txt", Buffer.from("2"));
    expect((await provider.list("a")).sort()).toEqual(["a/b.txt", "a/c.txt"]);
  });

  it("blocks simple path traversal (../)", async () => {
    await expect(provider.read("../../etc/passwd")).rejects.toThrow(/Path traversal/);
    await expect(provider.save("../../tmp/pwn.txt", Buffer.from("x"))).rejects.toThrow(
      /Path traversal/,
    );
  });

  it("blocks traversal via a sibling directory name (startsWith bypass)", async () => {
    // `<base>-evil` passes a naive `startsWith(base)` check but lives outside baseDir.
    const sibling = `../${path.basename(baseDir)}-evil/pwn.txt`;
    await expect(provider.save(sibling, Buffer.from("x"))).rejects.toThrow(/Path traversal/);
    await expect(provider.read(sibling)).rejects.toThrow(/Path traversal/);
    expect(fs.existsSync(`${baseDir}-evil`)).toBe(false);
  });

  it("allows normalized paths that stay inside the base directory", async () => {
    await provider.save("a/../b.txt", Buffer.from("ok"));
    expect(await provider.read("b.txt")).toBeTruthy();
  });
});
