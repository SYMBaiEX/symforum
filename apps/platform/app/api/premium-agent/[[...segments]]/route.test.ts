import { afterEach, describe, expect, test, vi } from "vitest";
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from "./route";

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

  test("keeps every supported method indistinguishable while inactive", async () => {
    vi.stubEnv("PREMIUM_AGENT_API_ENABLED", "true");
    vi.stubEnv("PREMIUM_AGENT_API_HOST", "agent-api.symbaiex.com");
    const handlers = [
      [GET, "GET"],
      [HEAD, "HEAD"],
      [POST, "POST"],
      [PUT, "PUT"],
      [PATCH, "PATCH"],
      [DELETE, "DELETE"],
      [OPTIONS, "OPTIONS"],
    ] as const;
    for (const [handler, method] of handlers) {
      const response = await handler(
        new Request(base, {
          method,
          headers: {
            host: "agent-api.symbaiex.com",
            origin: "https://agent-api.symbaiex.com",
          },
        }),
      );
      expect(response.status, method).toBe(404);
      expect(response.headers.get("cache-control"), method).toContain("no-store");
      expect(response.headers.get("access-control-allow-origin"), method).toBeNull();
      expect(response.headers.get("allow"), method).toBeNull();
    }
  });
});
