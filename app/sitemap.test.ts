import { beforeEach, describe, expect, test, vi } from "vitest";
import { primarySiteUrl } from "@/lib/site-urls";
import { DEVELOPER_RESOURCES } from "@/lib/developer-resources";

const mocks = vi.hoisted(() => ({
  getPublishedPostSummaries: vi.fn(),
  getPortfolioProjects: vi.fn(),
  getPublicNewsletterIssues: vi.fn(),
  getNewsTimeline: vi.fn(),
  getDailyNews: vi.fn(),
  getServerConvexClient: vi.fn(),
}));

vi.mock("@/lib/blog-data", () => ({
  getPublishedPostSummaries: (...args: unknown[]) =>
    mocks.getPublishedPostSummaries(...args),
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
  mocks.getPublishedPostSummaries.mockReset();
  mocks.getPortfolioProjects.mockReset();
  mocks.getPublicNewsletterIssues.mockReset();
  mocks.getNewsTimeline.mockReset();
  mocks.getDailyNews.mockReset();
  mocks.getServerConvexClient.mockReset();
  mocks.getServerConvexClient.mockReturnValue(null);
});

describe("sitemap health and fallback", () => {
  test("includes every canonical developer resource route", async () => {
    const sitemapModule = await loadSitemapModule();
    const { default: runSitemap } = sitemapModule;

    mocks.getPublishedPostSummaries.mockResolvedValue([]);
    mocks.getPortfolioProjects.mockResolvedValue([]);
    mocks.getPublicNewsletterIssues.mockResolvedValue([]);
    mocks.getNewsTimeline.mockResolvedValue(null);
    mocks.getDailyNews.mockResolvedValue([]);

    const rows = await runSitemap();
    for (const slug of Object.keys(DEVELOPER_RESOURCES)) {
      expect(rows).toContainEqual(
        expect.objectContaining({
          url: primarySiteUrl(`/developers/${slug}`),
        }),
      );
    }
  });

  test("includes public machine-readable resources without exposing admin paths", async () => {
    const sitemapModule = await loadSitemapModule();
    const { default: runSitemap, resetSitemapHealthForTests } = sitemapModule;
    resetSitemapHealthForTests();

    mocks.getPublishedPostSummaries.mockResolvedValue([]);
    mocks.getPortfolioProjects.mockResolvedValue([]);
    mocks.getPublicNewsletterIssues.mockResolvedValue([]);
    mocks.getNewsTimeline.mockResolvedValue(null);
    mocks.getDailyNews.mockResolvedValue([]);

    const rows = await runSitemap();
    expect(rows).toContainEqual(
      expect.objectContaining({ url: primarySiteUrl("/research") }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        url: primarySiteUrl("/research/editorial-trust-and-contracts"),
      }),
    );

    for (const path of [
      "/agents.md",
      "/auth.md",
      "/developers/llms.txt",
      "/llms.txt",
      "/llms-full.txt",
      "/skills.sh",
    ]) {
      expect(rows).toContainEqual(
        expect.objectContaining({ url: primarySiteUrl(path) }),
      );
    }

    for (const path of ["/admin", "/api/admin", "/api/admin/telemetry"]) {
      expect(rows).not.toContainEqual(
        expect.objectContaining({ url: primarySiteUrl(path) }),
      );
    }
  });

  test("uses stale last-known-good snapshot when a source fails", async () => {
    const sitemapModule = await loadSitemapModule();
    const {
      default: runSitemap,
      getSitemapHealthSnapshot,
      resetSitemapHealthForTests,
    } = sitemapModule;
    resetSitemapHealthForTests();

    mocks.getPublishedPostSummaries.mockResolvedValue([
      {
        slug: "first-post",
        featured: true,
        publishedAt: "2026-01-10T00:00:00Z",
      },
    ]);
    mocks.getPortfolioProjects.mockResolvedValue([{ slug: "symba-labs" }]);
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

    mocks.getPublishedPostSummaries.mockRejectedValue(
      new Error("blog source unavailable"),
    );
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
    const {
      default: runSitemap,
      getSitemapHealthSnapshot,
      resetSitemapHealthForTests,
    } = sitemapModule;
    resetSitemapHealthForTests();

    mocks.getPublishedPostSummaries.mockRejectedValue(
      new Error("blog source offline"),
    );
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
