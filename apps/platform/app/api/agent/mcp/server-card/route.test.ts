import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

describe("agent MCP server card", () => {
  test("publishes a cacheable CORS-safe machine card for GET and HEAD", async () => {
    const response = GET();
    const head = HEAD();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/mcp-server-card+json",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toMatchObject({
      serverUrl: "https://www.symbaiex.com/api/agent/mcp",
    });
    expect(head.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
