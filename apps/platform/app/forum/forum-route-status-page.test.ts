import { beforeEach, describe, expect, test, vi } from "vitest";

const serverConvex = vi.hoisted(() => ({
  client: null as null | { query: ReturnType<typeof vi.fn> },
}));

vi.mock("react", () => {
  return {
    cache: <T extends (...args: any[]) => Promise<unknown>>(fn: T) => {
      const entries = new Map<string, ReturnType<T>>();
      return (...args: Parameters<T>): ReturnType<T> => {
        const key = JSON.stringify(args);
        const existing = entries.get(key);
        if (existing) return existing;
        const result = fn(...args);
        entries.set(key, result as ReturnType<T>);
        return result as ReturnType<T>;
      };
    },
  };
});

vi.mock("@/lib/server-convex-auth", () => ({
  getAuthenticatedServerConvexClient: async () => serverConvex.client,
}));

describe("forum dynamic route status preflight", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    serverConvex.client = { query: vi.fn() };
  });

  test("category status propagates Convex query failures instead of false 404s", async () => {
    const failure = new Error("Convex route status unavailable");
    serverConvex.client!.query.mockRejectedValue(failure);

    const { resolveForumRouteStatus } = await import("./forum-route-status");

    await expect(
      resolveForumRouteStatus({ categorySlug: "public-square" }),
    ).rejects.toThrow("Convex route status unavailable");
  });

  test("thread status propagates Convex query failures instead of false 404s", async () => {
    const failure = new Error("Convex thread status unavailable");
    serverConvex.client!.query.mockRejectedValue(failure);

    const { resolveForumRouteStatus } = await import("./forum-route-status");

    await expect(
      resolveForumRouteStatus({
        categorySlug: "public-square",
        threadSlug: "launch-thread",
      }),
    ).rejects.toThrow("Convex thread status unavailable");
  });

  test("coalesces the metadata and page lookup for the same route render", async () => {
    const response = { exists: true, kind: "category" };
    serverConvex.client!.query.mockResolvedValue(response);
    const { resolveForumRouteStatus } = await import("./forum-route-status");

    await expect(
      Promise.all([
        resolveForumRouteStatus({ categorySlug: "public-square" }),
        resolveForumRouteStatus({ categorySlug: "public-square" }),
      ]),
    ).resolves.toEqual([response, response]);

    expect(serverConvex.client!.query).toHaveBeenCalledTimes(1);
  });
});
