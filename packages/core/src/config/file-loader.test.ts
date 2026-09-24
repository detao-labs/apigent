import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, resetConfig } from "./file-loader";

const ENV_KEYS = ["APIGENT_DATABASE_URL", "APIGENT_AUTH_SECRET"] as const;

/** 仓库根目录 —— 用来读提交进版本库的配置文件（示例 YAML）。 */
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

describe("loadConfig — .env loading", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let dir: string;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    resetConfig();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apigent-env-"));
  });

  afterEach(() => {
    resetConfig();
    fs.rmSync(dir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it("loads APIGENT_* secrets from .env when not set in the shell", () => {
    fs.writeFileSync(
      path.join(dir, ".env"),
      [
        "APIGENT_DATABASE_URL=postgresql://test:test@localhost:5432/apigent_test",
        "APIGENT_AUTH_SECRET=env-file-secret",
        "",
      ].join("\n"),
    );

    const config = loadConfig(dir);
    expect(config.database.url).toBe("postgresql://test:test@localhost:5432/apigent_test");
    expect(config.auth.secret).toBe("env-file-secret");
  });

  it("gives shell environment precedence over .env", () => {
    process.env.APIGENT_DATABASE_URL = "postgresql://shell:shell@localhost:5432/apigent_shell";
    fs.writeFileSync(
      path.join(dir, ".env"),
      [
        "APIGENT_DATABASE_URL=postgresql://file:file@localhost:5432/apigent_file",
        "APIGENT_AUTH_SECRET=env-file-secret",
        "",
      ].join("\n"),
    );

    const config = loadConfig(dir);
    expect(config.database.url).toBe("postgresql://shell:shell@localhost:5432/apigent_shell");
    expect(config.auth.secret).toBe("env-file-secret");
  });

  it("works without any YAML file when env is fully populated", () => {
    process.env.APIGENT_DATABASE_URL = "postgresql://env:env@localhost:5432/apigent_env";
    process.env.APIGENT_AUTH_SECRET = "shell-secret";

    const config = loadConfig(dir);
    expect(config.database.url).toBe("postgresql://env:env@localhost:5432/apigent_env");
    expect(config.auth.secret).toBe("shell-secret");
  });

  it("rejects wrong-typed values coming from YAML", () => {
    process.env.APIGENT_DATABASE_URL = "postgresql://env:env@localhost:5432/apigent_env";
    process.env.APIGENT_AUTH_SECRET = "shell-secret";
    fs.writeFileSync(
      path.join(dir, "apigent.config.yaml"),
      [
        "apps:",
        "  platform:",
        "    url: 123",
        "  admin:",
        "    url: http://localhost:3001",
        "  open:",
        "    url: http://localhost:3002",
        "",
      ].join("\n"),
    );

    expect(() => loadConfig(dir)).toThrow(/apps/);
  });

  it("rejects unknown provider names coming from YAML", () => {
    process.env.APIGENT_DATABASE_URL = "postgresql://env:env@localhost:5432/apigent_env";
    process.env.APIGENT_AUTH_SECRET = "shell-secret";
    fs.writeFileSync(path.join(dir, "apigent.config.yaml"), "llm:\n  provider: sky-net\n");

    expect(() => loadConfig(dir)).toThrow(/llm/);
  });

  it('rejects the retired searchStore value "pg-fts" coming from YAML (P3-3)', () => {
    // P0-3 把 `pg-fts` 拆成了三个变体（jieba / bigram / simple），并**不做别名**：
    // 别名会让 tokenizer_version 无法判定。旧配置必须在启动期就报错。
    process.env.APIGENT_DATABASE_URL = "postgresql://env:env@localhost:5432/apigent_env";
    process.env.APIGENT_AUTH_SECRET = "shell-secret";
    fs.writeFileSync(
      path.join(dir, "apigent.config.yaml"),
      "rag:\n  searchStore:\n    provider: pg-fts\n",
    );

    expect(() => loadConfig(dir)).toThrow(/rag/);
  });

  it("parses flow-style YAML (inline arrays) via the yaml package", () => {
    process.env.APIGENT_DATABASE_URL = "postgresql://env:env@localhost:5432/apigent_env";
    process.env.APIGENT_AUTH_SECRET = "shell-secret";
    fs.writeFileSync(
      path.join(dir, "apigent.config.yaml"),
      "auth:\n  providers: [credentials, github]\n",
    );

    const config = loadConfig(dir);
    expect(config.auth.providers).toEqual(["credentials", "github"]);
  });

  it("keeps '#' inside quoted YAML values", () => {
    process.env.APIGENT_DATABASE_URL = "postgresql://env:env@localhost:5432/apigent_env";
    process.env.APIGENT_AUTH_SECRET = "shell-secret";
    fs.writeFileSync(
      path.join(dir, "apigent.config.yaml"),
      ["mcp:", '  publicUrl: "https://mcp.example.com/#/tools"', ""].join("\n"),
    );

    const config = loadConfig(dir);
    expect(config.mcp.publicUrl).toBe("https://mcp.example.com/#/tools");
  });

  it("keeps the shipped apigent.config.example.yaml loadable", () => {
    // 「配置类改动一律四处同步」这条规则的机械保障：示例 YAML 一旦与 schema 漂移，
    // 用户照抄示例就会启动失败 —— 这是最容易漏、也最容易被用户先撞上的一处。
    const exampleConfig = fs.readFileSync(
      path.join(REPO_ROOT, "apigent.config.example.yaml"),
      "utf-8",
    );
    fs.writeFileSync(path.join(dir, "apigent.config.yaml"), exampleConfig);
    fs.writeFileSync(
      path.join(dir, ".env"),
      [
        "APIGENT_DATABASE_URL=postgresql://example:example@localhost:5432/apigent_example",
        "APIGENT_AUTH_SECRET=example-secret",
        "",
      ].join("\n"),
    );

    const config = loadConfig(dir);
    expect(config.rag.searchStore.provider).toBe("pg-fts-jieba");
  });
});
