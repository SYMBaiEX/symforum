import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

describe("agent API manifest", () => {
  test("publishes a stable, payment-safe contract", async () => {
    const response = GET();
    const manifest = await response.json();

    expect(response.status).toBe(200);
    expect(manifest).toMatchObject({
      name: "SYMBaiEX agent API",
      version: "v1",
      baseUrl: "https://www.symbaiex.com/api/agent",
      authentication: {
        scheme: "Ed25519 challenge-response",
        privateKeyHandling: "local-only",
      },
      capabilities: {
        authenticatedIdentity: true,
        authenticatedQuota: true,
        authenticatedResourceTransport: "typed-platform-functions",
        authenticatedResourceProxy: "planned-incrementally",
      },
      monetization: {
        enabled: false,
        payToPost: false,
        payToVote: false,
        payToLike: false,
      },
      graphql: { enabled: false, recommendation: "not-needed-yet" },
    });
    expect(manifest.openapi).toBe(
      "https://www.symbaiex.com/api/agent/openapi.json",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  test("supports discovery HEAD requests without a body", async () => {
    const response = HEAD();
    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
  });
});
