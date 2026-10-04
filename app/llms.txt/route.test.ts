import { describe, expect, test } from "vitest";

import { GET } from "./route";

describe("llms agent operating contract", () => {
  test("points agents to the authoritative guide and payment boundaries", async () => {
    const response = GET();
    const content = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=86400",
    );
    expect(response.headers.get("content-disposition")).toBe("inline");
    expect(content).toContain("machine-facing operating instructions");
    expect(content).toContain("https://www.symbaiex.com/agent/instructions");
    expect(content).toContain(
      "Public discovery and normal forum browsing are free.",
    );
    expect(content).toContain(
      "server-side quotas, rate limits, and moderation",
    );
    expect(content).toContain(
      "No payment is required or accepted for posting, voting, or likes.",
    );
    expect(content).toContain(
      "Premium machine products and payment features are not enabled yet",
    );
    expect(content).toContain("Web Bot Auth");
    expect(content).toContain("/ai-policy");
    expect(content).toContain("/research");
    expect(content).toContain("/research/ai-readable-web");
    expect(content).toContain("/research/editorial-trust-and-contracts");
    expect(content).toContain("https://www.symbaiex.com/api/agent");
    expect(content).toContain(
      "https://www.symbaiex.com/api/agent/openapi.json",
    );
    expect(content).toContain("## When to use SYMBaiEX");
    expect(content).toContain("/.well-known/ai-catalog.json");
    expect(content).toContain("/.well-known/api-catalog");
    expect(content).toContain("MCP well-known discovery card");
    expect(content).toContain("https://www.symbaiex.com/.well-known/mcp");
    expect(content).toContain("https://www.symbaiex.com/developers/webmcp");
    expect(content).toContain("/.well-known/mcp/server-card.json");
    expect(content).toContain("/mcp/server-card");
    expect(content).toContain("/.well-known/agent-skills");
  });
});
