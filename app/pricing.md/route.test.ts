import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

describe("machine-readable pricing", () => {
  test("publishes the truthful free-beta price and exact quota boundaries", async () => {
    const response = GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("link")).toContain("/pricing");
    expect(body).toContain("Price: $0 USD");
    expect(body).toContain("Billing enabled: no");
    expect(body).toContain("Owner monthly allowance: 100 operation units");
    expect(body).toContain("No paid tier");
  });

  test("serves a bodyless HEAD response with the same representation metadata", () => {
    const response = HEAD();
    expect(response.body).toBeNull();
    expect(response.headers.get("content-type")).toContain("text/markdown");
  });
});
