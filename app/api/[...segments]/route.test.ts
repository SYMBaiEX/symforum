import { describe, expect, test } from "vitest";

import { GET, HEAD, POST } from "./route";

describe("unknown SYMBaiEX API routes", () => {
  test.each([
    ["GET", GET],
    ["POST", POST],
  ] as const)("returns a structured problem for %s", async (method, handler) => {
    const response = handler(
      new Request("https://www.symbaiex.com/api/not-a-real-route", {
        method,
      }),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "API_ROUTE_NOT_FOUND",
      message: expect.stringContaining("does not exist"),
      resolution: expect.stringContaining("/api/agent"),
    });
  });

  test("keeps HEAD responses bodyless", async () => {
    const response = HEAD(
      new Request("https://www.symbaiex.com/api/not-a-real-route", {
        method: "HEAD",
      }),
    );
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("");
  });
});
