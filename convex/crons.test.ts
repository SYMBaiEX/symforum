/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

describe("evidence retention cron", () => {
  test("completed migrations are not polled and idle recovery is hourly", () => {
    const source = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    expect(source).not.toContain("internal.forumSearchProjection.backfill");
    expect(source).not.toContain("internal.forumAgentMemory.backfillForumMemory");
    for (const name of ["recover pending webhook deliveries", "dispatch pending watchlist webhooks", "cleanup semantic search operations"]) {
      expect(source).toContain(`"${name}",\n  { hours: 1 }`);
    }
  });
  test("schedules bounded claim revision cleanup", () => {
    const source = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    expect(source).toContain('"cleanup expired claim revisions"');
    expect(source).toContain('jobKey: "evidence-claim-revision-cleanup"');
    expect(source).toContain('"cronWatchdog:runMutationJob"');
  });

  test("schedules Web Vitals retention cleanup without a public operator route", () => {
    const source = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    expect(source).toContain('"cleanup expired Web Vitals"');
    expect(source).toContain('"webVitals:cleanupExpired"');
  });

  test("runs the fail-closed Web Vitals SLO evaluator hourly", () => {
    const source = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    expect(source).toContain('"evaluate Web Vitals SLOs"');
    expect(source).toContain('jobKey: "web-vitals-slo"');
    expect(source).toContain("{ hours: 1 }");
  });

  test("schedules bounded watchlist webhook dispatch and retention internally", () => {
    const source = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    expect(source).toContain('"dispatch pending watchlist webhooks"');
    expect(source).toContain(
      "internal.evidenceWatchlists.dispatchWebhookOutbox",
    );
    expect(source).toContain('"cleanup retained watchlist webhooks"');
    expect(source).toContain(
      "internal.evidenceWatchlists.cleanupWebhookOutbox",
    );
  });

  test("routes critical evidence, cleanup, and forum recovery work through the watchdog", () => {
    const source = readFileSync(new URL("./crons.ts", import.meta.url), "utf8");
    expect(source).toContain('"cronWatchdog:runActionJob"');
    expect(source).toContain('"cronWatchdog:runMutationJob"');
    expect(source).toContain('"evaluate critical cron effectiveness"');
    expect(source).toContain('jobKey: "evidence-crossref"');
    expect(source).toContain('jobKey: "semantic-cleanup"');
    expect(source).toContain('jobKey: "forum-suki-reply-recovery"');
    expect(source).toContain('jobKey: "newsletter-schedule"');
    expect(source).toContain('jobKey: "evidence-webhook-recovery"');
    expect(source).not.toContain(
      "internal.dailyNewsletter.checkDailyNewsletterSchedule",
    );
    expect(source).not.toContain(
      "internal.evidenceWebhooks.recoverPendingDeliveries",
    );
    expect(source).toContain('"1,11,21,31,41,51 * * * *"');
    expect(source).not.toContain(
      '"evaluate critical cron effectiveness",\n  { minutes: 5 }',
    );
  });
});
