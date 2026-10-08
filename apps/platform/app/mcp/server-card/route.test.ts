import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

describe("short-path MCP server card", () => {
  test("binds the discovered /mcp endpoint to its truthful server card", async () => {
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
      name: "com.symbaiex.www/evidence",
      serverUrl: "https://www.symbaiex.com/mcp",
      remotes: [
        expect.objectContaining({
          type: "streamable-http",
          url: "https://www.symbaiex.com/mcp",
        }),
      ],
      tools: expect.arrayContaining([
        expect.objectContaining({ name: "evidence_search" }),
      ]),
    });
    expect(head.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
