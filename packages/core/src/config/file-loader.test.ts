import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, resetConfig } from "./file-loader";

const ENV_KEYS = ["APIGENT_DATABASE_URL", "APIGENT_AUTH_SECRET"] as const;

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
      "server:\n  port: \"not-a-number\"\n",
    );

    expect(() => loadConfig(dir)).toThrow(/server/);
  });

  it("rejects unknown provider names coming from YAML", () => {
    process.env.APIGENT_DATABASE_URL = "postgresql://env:env@localhost:5432/apigent_env";
    process.env.APIGENT_AUTH_SECRET = "shell-secret";
    fs.writeFileSync(path.join(dir, "apigent.config.yaml"), "llm:\n  provider: sky-net\n");

    expect(() => loadConfig(dir)).toThrow(/llm/);
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
      "webapp:\n  platformUrl: \"http://localhost:3000/#/apis\"\n",
    );

    const config = loadConfig(dir);
    expect(config.webapp.platformUrl).toBe("http://localhost:3000/#/apis");
  });
});
