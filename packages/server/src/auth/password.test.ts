import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("uses a unique salt per hash", () => {
    expect(hashPassword("same-password")).not.toBe(hashPassword("same-password"));
  });

  it("returns false for malformed stored values", () => {
    expect(verifyPassword("whatever", "not-a-valid-hash")).toBe(false);
    expect(verifyPassword("whatever", "")).toBe(false);
  });
});
