/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import aggregateTest from "@convex-dev/aggregate/test";
import migrationsTest from "@convex-dev/migrations/test";
import type { EmailId } from "@convex-dev/resend";
import { describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import { trustedNewsletterSiteUrl } from "./newsletterModel";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  aggregateTest.register(t, "newsletterMetrics");
  migrationsTest.register(t);
  return t;
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
  test("loads only distinct requested newsletter settings by key", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 25; index += 1) {
        await ctx.db.insert("newsletterSettings", {
          key: `newsletter.setting.${index}`,
          value: String(index),
          updatedAt: index,
        });
      }
    });

    const settings = await t.query(internal.newsletter.getSettings, {
      keys: [
        "newsletter.setting.18",
        "newsletter.setting.2",
        "newsletter.setting.18",
      ],
    });

    expect(settings).toEqual([
      { key: "newsletter.setting.18", value: "18" },
      { key: "newsletter.setting.2", value: "2" },
    ]);
  });

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
          tokenVersion: 2,
          tokenPurpose: "confirm",
          tokenExpiresAt: Date.now() + 60_000,
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

  test("resolves and records a redirect from one validated issue snapshot", async () => {
    const t = setup();
    const issueId = await insertSentIssue(t);
    const args = {
      slug: "routing-test",
      target: "source-42",
      visitorKey: "redirect-visitor",
    };

    await expect(
      t.mutation(api.newsletter.resolveAndRecordPublicEngagement, args),
    ).resolves.toEqual({
      destination: {
        url: "https://example.com/source",
        eventType: "source_click",
        hnItemId: 42,
      },
      recorded: true,
    });
    await expect(
      t.mutation(api.newsletter.resolveAndRecordPublicEngagement, args),
    ).resolves.toEqual({
      destination: {
        url: "https://example.com/source",
        eventType: "source_click",
        hnItemId: 42,
      },
      recorded: false,
    });
    await t.run(async (ctx) => {
      const events = await ctx.db
        .query("newsletterEngagements")
        .withIndex("by_issue_event_visitor_story_created", (q) =>
          q.eq("issueId", issueId).eq("eventType", "source_click"),
        )
        .take(3);
      expect(events).toHaveLength(1);
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

  test("does not spend shared rate-limit capacity on a duplicate event", async () => {
    const now = 1_800_000_000_000;
    vi.useFakeTimers({ now });
    try {
      const t = setup();
      const issueId = await insertSentIssue(t);
      await t.run(async (ctx) => {
        await ctx.db.insert("newsletterEngagements", {
          issueId,
          eventType: "archive_view",
          visitorKey: "existing-reader",
          createdAt: now - 5_000,
        });
      });

      let exhausted = false;
      for (let index = 0; index < 200; index += 1) {
        const result = await t.mutation(api.newsletter.recordPublicEngagement, {
          slug: "routing-test",
          eventType: "archive_view",
          visitorKey: `reader-${index}`,
        });
        if ("reason" in result && result.reason === "RATE_LIMITED") {
          exhausted = true;
          break;
        }
        expect(result).toEqual({ recorded: true });
      }
      expect(exhausted).toBe(true);

      await expect(
        t.mutation(api.newsletter.recordPublicEngagement, {
          slug: "routing-test",
          eventType: "archive_view",
          visitorKey: "existing-reader",
        }),
      ).resolves.toEqual({ recorded: false });
    } finally {
      vi.useRealTimers();
    }
  });

  test("keeps a concurrent engagement burst within the shared global capacity", async () => {
    const now = 1_800_000_000_000;
    vi.useFakeTimers({ now });
    try {
      const t = setup();
      const issueId = await insertSentIssue(t);
      const results = await Promise.all(
        Array.from({ length: 240 }, (_, index) =>
          t.mutation(api.newsletter.recordPublicEngagement, {
            slug: "routing-test",
            eventType: "archive_view",
            visitorKey: `burst-reader-${index}`,
          }),
        ),
      );
      const recorded = results.filter((result) => result.recorded).length;
      const rateLimited = results.filter(
        (result) => "reason" in result && result.reason === "RATE_LIMITED",
      ).length;
      const persisted = await t.run(async (ctx) =>
        ctx.db
          .query("newsletterEngagements")
          .withIndex("by_issue_event_visitor_story_created", (q) =>
            q.eq("issueId", issueId).eq("eventType", "archive_view"),
          )
          .take(240),
      );

      // Sharding may reject early when sampled buckets are exhausted, but must
      // never admit more than the configured total token-bucket capacity.
      expect(recorded).toBeLessThanOrEqual(120);
      expect(rateLimited).toBe(240 - recorded);
      expect(persisted).toHaveLength(recorded);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("newsletter provider event storage", () => {
  test("stores normalized fields without retaining the raw provider payload", async () => {
    const t = setup();
    const callback = {
      id: "component-email-opened-1" as EmailId,
      event: {
        type: "email.opened" as const,
        created_at: "2026-10-02T12:00:00.000Z",
        data: {
          created_at: "2026-10-02T12:00:00.000Z",
          email_id: "provider-email-opened-1",
          from: "SYMBaiEX <newsletter@symbaiex.com>",
          to: "reader@example.com",
          subject: "Daily signal",
          open: {
            ipAddress: "203.0.113.7",
            timestamp: "2026-10-02T12:00:00.000Z",
            userAgent: "Example Mail Client",
          },
        },
      },
    };

    await t.mutation(internal.newsletter.handleEmailEvent, callback);

    const events = await t.run(
      async (ctx) => await ctx.db.query("newsletterEvents").collect(),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: "resend",
      eventId: "component-email-opened-1:email.opened:2026-10-02T12:00:00.000Z",
      eventType: "email.opened",
      email: "reader@example.com",
      resendEmailId: "provider-email-opened-1",
    });
    expect(events[0]).not.toHaveProperty("metadataJson");
    expect(JSON.stringify(events[0])).not.toContain("203.0.113.7");
    expect(JSON.stringify(events[0])).not.toContain("Example Mail Client");
  });

  test("uses a known broadcast issue instead of probing contact notifications", async () => {
    const t = setup();
    const componentEmailId = "shared-component-email-id";
    const { issueId, contactRequestId } = await t.run(async (ctx) => {
      const issueId = await ctx.db.insert("newsletterIssues", {
        slug: "broadcast-event",
        subject: "Broadcast event",
        previewText: "Broadcast event test",
        body: "{}",
        status: "sent",
        resendBroadcastId: "broadcast-event-1",
        createdAt: 1,
        updatedAt: 1,
      });
      const contactRequestId = await ctx.db.insert("contactRequests", {
        name: "Person",
        email: "person@example.com",
        emailNormalized: "person@example.com",
        subject: "Question",
        description: "A sufficiently detailed contact request.",
        status: "new",
        resendEmailId: componentEmailId,
        emailDeliveryStatus: "queued",
        createdAt: 1,
        updatedAt: 1,
      });
      return { issueId, contactRequestId };
    });
    const callback = {
      id: componentEmailId as EmailId,
      event: {
        type: "email.opened" as const,
        created_at: "2026-10-02T12:00:00.000Z",
        data: {
          created_at: "2026-10-02T12:00:00.000Z",
          broadcast_id: "broadcast-event-1",
          email_id: "provider-broadcast-email-1",
          from: "SYMBaiEX <newsletter@symbaiex.com>",
          to: "reader@example.com",
          subject: "Broadcast event",
          open: {
            ipAddress: "203.0.113.8",
            timestamp: "2026-10-02T12:00:00.000Z",
            userAgent: "Example Mail Client",
          },
        },
      },
    };

    await t.mutation(internal.newsletter.handleEmailEvent, callback);

    await t.run(async (ctx) => {
      const events = await ctx.db.query("newsletterEvents").collect();
      const contactEvents = await ctx.db.query("contactEmailEvents").collect();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ issueId, eventType: "email.opened" });
      expect(contactEvents).toHaveLength(0);
      expect(
        await ctx.db.get("contactRequests", contactRequestId),
      ).toMatchObject({ emailDeliveryStatus: "queued" });
    });
  });
});

describe("newsletter editorial analytics query fan-out", () => {
  test("skips impossible draft metrics while retaining failed-send metrics", async () => {
    const t = setup();
    const ownerId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          name: "Owner",
          username: "analytics-owner",
          usernameNormalized: "analytics-owner",
          role: "owner",
        }),
    );
    const issueIds = await t.run(async (ctx) => {
      const draftIssueId = await ctx.db.insert("newsletterIssues", {
        slug: "analytics-draft",
        subject: "Analytics draft",
        previewText: "Draft",
        body: "{}",
        status: "draft",
        createdAt: 1,
        updatedAt: 1,
      });
      const scheduledIssueId = await ctx.db.insert("newsletterIssues", {
        slug: "analytics-scheduled",
        subject: "Analytics scheduled",
        previewText: "Scheduled",
        body: "{}",
        status: "scheduled",
        createdAt: 2,
        updatedAt: 2,
      });
      const cancelledIssueId = await ctx.db.insert("newsletterIssues", {
        slug: "analytics-cancelled",
        subject: "Analytics cancelled",
        previewText: "Cancelled",
        body: "{}",
        status: "cancelled",
        createdAt: 3,
        updatedAt: 3,
      });
      const failedIssueId = await ctx.db.insert("newsletterIssues", {
        slug: "analytics-failed",
        subject: "Analytics failed send",
        previewText: "Failed after provider attempt",
        body: "{}",
        status: "failed",
        resendBroadcastId: "analytics-broadcast",
        createdAt: 4,
        updatedAt: 4,
      });
      await ctx.db.insert("newsletterEvents", {
        provider: "resend",
        eventId: "failed-send-delivery-event",
        eventType: "email.delivered",
        issueId: failedIssueId,
        receivedAt: 3,
      });
      await ctx.db.insert("newsletterEngagements", {
        issueId: failedIssueId,
        eventType: "archive_view",
        visitorKey: "reader",
        createdAt: 4,
      });
      return {
        draftIssueId,
        scheduledIssueId,
        cancelledIssueId,
        failedIssueId,
      };
    });

    const recordOpenedEvent = async (id: string) =>
      await t.mutation(internal.newsletter.handleEmailEvent, {
        id: id as EmailId,
        event: {
          type: "email.opened" as const,
          created_at: `2026-10-02T12:00:${id.endsWith("2") ? "02" : "01"}.000Z`,
          data: {
            created_at: "2026-10-02T12:00:01.000Z",
            email_id: `provider-${id}`,
            broadcast_id: "analytics-broadcast",
            from: "SYMBaiEX <newsletter@symbaiex.com>",
            to: "reader@example.com",
            subject: "Analytics issue",
            open: {
              ipAddress: "203.0.113.9",
              timestamp: "2026-10-02T12:00:01.000Z",
              userAgent: "Example Mail Client",
            },
          },
        },
      });

    // This event is written through the new aggregate before backfill. The
    // migration must recognize it rather than count it a second time.
    await recordOpenedEvent("analytics-pre-backfill-open-1");

    const admin = t.withIdentity({ subject: ownerId, name: "Owner" });
    const rows = await admin.query(api.newsletter.adminEditorialAnalytics, {});

    for (const [issueId, status] of [
      [issueIds.draftIssueId, "draft"],
      [issueIds.scheduledIssueId, "scheduled"],
      [issueIds.cancelledIssueId, "cancelled"],
    ] as const) {
      expect(rows.find((row) => row.issueId === issueId)).toMatchObject({
        status,
        delivered: 0,
        archiveViews: 0,
      });
    }
    expect(
      rows.find((row) => row.issueId === issueIds.failedIssueId),
    ).toMatchObject({
      status: "failed",
      delivered: 1,
      opened: 1,
      archiveViews: 1,
    });

    await t.mutation(internal.migrations.backfillNewsletterEventMetrics, {});
    await t.mutation(
      internal.migrations.backfillNewsletterEngagementMetrics,
      {},
    );
    await expect(
      admin.query(api.newsletter.adminEditorialAnalytics, {}),
    ).resolves.toEqual(rows);

    await recordOpenedEvent("analytics-post-backfill-open-2");
    const routedIssueId = await insertSentIssue(t);
    await t.mutation(api.newsletter.recordPublicEngagement, {
      slug: "routing-test",
      eventType: "source_click",
      hnItemId: 42,
      visitorKey: "analytics-after-backfill",
    });

    const aggregatedRows = await admin.query(
      api.newsletter.adminEditorialAnalytics,
      {},
    );
    expect(
      aggregatedRows.find((row) => row.issueId === issueIds.failedIssueId),
    ).toMatchObject({ opened: 2, delivered: 1, archiveViews: 1 });
    expect(
      aggregatedRows.find((row) => row.issueId === routedIssueId),
    ).toMatchObject({ sourceClicks: 1, clicked: 1 });
  });
});

describe("newsletter mailbox capabilities", () => {
  test("new public requests preserve valid management links without extending their expiry", async () => {
    const t = setup();
    const originalHash = "b".repeat(64);
    const originalExpiry = Date.now() + 60_000;
    const id = await t.run(async (ctx) =>
      ctx.db.insert("newsletterSubscribers", {
        email: "mailbox-owner@example.invalid",
        emailNormalized: "mailbox-owner@example.invalid",
        source: "test",
        status: "confirmed",
        tokenHash: originalHash,
        tokenVersion: 2,
        tokenPurpose: "manage",
        tokenExpiresAt: originalExpiry,
        resendSyncStatus: "idle",
        createdAt: 1,
        updatedAt: Date.now() - 4 * 60_000,
      }),
    );
    await t.mutation(api.newsletter.subscribe, {
      email: "mailbox-owner@example.invalid",
    });
    const state = await t.run(async (ctx) => ({
      current: await ctx.db.get("newsletterSubscribers", id),
      links: await ctx.db.query("newsletterManagementLinks").collect(),
    }));
    expect(state.current!.tokenHash).not.toBe(originalHash);
    expect(state.links).toHaveLength(1);
    expect(state.links[0]).toMatchObject({
      subscriberId: id,
      tokenHash: originalHash,
      expiresAt: originalExpiry,
    });
    for (const tokenHash of [originalHash, state.current!.tokenHash]) {
      expect(
        await t.query(api.newsletter.getByToken, { tokenHash }),
      ).toMatchObject({
        status: "confirmed",
      });
    }
    // An early cleanup cannot revoke it; expiration does not depend on cleanup.
    await t.mutation(internal.newsletter.expireManagementLink, {
      linkId: state.links[0]._id,
    });
    expect(
      await t.query(api.newsletter.getByToken, { tokenHash: originalHash }),
    ).not.toBeNull();
    await t.run(async (ctx) =>
      ctx.db.patch("newsletterManagementLinks", state.links[0]._id, {
        expiresAt: Date.now() - 1,
      }),
    );
    expect(
      await t.query(api.newsletter.getByToken, { tokenHash: originalHash }),
    ).toBeNull();
    await t.mutation(internal.newsletter.expireManagementLink, {
      linkId: state.links[0]._id,
    });
    expect(
      await t.run(async (ctx) =>
        ctx.db.get("newsletterManagementLinks", state.links[0]._id),
      ),
    ).toBeNull();
  });

  test("retained management links can unsubscribe but cannot confirm a later signup", async () => {
    const t = setup();
    const tokenHash = "c".repeat(64);
    const id = await t.run(async (ctx) => {
      const subscriberId = await ctx.db.insert("newsletterSubscribers", {
        email: "previous-owner@example.invalid",
        emailNormalized: "previous-owner@example.invalid",
        source: "test",
        status: "confirmed",
        tokenHash: "d".repeat(64),
        tokenVersion: 2,
        tokenPurpose: "manage",
        tokenExpiresAt: Date.now() + 60_000,
        resendSyncStatus: "idle",
        createdAt: 1,
        updatedAt: 1,
      });
      await ctx.db.insert("newsletterManagementLinks", {
        subscriberId,
        tokenHash,
        expiresAt: Date.now() + 60_000,
      });
      return subscriberId;
    });
    expect(
      (await t.mutation(api.newsletter.unsubscribe, { tokenHash })).ok,
    ).toBe(true);
    await t.run(async (ctx) =>
      ctx.db.patch("newsletterSubscribers", id, {
        updatedAt: Date.now() - 4 * 60_000,
      }),
    );
    await t.mutation(api.newsletter.subscribe, {
      email: "previous-owner@example.invalid",
    });
    expect(await t.mutation(api.newsletter.confirm, { tokenHash })).toEqual({
      ok: false,
      subscriber: null,
    });
    await expect(
      t.mutation(api.newsletter.updateTopicsByToken, {
        tokenHash,
        dailyOptIn: true,
        weeklyOptIn: true,
      }),
    ).rejects.toThrow("Confirmed newsletter subscription not found");
    expect(
      await t.run(async (ctx) => ctx.db.get("newsletterSubscribers", id)),
    ).toMatchObject({
      status: "pending",
    });
  });

  test("public callers cannot select confirmation or management tokens", async () => {
    const t = setup();
    const attack = {
      email: "victim@example.invalid",
      token: "chosen",
      tokenHash: "a".repeat(64),
    };
    expect(await t.mutation(api.newsletter.subscribe, attack)).toEqual({
      ok: true,
    });
    expect(
      await t.mutation(api.newsletter.subscribe, { email: attack.email }),
    ).toEqual({ ok: true });
    expect(
      await t.mutation(api.newsletter.confirm, { tokenHash: attack.tokenHash }),
    ).toEqual({ ok: false, subscriber: null });
    const jobs = await t.run(
      async (ctx) =>
        await ctx.db.system.query("_scheduled_functions").collect(),
    );
    const emailed = jobs.find(
      (job) => job.name === "newsletterEmails:sendConfirmationEmail",
    )!.args[0];
    const hash = [
      ...new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(emailed.token),
        ),
      ),
    ]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(
      (await t.mutation(api.newsletter.confirm, { tokenHash: hash })).ok,
    ).toBe(true);
    expect(
      (await t.mutation(api.newsletter.unsubscribe, { tokenHash: hash })).ok,
    ).toBe(true);
    expect(
      (await t.mutation(api.newsletter.confirm, { tokenHash: hash })).ok,
    ).toBe(false);
  });
  test("legacy links expire without changing subscription consent or preferences", async () => {
    const t = setup();
    const id = await t.run(
      async (ctx) =>
        await ctx.db.insert("newsletterSubscribers", {
          email: "existing@example.invalid",
          emailNormalized: "existing@example.invalid",
          source: "test",
          status: "confirmed",
          tokenHash: "a".repeat(64),
          dailyOptIn: false,
          weeklyOptIn: true,
          resendSyncStatus: "idle",
          createdAt: 1,
          updatedAt: 1,
        }),
    );
    expect(
      await t.query(api.newsletter.getByToken, { tokenHash: "a".repeat(64) }),
    ).toBeNull();
    await t.mutation(api.newsletter.subscribe, {
      email: "existing@example.invalid",
    });
    const row = await t.run(
      async (ctx) => await ctx.db.get("newsletterSubscribers", id),
    );
    expect(row).toMatchObject({
      status: "confirmed",
      dailyOptIn: false,
      weeklyOptIn: true,
      tokenVersion: 2,
      tokenPurpose: "manage",
    });
    expect(row!.tokenHash).not.toBe("a".repeat(64));
  });
  test("a profile cannot claim or edit a different mailbox, including old linked rows", async () => {
    const t = setup();
    const userId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          email: "attacker@example.invalid",
          emailVerificationTime: Date.now(),
        }),
    );
    const actor = t.withIdentity({
      subject: userId,
      issuer: "https://convex.test",
    });
    await actor.mutation(api.newsletter.requestViewerSubscription, {
      email: "victim@example.invalid",
    });
    const row = await t.run(
      async (ctx) => await ctx.db.query("newsletterSubscribers").first(),
    );
    expect(row!.userId).toBeUndefined();
    await t.run(
      async (ctx) =>
        await ctx.db.patch("newsletterSubscribers", row!._id, { userId }),
    );
    expect(
      (await actor.query(api.newsletter.viewerPreferences, {}))!.subscriptions,
    ).toEqual([]);
    await expect(
      actor.mutation(api.newsletter.updateViewerTopics, {
        subscriberId: row!._id,
        dailyOptIn: true,
        weeklyOptIn: true,
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("newsletter authorized and expired access", () => {
  test("verified mailbox owners can still manage their own profile subscription", async () => {
    const t = setup();
    const userId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          email: "reader@example.invalid",
          emailVerificationTime: Date.now(),
        }),
    );
    const actor = t.withIdentity({
      subject: userId,
      issuer: "https://convex.test",
    });
    await actor.mutation(api.newsletter.requestViewerSubscription, {
      email: "reader@example.invalid",
    });
    const row = await t.run(
      async (ctx) => await ctx.db.query("newsletterSubscribers").first(),
    );
    expect(row!.userId).toBe(userId);
    await t.mutation(api.newsletter.confirm, { tokenHash: row!.tokenHash });
    await actor.mutation(api.newsletter.updateViewerTopics, {
      subscriberId: row!._id,
      dailyOptIn: false,
      weeklyOptIn: true,
    });
    expect(
      (await actor.query(api.newsletter.viewerPreferences, {}))!
        .subscriptions[0],
    ).toMatchObject({
      status: "confirmed",
      dailyOptIn: false,
      weeklyOptIn: true,
    });
  });
  test("expired backend-issued links cannot read or change subscription state", async () => {
    const t = setup();
    await t.run(
      async (ctx) =>
        await ctx.db.insert("newsletterSubscribers", {
          email: "expired@example.invalid",
          emailNormalized: "expired@example.invalid",
          source: "test",
          status: "confirmed",
          tokenHash: "e".repeat(64),
          tokenVersion: 2,
          tokenPurpose: "manage",
          tokenExpiresAt: Date.now() - 1,
          resendSyncStatus: "idle",
          createdAt: 1,
          updatedAt: 1,
        }),
    );
    expect(
      await t.query(api.newsletter.getByToken, { tokenHash: "e".repeat(64) }),
    ).toBeNull();
    expect(
      (
        await t.mutation(api.newsletter.unsubscribe, {
          tokenHash: "e".repeat(64),
        })
      ).ok,
    ).toBe(false);
    await expect(
      t.mutation(api.newsletter.updateTopicsByToken, {
        tokenHash: "e".repeat(64),
        dailyOptIn: false,
        weeklyOptIn: false,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
