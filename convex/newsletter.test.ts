/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { trustedNewsletterSiteUrl } from "./newsletterModel";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  return convexTest(schema, modules);
}

function editorialBody() {
  return JSON.stringify({
    kind: "editorial-newsletter",
    version: 2,
    edition: "daily-signal",
    runDate: "2026-09-22",
    snapshotDate: "2026-09-22",
    generatedAt: 1,
    siteUrl: "https://www.symbaiex.com",
    newsUrl: "https://www.symbaiex.com/news",
    archiveUrl: "https://www.symbaiex.com/newsletter/routing-test",
    author: {
      name: "Belle",
      role: "AI research editor",
      disclosure: "AI-assisted and source-linked.",
    },
    headline: "Routing projection test",
    dek: "Compact public destinations without the editorial body.",
    thesis: "Public redirects need URLs, not the full newsletter.",
    lead: "A compact projection preserves link validation.",
    stories: [
      {
        hnItemId: 42,
        title: "A source",
        sourceUrl: "https://example.com/source",
        discussionUrl: "https://news.ycombinator.com/item?id=42",
        siteUrl: "https://www.symbaiex.com/news/a-source-42",
        summary: "A summary that should stay out of the routing projection.",
        whyItMatters: "It proves the compact projection is sufficient.",
        takeaways: ["Keep validation exact."],
        signalScore: 90,
      },
    ],
    chart: {
      title: "Signal",
      subtitle: "A compact chart.",
      metricLabel: "Score",
      items: [
        { label: "One", value: 90, note: "High." },
        { label: "Two", value: 80, note: "Medium." },
        { label: "Three", value: 70, note: "Useful." },
      ],
    },
    practicalMoves: ["Use projections.", "Keep a migration fallback."],
    whatToWatch: ["Read volume.", "Redirect correctness."],
    discussion: { question: "Which reads need full content?" },
    methodology: "Validated against the source payload.",
    quality: {
      score: 95,
      sourceCoverage: 100,
      sourceDiversity: 90,
      originality: 90,
      utility: 100,
      notes: [],
    },
  });
}

async function insertSentIssue(t: ReturnType<typeof setup>) {
  const issueId = await t.run(
    async (ctx) =>
      await ctx.db.insert("newsletterIssues", {
        slug: "routing-test",
        subject: "Routing test",
        previewText: "Compact routing",
        body: editorialBody(),
        edition: "daily-signal",
        status: "sent",
        forumCategorySlug: "research",
        forumThreadSlug: "routing-test",
        sentAt: 1,
        createdAt: 1,
        updatedAt: 1,
      }),
  );
  await t.mutation(
    internal.newsletterDigests.backfillNewsletterIssueDigests,
    {},
  );
  return issueId;
}

describe("newsletter email link origin", () => {
  test("uses the configured newsletter origin instead of a caller-controlled origin", () => {
    const trusted = trustedNewsletterSiteUrl(
      "https://news.symbaiex.com/path-that-must-not-be-in-links",
      "https://symbaiex.com",
      "https://attacker.example/confirmation-or-manage-or-welcome",
    );

    // subscribe, requestViewerSubscription, and confirm all pass their legacy
    // caller value here before scheduling confirmation/manage/welcome email.
    expect(trusted).toBe("https://news.symbaiex.com");
    expect(trusted).not.toBe("https://attacker.example");
  });

  test("falls back only through trusted environment values", () => {
    expect(
      trustedNewsletterSiteUrl("not a URL", "https://symbaiex.com/ignored"),
    ).toBe("https://symbaiex.com");
    expect(trustedNewsletterSiteUrl(undefined, "javascript:alert(1)")).toBe(
      "https://symbaiex.com",
    );
  });

  test("never schedules confirmation, manage, or welcome links to a caller origin", async () => {
    const t = setup();
    const tokenHash = (value: string) => value.repeat(64).slice(0, 64);

    await t.mutation(api.newsletter.subscribe, {
      email: "pending@example.com",
      token: "confirmation-token",
      tokenHash: tokenHash("a"),
      siteUrl: "https://attacker.example/confirmation",
    });
    const confirmedId = await t.run(
      async (ctx) =>
        await ctx.db.insert("newsletterSubscribers", {
          email: "confirmed@example.com",
          emailNormalized: "confirmed@example.com",
          status: "confirmed",
          source: "test",
          dailyOptIn: true,
          weeklyOptIn: true,
          tokenHash: tokenHash("b"),
          resendSyncStatus: "idle",
          createdAt: 1,
          updatedAt: 1,
        }),
    );
    await t.mutation(api.newsletter.subscribe, {
      email: "confirmed@example.com",
      token: "manage-token",
      tokenHash: tokenHash("c"),
      siteUrl: "https://attacker.example/manage",
    });
    const welcomeId = await t.run(
      async (ctx) =>
        await ctx.db.insert("newsletterSubscribers", {
          email: "welcome@example.com",
          emailNormalized: "welcome@example.com",
          status: "pending",
          source: "test",
          dailyOptIn: true,
          weeklyOptIn: true,
          tokenHash: tokenHash("d"),
          resendSyncStatus: "idle",
          createdAt: 1,
          updatedAt: 1,
        }),
    );
    await t.mutation(api.newsletter.confirm, {
      tokenHash: tokenHash("d"),
      siteUrl: "https://attacker.example/welcome",
    });

    const scheduled = await t.run(
      async (ctx) =>
        await ctx.db.system.query("_scheduled_functions").collect(),
    );
    const emailJobs = scheduled.filter((job) =>
      [
        "newsletterEmails:sendConfirmationEmail",
        "newsletterEmails:sendManageSubscriptionEmail",
        "newsletterEmails:sendWelcomeEmail",
      ].includes(job.name),
    );
    expect(emailJobs).toHaveLength(3);
    expect(emailJobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "newsletterEmails:sendConfirmationEmail",
          args: [expect.objectContaining({ siteUrl: "https://symbaiex.com" })],
        }),
        expect.objectContaining({
          name: "newsletterEmails:sendManageSubscriptionEmail",
          args: [
            expect.objectContaining({
              subscriberId: confirmedId,
              siteUrl: "https://symbaiex.com",
            }),
          ],
        }),
        expect.objectContaining({
          name: "newsletterEmails:sendWelcomeEmail",
          args: [
            expect.objectContaining({
              subscriberId: welcomeId,
              siteUrl: "https://symbaiex.com",
            }),
          ],
        }),
      ]),
    );
    expect(JSON.stringify(emailJobs)).not.toContain("attacker.example");
  });
});

