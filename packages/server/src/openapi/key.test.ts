import { describe, expect, it } from "vitest";
import { buildEndpointKey, METHOD_PATH_SEPARATOR } from "./key";

describe("buildEndpointKey", () => {
  it("normalizes method to uppercase and trims path", () => {
    expect(buildEndpointKey("get", "/orders")).toBe("GET:/orders");
    expect(buildEndpointKey("post", " /users/{id} ")).toBe("POST:/users/{id}");
  });

  it("uses the fixed separator", () => {
    expect(buildEndpointKey("GET", "/orders")).toBe(`GET${METHOD_PATH_SEPARATOR}/orders`);
  });

  it("handles paths that contain no spaces", () => {
    expect(buildEndpointKey("delete", "/v1/items/:id")).toBe("DELETE:/v1/items/:id");
  });
});
