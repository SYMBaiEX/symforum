import { primarySiteUrl, forumSiteUrl } from "@/lib/site-urls";

export const SITEMAP_ENTRY_CAP = 50_000;
export const SITEMAP_REVALIDATE_SECONDS = 3_600;
export const FORUM_SITEMAP_QUERY_LIMIT = 100;
export const FORUM_SITEMAP_PAGE_SIZE = 100;
export const SITE_OBSERVABILITY_KEY_DIRECTORY_URL = primarySiteUrl(
  "/.well-known/http-message-signatures-directory",
);

export const SITE_OBSERVABILITY_SOURCE_NAMES = [
  "blog",
  "portfolio",
  "newsletter",
  "news",
  "forum",
] as const;

export type SiteObservabilitySourceName =
  (typeof SITE_OBSERVABILITY_SOURCE_NAMES)[number];

export type SiteObservabilitySourceState = {
  status: "ok" | "degraded";
  lastAttemptedAt: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
  totalFailures: number;
};

export type SiteObservabilitySnapshot = {
  generatedAt: number;
  consecutiveRunFailures: number;
  lastAlertAt: number | null;
  staleSnapshotAt: number | null;
  staleSnapshotCount: number;
  lastRunDurationMs: number | null;
  lastRunEntryCount: number | null;
  sources: Record<SiteObservabilitySourceName, SiteObservabilitySourceState>;
};

export type SiteObservabilityReport = {
  generatedAt: number;
  sitemap: {
    status: "ok" | "degraded";
    consecutiveRunFailures: number;
    lastAlertAt: number | null;
    lastRunDurationMs: number | null;
    lastRunEntryCount: number | null;
    staleSnapshotAt: number | null;
    staleSnapshotAgeMs: number | null;
    staleSnapshotCount: number;
    entryCap: number;
    sourceStatuses: Record<
      SiteObservabilitySourceName,
      SiteObservabilitySourceState
    >;
  };
  crawl: {
    sitemapUrl: string;
    robotsUrl: string;
    forumHost: string;
    forumCaps: {
      listLimit: number;
      pageSize: number;
    };
    cacheControl: {
      sitemap: string;
      report: string;
    };
  };
  webBotAuth: {
    keyDirectoryUrl: string;
    approvalStatus: "not-claimed";
    edgeVerificationRequiresProxy: true;
  };
};

export function buildSiteObservabilityReport(
  snapshot: SiteObservabilitySnapshot,
): SiteObservabilityReport {
  return {
    generatedAt: snapshot.generatedAt,
    sitemap: {
      status: snapshot.consecutiveRunFailures > 0 ? "degraded" : "ok",
      consecutiveRunFailures: snapshot.consecutiveRunFailures,
      lastAlertAt: snapshot.lastAlertAt,
      lastRunDurationMs: snapshot.lastRunDurationMs,
      lastRunEntryCount: snapshot.lastRunEntryCount,
      staleSnapshotAt: snapshot.staleSnapshotAt,
      staleSnapshotAgeMs:
        snapshot.staleSnapshotAt === null
          ? null
          : Math.max(0, snapshot.generatedAt - snapshot.staleSnapshotAt),
      staleSnapshotCount: snapshot.staleSnapshotCount,
      entryCap: SITEMAP_ENTRY_CAP,
      sourceStatuses: snapshot.sources,
    },
    crawl: {
      sitemapUrl: primarySiteUrl("/sitemap.xml"),
      robotsUrl: primarySiteUrl("/robots.txt"),
      forumHost: forumSiteUrl("/"),
      forumCaps: {
        listLimit: FORUM_SITEMAP_QUERY_LIMIT,
        pageSize: FORUM_SITEMAP_PAGE_SIZE,
      },
      cacheControl: {
        sitemap: `public, max-age=${SITEMAP_REVALIDATE_SECONDS}, s-maxage=${SITEMAP_REVALIDATE_SECONDS}`,
        report: "private, no-store",
      },
    },
    webBotAuth: {
      keyDirectoryUrl: SITE_OBSERVABILITY_KEY_DIRECTORY_URL,
      approvalStatus: "not-claimed",
      edgeVerificationRequiresProxy: true,
    },
  };
}
