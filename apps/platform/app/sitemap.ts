import { getPublishedPostSummaries } from "@/lib/blog-data";
import { getDailyNews, getNewsTimeline } from "@/lib/news-data";
import { newsStoryPath } from "@/lib/news-slugs";
import { getPublicNewsletterIssues } from "@/lib/newsletter-data";
import { forumSiteUrl, primarySiteUrl } from "@/lib/site-urls";
import { getPortfolioProjects } from "@/lib/site-content";
import { convexRefs } from "@/lib/convex-refs";
import { getServerConvexClient } from "@/lib/server-convex";
import { DEVELOPER_RESOURCES } from "@/lib/developer-resources";
import {
  buildSiteObservabilityReport,
  FORUM_SITEMAP_QUERY_LIMIT,
  SITEMAP_ENTRY_CAP,
  SITEMAP_REVALIDATE_SECONDS,
  type SiteObservabilitySnapshot,
  type SiteObservabilitySourceName,
  type SiteObservabilitySourceState,
} from "@/lib/site-observability";
import type { MetadataRoute } from "next";

const PRIMARY_PATHS = [
  "/",
  "/about",
  "/ai-policy",
  "/agent",
  "/research",
  "/research/ai-readable-web",
  "/research/editorial-trust-and-contracts",
  "/research/methodology",
  "/terms",
  "/blog",
  "/contact",
  "/developers",
  ...Object.keys(DEVELOPER_RESOURCES).map((slug) => `/developers/${slug}`),
  "/developers/sandbox",
  "/agents.md",
  "/auth.md",
  "/developers/llms.txt",
  "/llms.txt",
  "/llms-full.txt",
  "/skills.sh",
  "/news",
  "/newsletter",
  "/portfolio",
  "/pricing",
  "/privacy",
];

const FORUM_PATHS = [
  "/",
  "/symf",
  "/agents",
  "/announcements",
  "/calendar",
  "/help",
  "/members",
  "/new-posts",
  "/online",
  "/todays-posts",
];

type SitemapSource = SiteObservabilitySourceName;

type SitemapSourceResult<T> =
  | {
      status: "ok";
      value: T;
    }
  | {
      status: "rejected";
      reason: string;
    };

type SitemapSourceState = SiteObservabilitySourceState & {
  lastFailureMessage: string | null;
};

type SitemapHealthState = {
  generatedAt: number;
  consecutiveRunFailures: number;
  lastAlertAt: number | null;
  staleSnapshotAt: number | null;
  staleSnapshotCount: number;
  lastRunDurationMs: number | null;
  lastRunEntryCount: number | null;
  sources: Record<SitemapSource, SitemapSourceState>;
};

type ForumSitemapResult = {
  status: "ok" | "rejected";
  entries: MetadataRoute.Sitemap;
  reason: string | null;
};

const sourceHealthSeed: SitemapSourceState = {
  status: "ok",
  lastAttemptedAt: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
  consecutiveFailures: 0,
  totalFailures: 0,
  lastFailureMessage: null,
};

const sitemapHealthSeed: SitemapHealthState = {
  generatedAt: 0,
  consecutiveRunFailures: 0,
  lastAlertAt: null,
  staleSnapshotAt: null,
  staleSnapshotCount: 0,
  lastRunDurationMs: null,
  lastRunEntryCount: null,
  sources: {
    blog: { ...sourceHealthSeed },
    portfolio: { ...sourceHealthSeed },
    newsletter: { ...sourceHealthSeed },
    news: { ...sourceHealthSeed },
    forum: { ...sourceHealthSeed },
  },
};

const STALE_FALLBACK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ALERT_FALLBACK_FAILURE_STREAK = 3;

let sitemapHealth: SitemapHealthState = structuredClone(sitemapHealthSeed);
let lastKnownGoodSitemap: MetadataRoute.Sitemap = [];

