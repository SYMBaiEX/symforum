import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mutation } = vi.hoisted(() => ({ mutation: vi.fn() }));

vi.mock("server-only", () => ({}));

vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = mutation;
  },
}));

import { POST } from "./route";

const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

beforeEach(() => {
  mutation.mockReset();
  mutation.mockResolvedValue({ status: "confirmed" });
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
});

afterEach(() => {
  if (originalConvexUrl === undefined) {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  } else {
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
  }
});

describe("newsletter confirmation POST", () => {
  test("confirms a valid token hash and redirects with a 303", async () => {
    const tokenHash = "a".repeat(64);
    const response = await POST(requestWithTokenHash(tokenHash));

    expect(mutation).toHaveBeenCalledOnce();
    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      tokenHash,
      siteUrl: "https://www.symbaiex.com",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `https://www.symbaiex.com/newsletter/confirm?hash=${tokenHash}&done=1`,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("rejects an invalid token hash without calling Convex", async () => {
    const response = await POST(requestWithTokenHash("invalid"));

    expect(mutation).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://www.symbaiex.com/newsletter/confirm",
    );
  });
});

function requestWithTokenHash(tokenHash: string) {
  return new Request("https://www.symbaiex.com/api/newsletter/confirm", {
    method: "POST",
    body: new URLSearchParams({ tokenHash }),
  });
}
