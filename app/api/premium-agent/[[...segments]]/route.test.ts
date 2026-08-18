import { afterEach, describe, expect, test, vi } from "vitest";
import { GET, OPTIONS, POST } from "./route";

const base = "https://agent-api.symbaiex.com/v1/universal-search?q=test";

describe("reserved premium agent API route", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("is unavailable from the public hostname even if a caller supplies credentials", async () => {
    const response = await GET(
      new Request("https://www.symbaiex.com/api/premium-agent/v1/status", {
        headers: { authorization: "Bearer should-not-be-relayed", host: "www.symbaiex.com" },
      }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  test("stays closed until both feature flag and exact host configuration are present", async () => {
    vi.stubEnv("PREMIUM_AGENT_API_ENABLED", "true");
    const missingHost = await POST(
      new Request(base, { method: "POST", headers: { host: "agent-api.symbaiex.com" } }),
    );
    expect(missingHost.status).toBe(404);
    vi.stubEnv("PREMIUM_AGENT_API_HOST", "agent-api.symbaiex.com");
    const reserved = await OPTIONS(
      new Request(base, { method: "OPTIONS", headers: { host: "agent-api.symbaiex.com" } }),
    );
    expect(reserved.status).toBe(204);
    expect(reserved.headers.get("access-control-allow-origin")).toBeNull();
    const notImplemented = await POST(
      new Request(base, { method: "POST", headers: { host: "agent-api.symbaiex.com" } }),
    );
    expect(notImplemented.status).toBe(404);
  });
});
