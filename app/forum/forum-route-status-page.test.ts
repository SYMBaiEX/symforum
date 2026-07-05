import { beforeEach, describe, expect, test, vi } from "vitest";

const serverConvex = vi.hoisted(() => ({
  client: null as null | { query: ReturnType<typeof vi.fn> },
}));

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
});
