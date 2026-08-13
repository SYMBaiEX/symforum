import { beforeEach, describe, expect, test, vi } from "vitest";
import { primarySiteUrl } from "@/lib/site-urls";

const mocks = vi.hoisted(() => ({
  getPublishedPosts: vi.fn(),
  getPortfolioProjects: vi.fn(),
  getPublicNewsletterIssues: vi.fn(),
  getNewsTimeline: vi.fn(),
  getDailyNews: vi.fn(),
  getServerConvexClient: vi.fn(),
}));

vi.mock("@/lib/blog-data", () => ({
  getPublishedPosts: (...args: unknown[]) => mocks.getPublishedPosts(...args),
}));

vi.mock("@/lib/site-content", () => ({
  getPortfolioProjects: (...args: unknown[]) =>
    mocks.getPortfolioProjects(...args),
}));

vi.mock("@/lib/newsletter-data", () => ({
  getPublicNewsletterIssues: (...args: unknown[]) =>
    mocks.getPublicNewsletterIssues(...args),
}));

vi.mock("@/lib/news-data", () => ({
  getNewsTimeline: (...args: unknown[]) => mocks.getNewsTimeline(...args),
  getDailyNews: (...args: unknown[]) => mocks.getDailyNews(...args),
}));

vi.mock("@/lib/server-convex", () => ({
  getServerConvexClient: () => mocks.getServerConvexClient(),
}));

async function loadSitemapModule() {
  return await import("./sitemap");
}

beforeEach(() => {
  vi.resetModules();
  mocks.getPublishedPosts.mockReset();
  mocks.getPortfolioProjects.mockReset();
  mocks.getPublicNewsletterIssues.mockReset();
  mocks.getNewsTimeline.mockReset();
  mocks.getDailyNews.mockReset();
  mocks.getServerConvexClient.mockReset();
  mocks.getServerConvexClient.mockReturnValue(null);
});

describe("sitemap health and fallback", () => {
  test("uses stale last-known-good snapshot when a source fails", async () => {
    const sitemapModule = await loadSitemapModule();
    const { default: runSitemap, getSitemapHealthSnapshot, resetSitemapHealthForTests } =
      sitemapModule;
    resetSitemapHealthForTests();

    mocks.getPublishedPosts.mockResolvedValue([
      { slug: "first-post", featured: true, publishedAt: "2026-01-10T00:00:00Z" },
    ]);
    mocks.getPortfolioProjects.mockResolvedValue([
      { slug: "symba-labs" },
    ]);
    mocks.getPublicNewsletterIssues.mockResolvedValue([
      { slug: "news-001", sentAt: "2026-01-10T00:00:00Z" },
    ]);
    mocks.getNewsTimeline.mockResolvedValue({
      stories: [{ hnItemId: 123, title: "Fresh story" }],
    });
    mocks.getDailyNews.mockResolvedValue([]);

    const warmup = await runSitemap();
    expect(warmup).toContainEqual(
      expect.objectContaining({
        url: primarySiteUrl("/blog/first-post"),
      }),
    );
    const warmupSnapshot = getSitemapHealthSnapshot();
    expect(warmupSnapshot.sources.blog.status).toBe("ok");
    expect(warmupSnapshot.staleSnapshotCount).toBeGreaterThan(0);

    mocks.getPublishedPosts.mockRejectedValue(new Error("blog source unavailable"));
    const fallbackRun = await runSitemap();
    expect(fallbackRun).toContainEqual(
      expect.objectContaining({
        url: primarySiteUrl("/blog/first-post"),
      }),
    );
    const degradedSnapshot = getSitemapHealthSnapshot();
    expect(degradedSnapshot.sources.blog.status).toBe("degraded");
    expect(degradedSnapshot.sources.blog.totalFailures).toBe(1);
    expect(degradedSnapshot.consecutiveRunFailures).toBe(1);
  });

  test("tracks source degradation when no stale snapshot exists", async () => {
    const sitemapModule = await loadSitemapModule();
    const { default: runSitemap, getSitemapHealthSnapshot, resetSitemapHealthForTests } =
      sitemapModule;
    resetSitemapHealthForTests();

    mocks.getPublishedPosts.mockRejectedValue(new Error("blog source offline"));
    mocks.getPortfolioProjects.mockResolvedValue([]);
    mocks.getPublicNewsletterIssues.mockResolvedValue([]);
    mocks.getNewsTimeline.mockResolvedValue(null);
    mocks.getDailyNews.mockResolvedValue([]);

    const sitemapRows = await runSitemap();
    expect(sitemapRows).toContainEqual(
      expect.objectContaining({ url: primarySiteUrl("/") }),
    );
    expect(sitemapRows).not.toContainEqual(
      expect.objectContaining({
        url: primarySiteUrl("/blog/first-post"),
      }),
    );
    const snapshot = getSitemapHealthSnapshot();
    expect(snapshot.sources.blog.status).toBe("degraded");
    expect(snapshot.staleSnapshotAt).toBeNull();
  });
});
