import { describe, expect, it } from "vitest";
import app from "./index";

describe("Apigent Open Gateway", () => {
  it("serves health checks", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("describes the service", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe("Apigent Open Gateway");
  });
});