// Next's segment config must be statically analyzable; keep this literal in
// the export while sharing the same value with the operator report.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const runStartedAt = Date.now();
  const [postsResult, projectsResult, issuesResult, newsResult] =
    await Promise.allSettled([
      getPublishedPostSummaries(),
      getPortfolioProjects(),
      getPublicNewsletterIssues(30),
      getPublicNewsStories(),
    ]);

  const postsSource = toSourceResult(postsResult);
  const portfolioSource = toSourceResult(projectsResult);
  const newsletterSource = toSourceResult(issuesResult);
  const newsSource = toSourceResult(newsResult);
  recordSitemapSourceResult("blog", postsSource);
  recordSitemapSourceResult("portfolio", portfolioSource);
  recordSitemapSourceResult("newsletter", newsletterSource);
  recordSitemapSourceResult("news", newsSource);

  const entries: MetadataRoute.Sitemap = [
    ...PRIMARY_PATHS.map(primaryEntry),
    ...FORUM_PATHS.map(forumEntry),
  ];

  if (postsSource.status === "ok") {
    entries.push(
      ...postsSource.value.map((post) => ({
        url: primarySiteUrl(`/blog/${encodeURIComponent(post.slug)}`),
        lastModified: validDate(post.publishedAt),
        changeFrequency: "monthly" as const,
        priority: post.featured ? 0.8 : 0.6,
      })),
    );
  }

  if (portfolioSource.status === "ok") {
    entries.push(
      ...portfolioSource.value.map((project) => ({
        url: primarySiteUrl(`/portfolio/${encodeURIComponent(project.slug)}`),
        changeFrequency: "monthly" as const,
        priority: 0.6,
      })),
    );
  }

  if (newsletterSource.status === "ok") {
    entries.push(
      ...newsletterSource.value.map((issue) => ({
        url: primarySiteUrl(`/newsletter/${encodeURIComponent(issue.slug)}`),
        lastModified: validDate(issue.sentAt ?? issue.updatedAt),
        changeFrequency: "weekly" as const,
        priority: 0.7,
      })),
    );
  }

  if (newsSource.status === "ok") {
    entries.push(
      ...newsSource.value.map((story) => ({
        url: primarySiteUrl(newsStoryPath(story)),
        lastModified: story.timePosted
          ? validDate(story.timePosted * 1000)
          : undefined,
        changeFrequency: "daily" as const,
        priority: 0.5,
      })),
    );
  }

  const forumResult = await getPublicForumSitemapEntries();
  recordSitemapSourceResult(
    "forum",
    forumResult.status === "ok"
      ? { status: "ok", value: forumResult.entries }
      : {
          status: "rejected",
          reason: forumResult.reason ?? "Forum sitemap source unavailable",
        },
  );
  entries.push(...forumResult.entries);

  const hadSourceFailures =
    postsSource.status === "rejected" ||
    portfolioSource.status === "rejected" ||
    newsletterSource.status === "rejected" ||
    newsSource.status === "rejected" ||
    forumResult.status === "rejected";

  const merged = applySitemapFallback(entries, hadSourceFailures);
  if (merged.usedFallback) {
    console.warn("Sitemap fallback: using stale snapshot", {
      staleAgeMs: merged.staleAgeMs,
      sourceFailures: getFailureSummary(),
    });
  }

  const bounded = dedupeEntries(merged.entries);
  if (bounded.length > SITEMAP_ENTRY_CAP) {
    console.warn(
      `Sitemap entry cap reached: ${bounded.length} > ${SITEMAP_ENTRY_CAP}`,
    );
  }

  const clipped = bounded.slice(0, SITEMAP_ENTRY_CAP);
  if (!hadSourceFailures && clipped.length > 0) {
    lastKnownGoodSitemap = [...clipped];
    sitemapHealth.staleSnapshotAt = Date.now();
    sitemapHealth.staleSnapshotCount = clipped.length;
  }

  sitemapHealth.lastRunDurationMs = Date.now() - runStartedAt;
  sitemapHealth.lastRunEntryCount = clipped.length;
  updateRunHealthSummary(hadSourceFailures);
  return clipped;
}

