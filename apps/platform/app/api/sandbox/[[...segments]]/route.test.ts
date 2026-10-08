import { describe, expect, test } from "vitest";

import { GET } from "./route";

const context = (segments?: string[]) => ({
  params: Promise.resolve({ segments }),
});

describe("synthetic agent API sandbox", () => {
  test("advertises a read-only synthetic environment", async () => {
    const response = await GET(
      new Request("https://www.symbaiex.com/api/sandbox"),
      context(),
    );
    await expect(response.json()).resolves.toMatchObject({
      environment: "sandbox",
      syntheticOnly: true,
      writesEnabled: false,
      authenticationRequired: false,
      openapi: "https://www.symbaiex.com/api/sandbox/openapi.json",
    });
    expect(response.headers.get("x-symbaiex-environment")).toBe("sandbox");
  });

  test("returns deterministic fixtures without production identifiers", async () => {
    const response = await GET(
      new Request(
        "https://www.symbaiex.com/api/sandbox/v1/search?q=security&limit=2",
      ),
      context(["v1", "search"]),
    );
    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe("sandbox-claim-release-security");
    expect(JSON.stringify(body)).not.toMatch(/convex|token|ownerUserId/i);
  });

  test("keeps invalid and unknown requests structured", async () => {
    const invalid = await GET(
      new Request("https://www.symbaiex.com/api/sandbox/v1/search?q="),
      context(["v1", "search"]),
    );
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).code).toBe("INVALID_QUERY");

    const unknown = await GET(
      new Request("https://www.symbaiex.com/api/sandbox/v1/write"),
      context(["v1", "write"]),
    );
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).code).toBe("SANDBOX_ROUTE_NOT_FOUND");
  });
});
