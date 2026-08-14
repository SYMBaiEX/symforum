import { describe, expect, test, vi } from "vitest";

import { GET, OPTIONS } from "./route";

describe("agent quota API relay", () => {
  test("rejects requests without a bearer token", async () => {
    const response = await GET(
      new Request("https://www.symbaiex.com/api/agent/quota"),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "A bearer access token is required.",
    });
  });

  test("rejects untrusted browser origins", async () => {
    const response = await GET(
      new Request("https://www.symbaiex.com/api/agent/quota", {
        headers: {
          origin: "https://evil.example",
          authorization: "Bearer test-token",
        },
      }),
    );
    expect(response.status).toBe(403);
  });

  test("proxies the authenticated quota response without caching or logging tokens", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://strong-bee-384.convex.site");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ agentId: "nyx", remainingUnits: 99 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    try {
      const response = await GET(
        new Request("https://www.symbaiex.com/api/agent/quota", {
          headers: { authorization: "Bearer secret-token" },
        }),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        agentId: "nyx",
        remainingUnits: 99,
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/agent\/quota$/),
        expect.objectContaining({
          headers: {
            authorization: "Bearer secret-token",
            accept: "application/json",
          },
        }),
      );
    } finally {
      fetchMock.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  test("supports authenticated CORS preflight", () => {
    const response = OPTIONS(
      new Request("https://www.symbaiex.com/api/agent/quota", {
        headers: { origin: "https://www.symbaiex.com" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://www.symbaiex.com",
    );
  });
});
