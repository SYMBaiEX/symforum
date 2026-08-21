import { describe, expect, test } from "vitest";

import { GET, HEAD, POST } from "./route";

describe("unknown agent API routes", () => {
  test.each([GET, POST])("return a bounded JSON problem", async (handler) => {
    const response = handler();
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      title: "Agent API route not found",
      status: 404,
      openapi: "https://www.symbaiex.com/api/agent/openapi.json",
    });
  });

  test("keeps HEAD responses bodyless", async () => {
    const response = HEAD(
      new Request("https://www.symbaiex.com/api/agent/not-real", {
        method: "HEAD",
      }),
    );

    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
  });
});