async function getPublicForumSitemapEntries(): Promise<ForumSitemapResult> {
  const convex = getServerConvexClient();
  if (!convex) return { status: "ok", entries: [], reason: null };

  try {
    const records = await convex.query(
      convexRefs.forum.listPublicSitemapRecords,
      {
        month: new Date().toISOString().slice(0, 7),
        limit: FORUM_SITEMAP_QUERY_LIMIT,
      },
    );
    const entries: MetadataRoute.Sitemap = [
      ...records.categories.map((category) => ({
        url: forumSiteUrl(`/${encodeURIComponent(category.slug)}`),
        lastModified: validDate(category.lastModified),
        changeFrequency: "daily" as const,
        priority: 0.6,
      })),
      ...records.threads.map((thread) => ({
        url: forumSiteUrl(
          `/${encodeURIComponent(thread.categorySlug)}/${encodeURIComponent(thread.slug)}`,
        ),
        lastModified: validDate(thread.lastModified),
        changeFrequency: "daily" as const,
        priority: 0.5,
      })),
      ...records.announcements.map((announcement) => ({
        url: forumSiteUrl(
          `/announcements/${encodeURIComponent(announcement.slug)}`,
        ),
        lastModified: validDate(announcement.lastModified),
        changeFrequency: "weekly" as const,
        priority: 0.4,
      })),
      ...records.helpDocuments.map((document) => ({
        url: forumSiteUrl(`/help/${encodeURIComponent(document.slug)}`),
        lastModified: validDate(document.lastModified),
        changeFrequency: "monthly" as const,
        priority: 0.4,
      })),
      ...records.calendarEvents.map((event) => ({
        url: forumSiteUrl(`/calendar/${encodeURIComponent(event.slug)}`),
        lastModified: validDate(event.lastModified),
        changeFrequency: "monthly" as const,
        priority: 0.3,
      })),
    ];
    return { status: "ok", entries, reason: null };
  } catch (error) {
    return {
      status: "rejected",
      entries: [],
      reason:
        error instanceof Error
          ? error.message
          : "Unable to add public forum routes to sitemap",
    };
  }
}

function primaryEntry(path: string): MetadataRoute.Sitemap[number] {
  return {
    url: primarySiteUrl(path),
    changeFrequency: path === "/" ? "daily" : "weekly",
    priority: path === "/" ? 1 : 0.7,
  };
}

function forumEntry(path: string): MetadataRoute.Sitemap[number] {
  return {
    url: forumSiteUrl(path),
    changeFrequency: path === "/" ? "hourly" : "daily",
    priority: path === "/" ? 0.9 : 0.6,
  };
}

async function getPublicNewsStories() {
  const timeline = await getNewsTimeline();
  if (timeline?.stories?.length) {
    return timeline.stories;
  }
  return await getDailyNews(30);
}

function validDate(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? undefined : date;
}

function dedupeEntries(entries: MetadataRoute.Sitemap) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) {
      return false;
    }
    seen.add(entry.url);
    return true;
  });
}

function toSourceResult<T>(
  result: PromiseSettledResult<T>,
): SitemapSourceResult<T> {
  if (result.status === "fulfilled") {
    return { status: "ok", value: result.value };
  }

  return {
    status: "rejected",
    reason:
      result.reason instanceof Error
        ? result.reason.message
        : "unknown sitemap source failure",
  };
}

function recordSitemapSourceResult<T extends unknown>(
  source: SitemapSource,
  result: SitemapSourceResult<T>,
) {
  const state = sitemapHealth.sources[source];
  const now = Date.now();
  state.lastAttemptedAt = now;

  if (result.status === "ok") {
    state.status = "ok";
    state.lastSuccessAt = now;
    state.consecutiveFailures = 0;
    state.lastFailureMessage = null;
    return;
  }

  state.status = "degraded";
  state.lastFailureAt = now;
  state.lastFailureMessage = sanitizeLogMessage(result.reason);
  state.consecutiveFailures += 1;
  state.totalFailures += 1;
  console.error("Sitemap source unavailable", {
    source,
    message: state.lastFailureMessage,
  });
}

