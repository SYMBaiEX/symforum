import { describe, expect, test } from "vitest";

import { GET, HEAD } from "./route";

const context = (unsupported: string[]) => ({
  params: Promise.resolve({ unsupported }),
});

describe("unsupported well-known discovery", () => {
  test("returns a truthful JSON OAuth boundary instead of an HTML 404", async () => {
    const response = await GET(
      new Request(
        "https://www.symbaiex.com/.well-known/oauth-authorization-server",
      ),
      context(["oauth-authorization-server"]),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.json()).resolves.toMatchObject({
      code: "OAUTH_NOT_SUPPORTED",
      resolution: expect.stringContaining("/auth.md"),
    });
  });

  test("keeps unknown discovery resources structured and HEAD bodyless", async () => {
    const request = new Request(
      "https://www.symbaiex.com/.well-known/not-published",
      { method: "HEAD" },
    );
    const response = await HEAD(request, context(["not-published"]));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    await expect(response.text()).resolves.toBe("");
  });
});
