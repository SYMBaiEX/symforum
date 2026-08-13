import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { OPTIONS, POST } from "./route";

const originalPrivateSiteUrl = process.env.CONVEX_SITE_URL;
const originalSiteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
const originalCloudUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

beforeEach(() => {
  process.env.CONVEX_SITE_URL = "https://private-backend.example";
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL = "https://fallback.example";
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalPrivateSiteUrl === undefined) {
    delete process.env.CONVEX_SITE_URL;
  } else {
    process.env.CONVEX_SITE_URL = originalPrivateSiteUrl;
  }
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL = originalSiteUrl;
  }
  if (originalCloudUrl === undefined) {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  } else {
    process.env.NEXT_PUBLIC_CONVEX_URL = originalCloudUrl;
  }
});

describe("public agent auth relay", () => {
  test("forwards a challenge to the server-side backend without exposing its URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ agentId: "research-agent" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("https://www.symbaiex.com/api/agent/auth/challenge", {
        method: "POST",
        body: JSON.stringify({ agentId: "research-agent" }),
        headers: { "content-type": "application/json" },
      }),
      { params: Promise.resolve({ action: "challenge" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ agentId: "research-agent" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://private-backend.example/agent/auth/challenge",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  test("rejects malformed or cross-origin requests before forwarding", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const malformed = await POST(
      new Request("https://www.symbaiex.com/api/agent/auth/sign-in", {
        method: "POST",
        body: JSON.stringify({ agentId: "research-agent" }),
      }),
      { params: Promise.resolve({ action: "sign-in" }) },
    );
    expect(malformed.status).toBe(400);

    const crossOrigin = await POST(
      new Request("https://www.symbaiex.com/api/agent/auth/challenge", {
        method: "POST",
        body: JSON.stringify({ agentId: "research-agent" }),
        headers: { origin: "https://untrusted.example" },
      }),
      { params: Promise.resolve({ action: "challenge" }) },
    );
    expect(crossOrigin.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("supports first-party CORS preflight and rejects unknown actions", async () => {
    const preflight = await OPTIONS(
      new Request("https://www.symbaiex.com/api/agent/auth/refresh", {
        headers: { origin: "https://www.symbaiex.com" },
      }),
      { params: Promise.resolve({ action: "refresh" }) },
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://www.symbaiex.com",
    );

    const unknown = await OPTIONS(
      new Request("https://www.symbaiex.com/api/agent/auth/nope"),
      { params: Promise.resolve({ action: "nope" }) },
    );
    expect(unknown.status).toBe(404);
  });
});