describe("newsletter public engagement projections", () => {
  test("resolves only projected destinations without retaining editorial copy", async () => {
    const t = setup();
    await insertSentIssue(t);

    await expect(
      t.query(api.newsletter.resolvePublicDestination, {
        slug: "routing-test",
        target: "source-42",
      }),
    ).resolves.toEqual({
      url: "https://example.com/source",
      eventType: "source_click",
      hnItemId: 42,
    });
    await expect(
      t.query(api.newsletter.resolvePublicDestination, {
        slug: "routing-test",
        target: "forum",
      }),
    ).resolves.toEqual({
      url: "https://www.symbaiex.com/forum/research/routing-test",
      eventType: "forum_click",
    });
    await expect(
      t.query(api.newsletter.resolvePublicDestination, {
        slug: "routing-test",
        target: "source-999",
      }),
    ).resolves.toBeNull();
    await t.run(async (ctx) => {
      const digest = await ctx.db
        .query("newsletterIssueDigests")
        .withIndex("by_slug", (q) => q.eq("slug", "routing-test"))
        .unique();
      expect(digest?.routingJson).toContain("https://example.com/source");
      expect(digest?.routingJson).not.toContain(
        "A summary that should stay out of the routing projection.",
      );
    });
  });

  test("deduplicates by the exact visitor and story beyond noisy events", async () => {
    const now = 1_800_000_000_000;
    vi.useFakeTimers({ now });
    const t = setup();
    const issueId = await insertSentIssue(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("newsletterEngagements", {
        issueId,
        eventType: "source_click",
        hnItemId: 42,
        visitorKey: "same-visitor",
        createdAt: now - 5_000,
      });
      for (let index = 0; index < 100; index += 1) {
        await ctx.db.insert("newsletterEngagements", {
          issueId,
          eventType: "source_click",
          hnItemId: 42,
          visitorKey: `noise-${index}`,
          createdAt: now - index,
        });
      }
      await ctx.db.insert("newsletterEngagements", {
        issueId,
        eventType: "archive_view",
        visitorKey: "archive-visitor",
        createdAt: now - 5 * 60 * 1_000,
      });
    });

    await expect(
      t.mutation(api.newsletter.recordPublicEngagement, {
        slug: "routing-test",
        eventType: "source_click",
        hnItemId: 42,
        visitorKey: "same-visitor",
      }),
    ).resolves.toEqual({ recorded: false });
    await expect(
      t.mutation(api.newsletter.recordPublicEngagement, {
        slug: "routing-test",
        eventType: "source_click",
        hnItemId: 999,
        visitorKey: "new-visitor",
      }),
    ).resolves.toEqual({ recorded: false });
    await expect(
      t.mutation(api.newsletter.recordPublicEngagement, {
        slug: "routing-test",
        eventType: "source_click",
        hnItemId: 42,
        visitorKey: "new-visitor",
      }),
    ).resolves.toEqual({ recorded: true });
    await expect(
      t.mutation(api.newsletter.recordPublicEngagement, {
        slug: "routing-test",
        eventType: "archive_view",
        visitorKey: "archive-visitor",
      }),
    ).resolves.toEqual({ recorded: false });
    vi.useRealTimers();
  });
});
