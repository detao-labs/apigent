import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { loadConfig, resetConfig } from "@apigent/core/config";
import { SESSION_COOKIES, createSessionToken, verifySessionToken } from "./session";

const PLATFORM_SECRET = "test-platform-secret";
const ADMIN_SECRET = "test-admin-secret";
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ["APIGENT_DATABASE_URL", "APIGENT_AUTH_SECRET", "APIGENT_AUTH_ADMIN_SECRET"]) {
    savedEnv[key] = process.env[key];
  }
  process.env.APIGENT_DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  process.env.APIGENT_AUTH_SECRET = PLATFORM_SECRET;
  process.env.APIGENT_AUTH_ADMIN_SECRET = ADMIN_SECRET;
  resetConfig();
  loadConfig();
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfig();
});

describe("session cookies", () => {
  it("keeps the two planes on different cookie names", () => {
    expect(SESSION_COOKIES.platform).toBe("apigent_session");
    expect(SESSION_COOKIES.admin).toBe("apigent_admin_session");
    expect(SESSION_COOKIES.platform).not.toBe(SESSION_COOKIES.admin);
  });
});

describe("session scope isolation", () => {
  it("accepts a platform token on the platform plane", () => {
    const token = createSessionToken("usr_aaaaaaaaaa", "platform");
    const payload = verifySessionToken(token, "platform");
    expect(payload?.uid).toBe("usr_aaaaaaaaaa");
    expect(payload?.aud).toBe("platform");
  });

  it("defaults to the platform plane", () => {
    expect(verifySessionToken(createSessionToken("usr_bbbbbbbbbb"), "platform")?.aud).toBe(
      "platform",
    );
  });

  it("rejects a platform token on the admin plane, and vice versa", () => {
    const platformToken = createSessionToken("usr_aaaaaaaaaa", "platform");
    const adminToken = createSessionToken("usr_aaaaaaaaaa", "admin");

    expect(verifySessionToken(platformToken, "admin")).toBeNull();
    expect(verifySessionToken(adminToken, "platform")).toBeNull();
    expect(verifySessionToken(adminToken, "admin")?.aud).toBe("admin");
  });

  it("rejects a token whose payload was edited to switch planes", () => {
    const platformToken = createSessionToken("usr_aaaaaaaaaa", "platform");
    const [payload, signature] = platformToken.split(".");
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    const forged = Buffer.from(JSON.stringify({ ...decoded, aud: "admin" })).toString("base64url");

    expect(verifySessionToken(`${forged}.${signature}`, "admin")).toBeNull();
  });

  it("rejects a token signed with the other plane's secret", () => {
    // 手写一个 aud=admin 但用 platform secret 签名的 token：两层锁必须都拦得住。
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ uid: "usr_aaaaaaaaaa", aud: "admin", iat: now, exp: now + 3600 }),
    ).toString("base64url");
    const signature = createHmac("sha256", PLATFORM_SECRET).update(payload).digest("base64url");

    expect(verifySessionToken(`${payload}.${signature}`, "admin")).toBeNull();
  });

  it("rejects tokens minted before the audience field existed", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({ uid: "usr_aaaaaaaaaa", iat: now, exp: now + 3600 }),
    ).toString("base64url");
    const signature = createHmac("sha256", PLATFORM_SECRET).update(payload).digest("base64url");

    expect(verifySessionToken(`${payload}.${signature}`, "platform")).toBeNull();
  });
});
