import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { mutation } = vi.hoisted(() => ({ mutation: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    mutation = mutation;
  },
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => void) => callback() };
});

import { POST } from "./route";

const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

beforeEach(() => {
  mutation.mockReset();
  mutation.mockResolvedValue({ status: "pending" });
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
});

afterEach(() => {
  if (originalConvexUrl === undefined)
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  else process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
});

describe("newsletter subscribe POST", () => {
  test("fails closed when Convex is not configured", async () => {
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
    const response = await POST(jsonRequest({ email: "reader@example.com" }));

    expect(response.status).toBe(503);
    expect(mutation).not.toHaveBeenCalled();
  });

  test("rejects malformed submissions without calling Convex", async () => {
    const response = await POST(jsonRequest({ source: "footer" }));

    expect(response.status).toBe(400);
    expect(mutation).not.toHaveBeenCalled();
  });

  test("requests a private emailed link without client-controlled tokens", async () => {
    const response = await POST(
      jsonRequest({ email: "reader@example.com", source: "footer" }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      email: "reader@example.com",
      source: "footer",
    });
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  test("returns a no-store client error when subscription mutation fails", async () => {
    mutation.mockRejectedValue(new Error("email blocked"));

    const response = await POST(jsonRequest({ email: "reader@example.com" }));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "email blocked",
    });
  });
});

function jsonRequest(body: unknown) {
  return new Request("https://www.symbaiex.com/api/newsletter/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
