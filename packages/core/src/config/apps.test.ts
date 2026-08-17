import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadConfig, resetConfig } from "./file-loader";
import { getAppConfig } from "./apps";

const ENV_KEYS = ["APIGENT_DATABASE_URL", "APIGENT_AUTH_SECRET"] as const;

describe("getAppConfig", () => {
  let dir: string;

  beforeEach(() => {
    process.env.APIGENT_DATABASE_URL = "postgresql://test:test@localhost:5432/apigent_test";
    process.env.APIGENT_AUTH_SECRET = "env-file-secret";
    resetConfig();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "apigent-apps-"));
  });

  afterEach(() => {
    resetConfig();
    fs.rmSync(dir, { recursive: true, force: true });
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

  it("derives the port from the app url", () => {
    fs.writeFileSync(
      path.join(dir, "apigent.config.yaml"),
      [
        "apps:",
        "  platform:",
        "    url: http://localhost:3000",
        "    logLevel: info",
        "",
      ].join("\n"),
    );

    loadConfig(dir);
    expect(getAppConfig("platform")).toMatchObject({
      url: "http://localhost:3000",
      port: 3000,
    });
    expect(getAppConfig("admin").port).toBe(3001);
    expect(getAppConfig("open").port).toBe(3002);
  });

  it("rejects urls without a valid port", () => {
    fs.writeFileSync(
      path.join(dir, "apigent.config.yaml"),
      [
        "apps:",
        "  platform:",
        "    url: http://localhost",
        "    logLevel: info",
        "",
      ].join("\n"),
    );

    loadConfig(dir);
    expect(() => getAppConfig("platform")).toThrow(/port/);
  });
});