function applySitemapFallback(
  entries: MetadataRoute.Sitemap,
  hadSourceFailures: boolean,
) {
  if (!hadSourceFailures || !isRecentSitemapSnapshot()) {
    return {
      entries,
      usedFallback: false,
      staleAgeMs: null,
    };
  }

  return {
    entries: dedupeEntries([...entries, ...lastKnownGoodSitemap]),
    usedFallback: true,
    staleAgeMs: Date.now() - (sitemapHealth.staleSnapshotAt ?? 0),
  };
}

function isRecentSitemapSnapshot(now = Date.now()) {
  return (
    sitemapHealth.staleSnapshotAt !== null &&
    now - sitemapHealth.staleSnapshotAt <= STALE_FALLBACK_MAX_AGE_MS
  );
}

function getFailureSummary() {
  return Object.fromEntries(
    Object.entries(sitemapHealth.sources).map(([source, state]) => [
      source,
      {
        status: state.status,
        consecutiveFailures: state.consecutiveFailures,
        totalFailures: state.totalFailures,
      },
    ]),
  );
}

function sanitizeLogMessage(message: string) {
  return message.replace(/[\\u0000-\\u001f\\u007f]/g, " ").slice(0, 240);
}

function updateRunHealthSummary(hadSourceFailures: boolean) {
  const now = Date.now();
  sitemapHealth.generatedAt = now;

  if (!hadSourceFailures) {
    sitemapHealth.consecutiveRunFailures = 0;
    return;
  }

  sitemapHealth.consecutiveRunFailures += 1;
  if (
    sitemapHealth.consecutiveRunFailures >= ALERT_FALLBACK_FAILURE_STREAK &&
    (!sitemapHealth.lastAlertAt ||
      now - sitemapHealth.lastAlertAt > STALE_FALLBACK_MAX_AGE_MS / 24)
  ) {
    sitemapHealth.lastAlertAt = now;
    console.error("Sitemap generation remains degraded", {
      entriesAtAlert: lastKnownGoodSitemap.length,
      runFailures: sitemapHealth.consecutiveRunFailures,
      sources: getFailureSummary(),
    });
  }
}

export function getSitemapHealthSnapshot() {
  return {
    generatedAt: sitemapHealth.generatedAt,
    consecutiveRunFailures: sitemapHealth.consecutiveRunFailures,
    lastAlertAt: sitemapHealth.lastAlertAt,
    staleSnapshotAt: sitemapHealth.staleSnapshotAt,
    staleSnapshotCount: sitemapHealth.staleSnapshotCount,
    lastRunDurationMs: sitemapHealth.lastRunDurationMs,
    lastRunEntryCount: sitemapHealth.lastRunEntryCount,
    sources: Object.fromEntries(
      Object.entries(sitemapHealth.sources).map(([source, state]) => [
        source,
        { ...state },
      ]),
    ) as SitemapHealthState["sources"],
  };
}

export function getSitemapObservabilityReport() {
  return buildSiteObservabilityReport(
    stripFailureMessages(getSitemapHealthSnapshot()),
  );
}

export function resetSitemapHealthForTests() {
  sitemapHealth = structuredClone(sitemapHealthSeed);
  lastKnownGoodSitemap = [];
}

function stripFailureMessages(
  snapshot: SitemapHealthState,
): SiteObservabilitySnapshot {
  return {
    generatedAt: snapshot.generatedAt,
    consecutiveRunFailures: snapshot.consecutiveRunFailures,
    lastAlertAt: snapshot.lastAlertAt,
    staleSnapshotAt: snapshot.staleSnapshotAt,
    staleSnapshotCount: snapshot.staleSnapshotCount,
    lastRunDurationMs: snapshot.lastRunDurationMs,
    lastRunEntryCount: snapshot.lastRunEntryCount,
    sources: Object.fromEntries(
      Object.entries(snapshot.sources).map(([source, state]) => [
        source,
        {
          status: state.status,
          lastAttemptedAt: state.lastAttemptedAt,
          lastSuccessAt: state.lastSuccessAt,
          lastFailureAt: state.lastFailureAt,
          consecutiveFailures: state.consecutiveFailures,
          totalFailures: state.totalFailures,
        },
      ]),
    ) as SiteObservabilitySnapshot["sources"],
  };
}
