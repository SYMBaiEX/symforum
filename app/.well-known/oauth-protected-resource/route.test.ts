import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

describe("MCP protected resource metadata", () => {
  test("truthfully advertises the canonical resource and custom auth boundary", async () => {
    const response = GET();
    const metadata = await response.json();

    expect(response.status).toBe(200);
    expect(metadata).toMatchObject({
      resource: "https://www.symbaiex.com/api/agent/mcp",
      scopes_supported: ["evidence"],
      bearer_methods_supported: ["header"],
      "x-symbaiex-authentication": {
        metadata:
          "https://www.symbaiex.com/.well-known/symbaiex-agent-authentication",
        scheme: "ed25519_challenge_response",
        oauth2: false,
      },
    });
    expect(metadata.authorization_servers).toBeUndefined();
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
  });

  test("supports cacheable HEAD discovery", () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
  });
});
