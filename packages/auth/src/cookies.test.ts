import { describe, it, expect } from "vitest";
import { AUTH_SCOPES, authCookieNames } from "./cookies";

describe("cookie naming (Auth.js shape)", () => {
  it("follows <prefix><namespace>.<cookie> and only differs in the namespace", () => {
    expect(authCookieNames("platform", false)).toEqual({
      sessionToken: "apigent.session-token",
      callbackUrl: "apigent.callback-url",
      csrfToken: "apigent.csrf-token",
      pkceCodeVerifier: "apigent.pkce.code_verifier",
      state: "apigent.state",
      nonce: "apigent.nonce",
    });
  });

  it("uses __Secure- for everything except csrf, which uses __Host-", () => {
    const names = authCookieNames("platform", true);
    expect(names.sessionToken).toBe("__Secure-apigent.session-token");
    expect(names.csrfToken).toBe("__Host-apigent.csrf-token");
    expect(names.pkceCodeVerifier).toBe("__Secure-apigent.pkce.code_verifier");
  });

  it("never shares a cookie name between the two planes", () => {
    // 回归守卫：cookie 按主机共享、不区分端口。同名会让后登录的平面覆盖前者，
    // CSRF 校验随之失败（密码正确却登不进去）。
    for (const secure of [false, true]) {
      const platform = Object.values(authCookieNames("platform", secure));
      const admin = Object.values(authCookieNames("admin", secure));
      expect(platform.some((name) => admin.includes(name))).toBe(false);
    }
  });

  it("covers every scope", () => {
    for (const scope of AUTH_SCOPES) {
      expect(authCookieNames(scope, false).sessionToken.endsWith(".session-token")).toBe(true);
    }
  });
});
