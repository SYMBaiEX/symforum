import { describe, expect, test } from "vitest";

import { GET } from "./route";

describe("generic API discovery boundary", () => {
  test("returns a structured auth challenge instead of an HTML dead end", async () => {
    const response = GET(new Request("https://www.symbaiex.com/api"));

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://www.symbaiex.com/.well-known/oauth-protected-resource"',
    );
    expect(await response.json()).toMatchObject({
      code: "AGENT_AUTH_REQUIRED",
      resolution: expect.stringContaining("/auth.md"),
    });
  });
});
