import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

describe("short-path MCP endpoint discovery", () => {
  test("serves a card that identifies the /mcp endpoint itself", async () => {
    const response = GET();
    const head = HEAD();

    expect(response.headers.get("content-type")).toContain(
      "application/mcp-server-card+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      serverUrl: "https://www.symbaiex.com/mcp",
      remotes: [
        expect.objectContaining({
          url: "https://www.symbaiex.com/mcp",
        }),
      ],
    });
    expect(head.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400",
    );
  });
});
