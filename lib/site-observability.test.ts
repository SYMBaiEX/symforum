import { describe, expect, test } from "vitest";

import { buildSiteObservabilityReport } from "./site-observability";

describe("site observability report", () => {
  test("keeps crawler and bot output bounded and sanitized", () => {
    const report = buildSiteObservabilityReport({
      generatedAt: 1_800_000_100_000,
      consecutiveRunFailures: 2,
      lastAlertAt: 1_800_000_050_000,
      staleSnapshotAt: 1_800_000_000_000,
      staleSnapshotCount: 428,
      lastRunDurationMs: 124,
      lastRunEntryCount: 431,
      sources: {
        blog: {
          status: "degraded",
          lastAttemptedAt: 1_800_000_090_000,
          lastSuccessAt: 1_800_000_000_000,
          lastFailureAt: 1_800_000_090_000,
          consecutiveFailures: 2,
          totalFailures: 4,
        },
        portfolio: {
          status: "ok",
          lastAttemptedAt: 1_800_000_090_000,
          lastSuccessAt: 1_800_000_090_000,
          lastFailureAt: null,
          consecutiveFailures: 0,
          totalFailures: 0,
        },
        newsletter: {
          status: "ok",
          lastAttemptedAt: 1_800_000_090_000,
          lastSuccessAt: 1_800_000_090_000,
          lastFailureAt: null,
          consecutiveFailures: 0,
          totalFailures: 0,
        },
        news: {
          status: "ok",
          lastAttemptedAt: 1_800_000_090_000,
          lastSuccessAt: 1_800_000_090_000,
          lastFailureAt: null,
          consecutiveFailures: 0,
          totalFailures: 0,
        },
        forum: {
          status: "ok",
          lastAttemptedAt: 1_800_000_090_000,
          lastSuccessAt: 1_800_000_090_000,
          lastFailureAt: null,
          consecutiveFailures: 0,
          totalFailures: 0,
        },
      },
    });

    expect(report.generatedAt).toBe(1_800_000_100_000);
    expect(report.sitemap.status).toBe("degraded");
    expect(report.sitemap.staleSnapshotAgeMs).toBe(100_000);
    expect(report.sitemap.entryCap).toBe(50_000);
    expect(report.sitemap.sourceStatuses.blog.consecutiveFailures).toBe(2);
    expect(report.crawl.forumCaps).toEqual({
      listLimit: 5_000,
      pageSize: 5_000,
    });
    expect(report.webBotAuth).toEqual({
      keyDirectoryUrl:
        "https://www.symbaiex.com/.well-known/http-message-signatures-directory",
      approvalStatus: "not-claimed",
      edgeVerificationRequiresProxy: true,
    });
    expect(JSON.stringify(report)).not.toContain("top secret");
  });
});
