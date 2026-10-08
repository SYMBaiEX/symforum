import { beforeEach, describe, expect, test, vi } from "vitest";

const serverConvex = vi.hoisted(() => ({
  client: null as null | { query: ReturnType<typeof vi.fn> },
}));

vi.mock("@/lib/server-convex-auth", () => ({
  getAuthenticatedServerConvexClient: async () => serverConvex.client,
}));

describe("forum announcement route status preflight", () => {
  beforeEach(() => {
    vi.resetModules();
    serverConvex.client = { query: vi.fn() };
  });

  test("propagates Convex query failures instead of false 404s", async () => {
    serverConvex.client!.query.mockRejectedValue(
      new Error("Convex announcement unavailable"),
    );

    const { resolveForumAnnouncementRouteStatus } = await import(
      "./announcement-route-status"
    );

    await expect(
      resolveForumAnnouncementRouteStatus({ slug: "welcome" }),
    ).rejects.toThrow("Convex announcement unavailable");
  });

  test("passes board context for board-scoped announcement preflight", async () => {
    serverConvex.client!.query.mockResolvedValue({ slug: "board-rules" });

    const { resolveForumAnnouncementRouteStatus } = await import(
      "./announcement-route-status"
    );

    await expect(
      resolveForumAnnouncementRouteStatus({
        board: "projects",
        slug: "board-rules",
      }),
    ).resolves.toEqual({ slug: "board-rules" });
    expect(serverConvex.client!.query).toHaveBeenCalledWith(expect.anything(), {
      categorySlug: "projects",
      slug: "board-rules",
    });
  });

  test("preserves board context in canonical paths", async () => {
    const { forumAnnouncementCanonicalPath } = await import(
      "./announcement-route-status"
    );

    expect(forumAnnouncementCanonicalPath("welcome")).toBe(
      "/announcements/welcome",
    );
    expect(forumAnnouncementCanonicalPath("board rules", "project notes")).toBe(
      "/announcements/board%20rules?board=project%20notes",
    );
  });
});
