import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

describe("documentation MCP server card", () => {
  test("publishes a cacheable card and header-only HEAD response", async () => {
    const response = GET();
    const head = HEAD();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(
      "application/mcp-server-card+json",
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400",
    );
    expect(await response.text()).toContain("documentation");
    expect(await head.text()).toBe("");
    expect(head.headers.get("access-control-allow-origin")).toBe("*");
  });
});
