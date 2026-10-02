import { getFirstPartyAuthUserId as getAuthUserId } from "./authz";
import { HOUR, MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { vOnEmailEventArgs } from "@convex-dev/resend";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { components } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  env,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { enforceAgentScopeIfNeeded, requireSiteAdmin } from "./authz";
import { consumeAgentQuotaIfNeeded } from "./agentQuota";
import {
  listPublicNewsletterIssueDigests,
  parseNewsletterIssueRouting,
  upsertNewsletterIssueDigest,
  type NewsletterIssueRouting,
} from "./newsletterDigests";
import {
  newsletterIssueInputValidator,
  normalizeEmail,
  normalizeIssueInput,
  normalizeNewsletterSource,
  normalizeTokenHash,
  trustedNewsletterSiteUrl,
} from "./newsletterModel";
import { parseEditorialNewsletterPayload } from "./newsletterPayload";
import { applyContactEmailEvent } from "./contact";
import { sha256Base64Url } from "./agentIdentityCrypto";
import { interactionSaveCounts } from "./contentAggregates";
import { migrations } from "./migrations";
import {
  newsletterAnalyticsCounts,
  recordNewsletterMetric,
} from "./newsletterMetrics";
import { readNewsletterSettings } from "./newsletterSettings";

const NEWSLETTER_METRIC_MIGRATIONS = [
  "migrations:backfillNewsletterEventMetrics",
  "migrations:backfillNewsletterEngagementMetrics",
];

const newsletterPublicRateLimiter = new RateLimiter(components.rateLimiter, {
  subscribeGlobal: {
    kind: "token bucket",
    rate: 60,
    period: HOUR,
    capacity: 30,
    shards: 6,
  },
  subscribePerEmail: {
    kind: "token bucket",
    rate: 3,
    period: HOUR,
    capacity: 3,
  },
  engagementGlobal: {
    kind: "token bucket",
    rate: 600,
    period: MINUTE,
    capacity: 120,
    // Keep the same global budget while reducing contention on shared state.
    // The 2026-10-02 production Insights sample reported 77 OCC retries here
    // over 72 hours, with sampled calls retrying up to three times.
    shards: 12,
  },
});

const publicEngagementEventTypeValidator = v.union(
  v.literal("archive_view"),
  v.literal("archive_click"),
  v.literal("source_click"),
  v.literal("discussion_click"),
  v.literal("forum_click"),
  v.literal("news_index_click"),
);

type PublicEngagementEventType =
  | "archive_view"
  | "archive_click"
  | "source_click"
  | "discussion_click"
  | "forum_click"
  | "news_index_click";

type PublicIssueRoutingSnapshot = {
  issueId: Id<"newsletterIssues">;
  forumCategorySlug?: string;
  forumThreadSlug?: string;
  routing: NewsletterIssueRouting;
};

type PublicDestination = {
  url: string;
  eventType: Exclude<PublicEngagementEventType, "archive_view">;
  hnItemId?: number;
};

const sendConfirmationEmailRef = makeFunctionReference<
  "action",
  { subscriberId: Id<"newsletterSubscribers">; token: string; siteUrl: string },
  null
>("newsletterEmails:sendConfirmationEmail");

const sendManageSubscriptionEmailRef = makeFunctionReference<
  "action",
  { subscriberId: Id<"newsletterSubscribers">; token: string; siteUrl: string },
  null
>("newsletterEmails:sendManageSubscriptionEmail");

const sendWelcomeEmailRef = makeFunctionReference<
  "action",
  { subscriberId: Id<"newsletterSubscribers">; siteUrl: string },
  null
>("newsletterEmails:sendWelcomeEmail");

const syncSubscriberRef = makeFunctionReference<
  "action",
  { subscriberId: Id<"newsletterSubscribers"> },
  null
>("newsletterEmails:syncSubscriberToResend");

const sendIssueTestRef = makeFunctionReference<
  "action",
  { issueId: Id<"newsletterIssues">; to: string },
  null
>("newsletterEmails:sendNewsletterIssueTest");

const sendIssueRef = makeFunctionReference<
  "action",
  { issueId: Id<"newsletterIssues"> },
  null
>("newsletterEmails:sendNewsletterIssue");

function scheduledNewsletterSiteUrl(callerSiteUrl?: string) {
  return trustedNewsletterSiteUrl(
    env.NEWSLETTER_SITE_URL,
    env.SITE_URL,
    callerSiteUrl,
  );
}

export const subscribe = mutation({
  args: {
    email: v.string(),
    source: v.optional(v.string()),
    token: v.string(),
    tokenHash: v.string(),
    siteUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const normalizedEmail = normalizeEmail(args.email);
    const emailKey = await sha256Base64Url(normalizedEmail);
    const [globalCapacity, emailCapacity] = await Promise.all([
      newsletterPublicRateLimiter.limit(ctx, "subscribeGlobal", {
        key: "global",
      }),
      newsletterPublicRateLimiter.limit(ctx, "subscribePerEmail", {
        key: emailKey,
      }),
    ]);
    if (!globalCapacity.ok || !emailCapacity.ok) {
      throw new ConvexError({
        code: "NEWSLETTER_RATE_LIMITED",
        message:
          "Newsletter signup is temporarily rate limited. Please try again later.",
        retryAfter: Math.max(
          globalCapacity.ok ? 0 : globalCapacity.retryAfter,
          emailCapacity.ok ? 0 : emailCapacity.retryAfter,
        ),
      });
    }
    const { subscriber, tokenStored } = await upsertPendingSubscriber(ctx, {
      email: normalizedEmail,
      source: args.source,
      tokenHash: args.tokenHash,
    });

    // Only email links built from args.token when that token was actually
    // stored (tokenStored), otherwise the recipient would get a dead link.
    if (tokenStored) {
      if (subscriber.status === "confirmed") {
        // Already confirmed: send a link that lets them manage/unsubscribe,
        // since the recurring issue emails point at /newsletter/preferences.
        await ctx.scheduler.runAfter(0, sendManageSubscriptionEmailRef, {
          subscriberId: subscriber._id,
          token: args.token,
          siteUrl: scheduledNewsletterSiteUrl(args.siteUrl),
        });
      } else {
        await ctx.scheduler.runAfter(0, sendConfirmationEmailRef, {
          subscriberId: subscriber._id,
          token: args.token,
          siteUrl: scheduledNewsletterSiteUrl(args.siteUrl),
        });
      }
    }

    return publicSubscriber(subscriber);
  },
});

export const requestViewerSubscription = mutation({
  args: {
    email: v.string(),
    source: v.optional(v.string()),
    token: v.string(),
    tokenHash: v.string(),
    siteUrl: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Sign in to manage newsletter preferences");
    }
    const user = await ctx.db.get("users", userId);
    enforceAgentScopeIfNeeded(user, "newsletter");

    const { subscriber, tokenStored } = await upsertPendingSubscriber(ctx, {
      email: args.email,
      source: args.source ?? "profile",
      tokenHash: args.tokenHash,
      userId,
    });

    await consumeAgentQuotaIfNeeded(ctx, user, {
      operation: "newsletter.subscribe",
      idempotencyKey: args.idempotencyKey,
    });

    if (subscriber.status !== "confirmed" && tokenStored) {
      await ctx.scheduler.runAfter(0, sendConfirmationEmailRef, {
        subscriberId: subscriber._id,
        token: args.token,
        siteUrl: scheduledNewsletterSiteUrl(args.siteUrl),
      });
    }

    return publicSubscriber(subscriber);
  },
});

export const viewerPreferences = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    const user = await ctx.db.get("users", userId);
    const subscriptions = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(10);

    return {
      userEmail: user?.email ?? user?.contactEmail ?? null,
      subscriptions: subscriptions.map(publicSubscriber),
    };
  },
});

export const updateViewerTopics = mutation({
  args: {
    subscriberId: v.id("newsletterSubscribers"),
    dailyOptIn: v.boolean(),
    weeklyOptIn: v.boolean(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Sign in to manage newsletter preferences");
    }
    const user = await ctx.db.get("users", userId);
    enforceAgentScopeIfNeeded(user, "newsletter");
    const subscriber = await ctx.db.get(
      "newsletterSubscribers",
      args.subscriberId,
    );
    if (subscriber === null || subscriber.userId !== userId) {
      throw new Error("Newsletter subscription not found");
    }
    await consumeAgentQuotaIfNeeded(ctx, user, {
      operation: "newsletter.update-topics",
      idempotencyKey: args.idempotencyKey,
    });
    await ctx.db.patch("newsletterSubscribers", subscriber._id, {
      dailyOptIn: args.dailyOptIn,
      weeklyOptIn: args.weeklyOptIn,
      resendSyncStatus: "idle",
      resendError: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, syncSubscriberRef, {
      subscriberId: subscriber._id,
    });
    const updated = await ctx.db.get("newsletterSubscribers", subscriber._id);
    return updated ? publicSubscriber(updated) : null;
  },
});

export const updateTopicsByToken = mutation({
  args: {
    tokenHash: v.string(),
    dailyOptIn: v.boolean(),
    weeklyOptIn: v.boolean(),
  },
  handler: async (ctx, args) => {
    const subscriber = await subscriberByTokenHash(ctx, args.tokenHash);
    if (subscriber === null || subscriber.status !== "confirmed") {
      throw new Error("Confirmed newsletter subscription not found");
    }
    await ctx.db.patch("newsletterSubscribers", subscriber._id, {
      dailyOptIn: args.dailyOptIn,
      weeklyOptIn: args.weeklyOptIn,
      resendSyncStatus: "idle",
      resendError: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, syncSubscriberRef, {
      subscriberId: subscriber._id,
    });
    const updated = await ctx.db.get("newsletterSubscribers", subscriber._id);
    return updated ? publicSubscriber(updated) : null;
  },
});

export const getByToken = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const subscriber = await subscriberByTokenHash(ctx, args.tokenHash);
    return subscriber ? publicSubscriber(subscriber) : null;
  },
});

export const confirm = mutation({
  args: { tokenHash: v.string(), siteUrl: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const tokenHash = normalizeTokenHash(args.tokenHash);
    const subscriber = await subscriberByTokenHash(ctx, tokenHash);
    if (subscriber === null) {
      return { ok: false, subscriber: null };
    }

    const now = Date.now();
    if (subscriber.status !== "confirmed") {
      await ctx.db.patch("newsletterSubscribers", subscriber._id, {
        status: "confirmed",
        confirmedAt: now,
        unsubscribedAt: undefined,
        resendSyncStatus: "idle",
        resendError: undefined,
        updatedAt: now,
      });
      await ctx.scheduler.runAfter(0, syncSubscriberRef, {
        subscriberId: subscriber._id,
      });
      await ctx.scheduler.runAfter(0, sendWelcomeEmailRef, {
        subscriberId: subscriber._id,
        siteUrl: scheduledNewsletterSiteUrl(args.siteUrl),
      });
    } else {
      await ctx.scheduler.runAfter(0, syncSubscriberRef, {
        subscriberId: subscriber._id,
      });
    }

    const updated = await ctx.db.get("newsletterSubscribers", subscriber._id);
    return { ok: true, subscriber: updated ? publicSubscriber(updated) : null };
  },
});

export const unsubscribe = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, args) => {
    const tokenHash = normalizeTokenHash(args.tokenHash);
    const subscriber = await subscriberByTokenHash(ctx, tokenHash);
    if (subscriber === null) {
      return { ok: false, subscriber: null };
    }

    await ctx.db.patch("newsletterSubscribers", subscriber._id, {
      status: "unsubscribed",
      unsubscribedAt: Date.now(),
      resendSyncStatus: "idle",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, syncSubscriberRef, {
      subscriberId: subscriber._id,
    });

    const updated = await ctx.db.get("newsletterSubscribers", subscriber._id);
    return { ok: true, subscriber: updated ? publicSubscriber(updated) : null };
  },
});

export const listAdminSubscribers = query({
  args: {},
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    const subscribers = await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_createdAt")
      .order("desc")
      .take(200);
    return subscribers.map(publicSubscriber);
  },
});

export const listAdminIssues = query({
  args: {},
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    return await ctx.db
      .query("newsletterIssues")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(100);
  },
});

export const listPublicIssues = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 24), 60));
    return await listPublicNewsletterIssueDigests(ctx, limit);
  },
});

export const readPublicIssueBySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const issue = await issueBySlug(ctx, args.slug);
    return issue?.status === "sent" ? publicIssue(issue) : null;
  },
});

export const resolvePublicDestination = query({
  args: {
    slug: v.string(),
    target: v.string(),
  },
  handler: async (ctx, args) => {
    const issue = await publicIssueRoutingBySlug(ctx, args.slug);
    if (issue === null) return null;
    return publicDestinationForTarget(issue, args.target);
  },
});

export const resolveAndRecordPublicEngagement = mutation({
  args: {
    slug: v.string(),
    target: v.string(),
    visitorKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const issue = await publicIssueRoutingBySlug(ctx, args.slug);
    const destination =
      issue === null ? null : publicDestinationForTarget(issue, args.target);
    if (issue === null || destination === null) {
      return { destination: null, recorded: false };
    }
    const result = await recordPublicEngagementForIssue(ctx, issue, {
      eventType: destination.eventType,
      hnItemId: destination.hnItemId,
      visitorKey: args.visitorKey,
    });
    return { destination, recorded: result.recorded };
  },
});

export const recordPublicEngagement = mutation({
  args: {
    slug: v.string(),
    eventType: publicEngagementEventTypeValidator,
    hnItemId: v.optional(v.number()),
    visitorKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const issue = await publicIssueRoutingBySlug(ctx, args.slug);
    if (issue === null) return { recorded: false };
    return await recordPublicEngagementForIssue(ctx, issue, args);
  },
});

export const readRecentEditorialContext = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 7), 14));
    const issues = await ctx.db
      .query("newsletterIssues")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(limit * 2);
    const payloads = issues
      .map((issue) => parseEditorialNewsletterPayload(issue.body))
      .filter((payload) => payload !== null)
      .slice(0, limit);
    return {
      headlines: payloads.map((payload) => payload.headline),
      theses: payloads.map((payload) => payload.thesis),
      storyIds: [
        ...new Set(
          payloads.flatMap((payload) =>
            payload.stories.map((story) => story.hnItemId),
          ),
        ),
      ],
    };
  },
});

export const adminEditorialAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    const issues = await ctx.db
      .query("newsletterIssues")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(30);
    const metricMigrationStatuses = await migrations.getStatus(ctx, {
      migrations: NEWSLETTER_METRIC_MIGRATIONS,
    });
    const metricsReady =
      metricMigrationStatuses.length === NEWSLETTER_METRIC_MIGRATIONS.length &&
      metricMigrationStatuses.every((status) => status.isDone);
    const eligibleIssueIds = issues
      .filter((issue) => issue.status === "sent" || issue.status === "failed")
      .map((issue) => issue._id);
    const aggregateCounts = metricsReady
      ? await newsletterAnalyticsCounts(ctx, eligibleIssueIds)
      : null;
    const rows = await Promise.all(
      issues.map(async (issue) => {
        let events: Doc<"newsletterEvents">[] = [];
        let engagements: Doc<"newsletterEngagements">[] = [];
        const metrics = aggregateCounts?.get(String(issue._id));
        // Only sent issues can receive public engagement. Failed sends may
        // have partially completed at the provider, so keep their metrics
        // reads; drafts, scheduled, and cancelled issues cannot have either.
        if (
          metrics === undefined &&
          (issue.status === "sent" || issue.status === "failed")
        ) {
          [events, engagements] = await Promise.all([
            ctx.db
              .query("newsletterEvents")
              .withIndex("by_issueId_and_receivedAt", (q) =>
                q.eq("issueId", issue._id),
              )
              .take(2_000),
            ctx.db
              .query("newsletterEngagements")
              .withIndex("by_issueId_and_createdAt", (q) =>
                q.eq("issueId", issue._id),
              )
              .take(2_000),
          ]);
        }
        const forumThread =
          issue.forumCategorySlug && issue.forumThreadSlug
            ? await ctx.db
                .query("forumThreads")
                .withIndex("by_categorySlug_and_slug", (q) =>
                  q
                    .eq("categorySlug", issue.forumCategorySlug!)
                    .eq("slug", issue.forumThreadSlug!),
                )
                .unique()
            : null;
        const payload = parseEditorialNewsletterPayload(issue.body);
        const storyIds =
          payload?.stories.map((story) => String(story.hnItemId)) ?? [];
        const savedInteractionsByStoryId = await interactionSaveCounts(
          ctx,
          "hnStory",
          storyIds,
        );
        return {
          issueId: issue._id,
          slug: issue.slug,
          subject: issue.subject,
          status: issue.status,
          edition: issue.edition,
          qualityScore: issue.qualityScore ?? payload?.quality.score,
          sentAt: issue.sentAt,
          delivered:
            metrics?.delivered ?? countEvent(events, "email.delivered"),
          opened: metrics?.opened ?? countEvent(events, "email.opened"),
          bounced: metrics?.bounced ?? countEvent(events, "email.bounced"),
          complained:
            metrics?.complained ?? countEvent(events, "email.complained"),
          clicked:
            metrics === undefined
              ? engagements.filter((row) => row.eventType.endsWith("_click"))
                  .length
              : metrics.archiveClicks +
                metrics.sourceClicks +
                metrics.discussionClicks +
                metrics.forumClicks +
                metrics.newsIndexClicks,
          archiveViews:
            metrics?.archiveViews ??
            engagements.filter((row) => row.eventType === "archive_view")
              .length,
          sourceClicks:
            metrics?.sourceClicks ??
            engagements.filter((row) => row.eventType === "source_click")
              .length,
          forumClicks:
            metrics?.forumClicks ??
            engagements.filter((row) => row.eventType === "forum_click").length,
          forumReplies: forumThread?.replyCount ?? 0,
          saves: storyIds.reduce(
            (total, storyId) =>
              total + (savedInteractionsByStoryId.get(storyId) ?? 0),
            0,
          ),
        };
      }),
    );
    return rows;
  },
});

export const upsertAdminIssue = mutation({
  args: { issue: newsletterIssueInputValidator },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    return await upsertIssue(ctx, args.issue);
  },
});

export const sendAdminIssueTest = mutation({
  args: { slug: v.string(), to: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const admin = await requireSiteAdmin(ctx);
    const issue = await issueBySlug(ctx, args.slug);
    if (issue === null) {
      throw new Error("Newsletter issue not found");
    }
    const to = normalizeEmail(
      args.to ?? admin.email ?? admin.contactEmail ?? "solsymbaiex@gmail.com",
    );
    await ctx.scheduler.runAfter(0, sendIssueTestRef, {
      issueId: issue._id,
      to,
    });
    return { queued: true };
  },
});

export const sendAdminIssueNow = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const issue = await issueBySlug(ctx, args.slug);
    if (issue === null) {
      throw new Error("Newsletter issue not found");
    }
    if (issue.status === "sent") {
      throw new Error("Newsletter issue already sent");
    }
    await ctx.db.patch("newsletterIssues", issue._id, {
      status: "scheduled",
      scheduledAt: Date.now(),
      errorMessage: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, sendIssueRef, { issueId: issue._id });
    return { queued: true };
  },
});

export const scheduleAdminIssue = mutation({
  args: { slug: v.string(), scheduledAt: v.number() },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const issue = await issueBySlug(ctx, args.slug);
    if (issue === null) {
      throw new Error("Newsletter issue not found");
    }
    if (issue.status === "sent") {
      throw new Error("Newsletter issue already sent");
    }
    await ctx.db.patch("newsletterIssues", issue._id, {
      status: "scheduled",
      scheduledAt: args.scheduledAt,
      errorMessage: undefined,
      updatedAt: Date.now(),
    });
    const delay = Math.max(0, args.scheduledAt - Date.now());
    await ctx.scheduler.runAfter(delay, sendIssueRef, { issueId: issue._id });
    return { scheduled: true };
  },
});

export const cancelAdminIssue = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const issue = await issueBySlug(ctx, args.slug);
    if (issue === null) {
      throw new Error("Newsletter issue not found");
    }
    if (issue.status === "sent") {
      throw new Error("Newsletter issue already sent");
    }
    await ctx.db.patch("newsletterIssues", issue._id, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    return { cancelled: true };
  },
});

export const readSubscriber = internalQuery({
  args: { subscriberId: v.id("newsletterSubscribers") },
  handler: async (ctx, args) => {
    return await ctx.db.get("newsletterSubscribers", args.subscriberId);
  },
});

export const listConfirmedSubscribersForResendSync = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 200));
    return await ctx.db
      .query("newsletterSubscribers")
      .withIndex("by_status_and_createdAt", (q) => q.eq("status", "confirmed"))
      .order("desc")
      .take(limit);
  },
});

export const readIssue = internalQuery({
  args: { issueId: v.id("newsletterIssues") },
  handler: async (ctx, args) => {
    return await ctx.db.get("newsletterIssues", args.issueId);
  },
});

export const getSetting = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const setting = await ctx.db
      .query("newsletterSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return setting?.value ?? null;
  },
});

export const getSettings = internalQuery({
  args: { keys: v.array(v.string()) },
  handler: async (ctx, args) => {
    return await readNewsletterSettings(ctx, args.keys);
  },
});

export const setSetting = internalMutation({
  args: { key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("newsletterSettings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing === null) {
      await ctx.db.insert("newsletterSettings", {
        key: args.key,
        value: args.value,
        updatedAt: Date.now(),
      });
      return null;
    }
    await ctx.db.patch("newsletterSettings", existing._id, {
      value: args.value,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markSubscriberResendState = internalMutation({
  args: {
    subscriberId: v.id("newsletterSubscribers"),
    resendContactId: v.optional(v.string()),
    resendSyncStatus: v.union(
      v.literal("idle"),
      v.literal("synced"),
      v.literal("failed"),
      v.literal("not_configured"),
    ),
    resendError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch("newsletterSubscribers", args.subscriberId, {
      resendContactId: args.resendContactId,
      resendSyncStatus: args.resendSyncStatus,
      resendSyncedAt:
        args.resendSyncStatus === "synced" ? Date.now() : undefined,
      resendError: args.resendError,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const markIssueBroadcast = internalMutation({
  args: {
    issueId: v.id("newsletterIssues"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    resendBroadcastId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const issue = await ctx.db.get("newsletterIssues", args.issueId);
    await ctx.db.patch("newsletterIssues", args.issueId, {
      status: args.status,
      resendBroadcastId: args.resendBroadcastId,
      errorMessage: args.errorMessage,
      sentAt: args.status === "sent" ? Date.now() : undefined,
      updatedAt: Date.now(),
    });
    const updatedIssue = await ctx.db.get("newsletterIssues", args.issueId);
    if (updatedIssue !== null) {
      await upsertNewsletterIssueDigest(ctx, updatedIssue);
    }

    const dailyRun = await ctx.db
      .query("dailyNewsletterRuns")
      .withIndex("by_issueId", (q) => q.eq("issueId", args.issueId))
      .unique();
    if (dailyRun !== null) {
      const now = Date.now();
      await ctx.db.patch("dailyNewsletterRuns", dailyRun._id, {
        status: args.status,
        sentAt: args.status === "sent" ? now : undefined,
        completedAt: now,
        resendBroadcastId: args.resendBroadcastId,
        errorMessage: args.errorMessage,
        updatedAt: now,
      });
      await ctx.db.insert("newsletterSendLogs", {
        runDate: dailyRun.runDate,
        issueId: args.issueId,
        provider: "resend",
        status: args.status,
        resendBroadcastId: args.resendBroadcastId,
        errorMessage: args.errorMessage,
        createdAt: now,
      });
    } else if (issue !== null) {
      await ctx.db.insert("newsletterSendLogs", {
        runDate: issue.slug,
        issueId: args.issueId,
        provider: "resend",
        status: args.status,
        resendBroadcastId: args.resendBroadcastId,
        errorMessage: args.errorMessage,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

export const handleEmailEvent = internalMutation({
  args: vOnEmailEventArgs,
  handler: async (ctx, args) => {
    // The Resend component emits all application email callbacks through this
    // hook. Contact notices are matched by the component email id, never by
    // recipient address, and use their own idempotent event ledger. A known
    // broadcast issue is already sufficient classification, so check it
    // before falling back to the contact-request lookup.
    const data = args.event.data;
    const eventId = `${args.id}:${args.event.type}:${args.event.created_at}`;
    const broadcastId =
      "broadcast_id" in data && typeof data.broadcast_id === "string"
        ? data.broadcast_id
        : undefined;
    let issue: Doc<"newsletterIssues"> | null = null;
    let newsletterEventChecked = false;
    if (broadcastId !== undefined) {
      const existingEvent = await ctx.db
        .query("newsletterEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
        .unique();
      if (existingEvent !== null) return null;
      newsletterEventChecked = true;
      issue = await ctx.db
        .query("newsletterIssues")
        .withIndex("by_resendBroadcastId", (q) =>
          q.eq("resendBroadcastId", broadcastId),
        )
        .unique();
    }
    if (
      issue === null &&
      (await applyContactEmailEvent(ctx, {
        resendEmailId: args.id,
        event: args.event,
      }))
    ) {
      return null;
    }
    const to = Array.isArray(data.to) ? data.to[0] : data.to;
    const email = typeof to === "string" ? to.toLowerCase() : undefined;
    if (!newsletterEventChecked) {
      const existingEvent = await ctx.db
        .query("newsletterEvents")
        .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
        .unique();
      if (existingEvent !== null) return null;
    }

    const subscriber = email
      ? await ctx.db
          .query("newsletterSubscribers")
          .withIndex("by_emailNormalized", (q) =>
            q.eq("emailNormalized", email),
          )
          .unique()
      : null;

    const newsletterEventId = await ctx.db.insert("newsletterEvents", {
      provider: "resend",
      eventId,
      eventType: args.event.type,
      email,
      subscriberId: subscriber?._id,
      issueId: issue?._id,
      resendEmailId: data.email_id,
      receivedAt: Date.now(),
    });
    await recordNewsletterMetric(ctx, {
      issueId: issue?._id,
      scope: "email",
      eventType: args.event.type,
      id: String(newsletterEventId),
    });

    if (subscriber && args.event.type === "email.bounced") {
      await ctx.db.patch("newsletterSubscribers", subscriber._id, {
        status: "bounced",
        resendSyncStatus: "failed",
        resendError: "Email bounced",
        updatedAt: Date.now(),
      });
    }
    if (subscriber && args.event.type === "email.complained") {
      await ctx.db.patch("newsletterSubscribers", subscriber._id, {
        status: "unsubscribed",
        unsubscribedAt: Date.now(),
        resendSyncStatus: "failed",
        resendError: "Spam complaint",
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

// A pending subscriber who re-submits within this window keeps their existing
// token instead of rotating it, so the confirmation email that is still in
// flight stays valid instead of showing "link not recognized".
const RESUBSCRIBE_TOKEN_THROTTLE_MS = 3 * 60 * 1000;

async function upsertPendingSubscriber(
  ctx: MutationCtx,
  args: {
    email: string;
    source?: string;
    tokenHash: string;
    userId?: Id<"users">;
  },
): Promise<{ subscriber: Doc<"newsletterSubscribers">; tokenStored: boolean }> {
  const email = normalizeEmail(args.email);
  const tokenHash = normalizeTokenHash(args.tokenHash);
  const existing = await ctx.db
    .query("newsletterSubscribers")
    .withIndex("by_emailNormalized", (q) => q.eq("emailNormalized", email))
    .unique();
  const now = Date.now();

  if (existing === null) {
    const id = await ctx.db.insert("newsletterSubscribers", {
      email,
      emailNormalized: email,
      userId: args.userId,
      status: "pending",
      source: normalizeNewsletterSource(args.source),
      dailyOptIn: true,
      weeklyOptIn: true,
      tokenHash,
      resendSyncStatus: "idle",
      createdAt: now,
      updatedAt: now,
    });
    const created = await ctx.db.get("newsletterSubscribers", id);
    if (created === null) {
      throw new Error("Could not create newsletter subscription");
    }
    return { subscriber: created, tokenStored: true };
  }

  // Throttle token rotation for rapid re-subscribes while still pending. The
  // caller-supplied token was NOT stored, so its links would be dead — signal
  // tokenStored: false so the caller skips sending an email with those links.
  if (
    existing.status === "pending" &&
    now - existing.updatedAt < RESUBSCRIBE_TOKEN_THROTTLE_MS
  ) {
    return { subscriber: existing, tokenStored: false };
  }

  await ctx.db.patch("newsletterSubscribers", existing._id, {
    email,
    userId: args.userId ?? existing.userId,
    status: existing.status === "confirmed" ? "confirmed" : "pending",
    source: normalizeNewsletterSource(args.source),
    tokenHash,
    resendSyncStatus:
      existing.status === "confirmed" ? existing.resendSyncStatus : "idle",
    resendError: undefined,
    unsubscribedAt: undefined,
    updatedAt: now,
  });
  const updated = await ctx.db.get("newsletterSubscribers", existing._id);
  if (updated === null) {
    throw new Error("Could not update newsletter subscription");
  }
  return { subscriber: updated, tokenStored: true };
}

async function subscriberByTokenHash(
  ctx: { db: MutationCtx["db"] | QueryCtx["db"] },
  tokenHash: string,
) {
  return await ctx.db
    .query("newsletterSubscribers")
    .withIndex("by_tokenHash", (q) =>
      q.eq("tokenHash", normalizeTokenHash(tokenHash)),
    )
    .unique();
}

async function issueBySlug(
  ctx: { db: MutationCtx["db"] | QueryCtx["db"] },
  slug: string,
) {
  const issue = normalizeIssueInput({
    subject: slug,
    previewText: slug,
    body: slug,
    slug,
  });
  return await ctx.db
    .query("newsletterIssues")
    .withIndex("by_slug", (q) => q.eq("slug", issue.slug))
    .unique();
}

function publicDestinationForTarget(
  issue: PublicIssueRoutingSnapshot,
  target: string,
): PublicDestination | null {
  if (target === "forum") {
    return issue.forumCategorySlug && issue.forumThreadSlug
      ? {
          url: `${issue.routing.siteUrl}/forum/${issue.forumCategorySlug}/${issue.forumThreadSlug}`,
          eventType: "forum_click",
        }
      : null;
  }
  if (target === "news") {
    return { url: issue.routing.newsUrl, eventType: "news_index_click" };
  }
  if (target === "archive") {
    return { url: issue.routing.archiveUrl, eventType: "archive_click" };
  }
  const match = target.match(/^(source|discussion)-(\d+)$/);
  if (match === null) return null;

  const storyId = Number(match[2]);
  const story = issue.routing.stories.find(
    (candidate) => candidate.hnItemId === storyId,
  );
  if (story === undefined) return null;
  return {
    url: match[1] === "source" ? story.sourceUrl : story.discussionUrl,
    eventType: match[1] === "source" ? "source_click" : "discussion_click",
    hnItemId: storyId,
  };
}

async function recordPublicEngagementForIssue(
  ctx: MutationCtx,
  issue: PublicIssueRoutingSnapshot,
  args: {
    eventType: PublicEngagementEventType;
    hnItemId?: number;
    visitorKey?: string;
  },
): Promise<
  | { recorded: true }
  | { recorded: false }
  | { recorded: false; reason: "RATE_LIMITED"; retryAfter: number }
> {
  const storyEvent =
    args.eventType === "source_click" || args.eventType === "discussion_click";
  if (
    (storyEvent &&
      (args.hnItemId === undefined ||
        !issue.routing.stories.some(
          (story) => story.hnItemId === args.hnItemId,
        ))) ||
    (!storyEvent && args.hnItemId !== undefined) ||
    (args.eventType === "forum_click" &&
      (!issue.forumCategorySlug || !issue.forumThreadSlug))
  ) {
    return { recorded: false };
  }

  const now = Date.now();
  const visitorKey = normalizeVisitorKey(args.visitorKey);
  if (visitorKey) {
    const dedupeWindow =
      args.eventType === "archive_view" ? 60 * 60 * 1000 : 10 * 1000;
    const duplicate = await ctx.db
      .query("newsletterEngagements")
      .withIndex("by_issue_event_visitor_story_created", (q) =>
        q
          .eq("issueId", issue.issueId)
          .eq("eventType", args.eventType)
          .eq("visitorKey", visitorKey)
          .eq("hnItemId", args.hnItemId)
          .gt("createdAt", now - dedupeWindow),
      )
      .order("desc")
      .take(1);
    if (duplicate.length > 0) return { recorded: false };
  }

  // Deduplicate before touching the shared limiter. Repeated valid events do
  // not create rows, so they should not write the rate-limit component's hot
  // state or contend with unrelated readers.
  const capacity = await newsletterPublicRateLimiter.limit(
    ctx,
    "engagementGlobal",
    { key: "global" },
  );
  if (!capacity.ok) {
    return {
      recorded: false,
      reason: "RATE_LIMITED",
      retryAfter: capacity.retryAfter,
    };
  }

  const engagementId = await ctx.db.insert("newsletterEngagements", {
    issueId: issue.issueId,
    eventType: args.eventType,
    hnItemId: args.hnItemId,
    visitorKey,
    createdAt: now,
  });
  await recordNewsletterMetric(ctx, {
    issueId: issue.issueId,
    scope: "engagement",
    eventType: args.eventType,
    id: String(engagementId),
  });
  return { recorded: true };
}

async function publicIssueRoutingBySlug(
  ctx: { db: MutationCtx["db"] | QueryCtx["db"] },
  slug: string,
): Promise<PublicIssueRoutingSnapshot | null> {
  const normalizedSlug = normalizeIssueInput({
    subject: slug,
    previewText: slug,
    body: slug,
    slug,
  }).slug;
  const digest = await ctx.db
    .query("newsletterIssueDigests")
    .withIndex("by_slug", (q) => q.eq("slug", normalizedSlug))
    .unique();
  if (digest !== null) {
    if (digest.status !== "sent") return null;
    const routing = parseNewsletterIssueRouting(digest.routingJson);
    if (routing !== null) {
      return {
        issueId: digest.issueId,
        forumCategorySlug: digest.forumCategorySlug,
        forumThreadSlug: digest.forumThreadSlug,
        routing,
      };
    }
  }

  // Rolling-deploy and migration fallback. Once the routing projection is
  // populated, public redirects and engagement writes never read full bodies.
  const issue = await issueBySlug(ctx, normalizedSlug);
  if (issue === null || issue.status !== "sent") return null;
  const payload = parseEditorialNewsletterPayload(issue.body);
  if (payload === null) return null;
  return {
    issueId: issue._id,
    forumCategorySlug: issue.forumCategorySlug,
    forumThreadSlug: issue.forumThreadSlug,
    routing: {
      version: 1,
      siteUrl: payload.siteUrl,
      newsUrl: payload.newsUrl,
      archiveUrl: payload.archiveUrl,
      stories: payload.stories.map((story) => ({
        hnItemId: story.hnItemId,
        sourceUrl: story.sourceUrl,
        discussionUrl: story.discussionUrl,
      })),
    },
  };
}

function publicIssue(issue: Doc<"newsletterIssues">) {
  return {
    _id: issue._id,
    _creationTime: issue._creationTime,
    slug: issue.slug,
    subject: issue.subject,
    previewText: issue.previewText,
    body: issue.body,
    edition: issue.edition,
    editorialVersion: issue.editorialVersion,
    qualityScore: issue.qualityScore,
    forumCategorySlug: issue.forumCategorySlug,
    forumThreadSlug: issue.forumThreadSlug,
    sentAt: issue.sentAt,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
  };
}

function normalizeVisitorKey(value: string | undefined) {
  const clean = value
    ?.trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
  return clean || undefined;
}

function countEvent(events: Doc<"newsletterEvents">[], eventType: string) {
  return events.filter((event) => event.eventType === eventType).length;
}

async function upsertIssue(
  ctx: MutationCtx,
  input: Parameters<typeof normalizeIssueInput>[0],
) {
  const issue = normalizeIssueInput(input);
  const existing = await ctx.db
    .query("newsletterIssues")
    .withIndex("by_slug", (q) => q.eq("slug", issue.slug))
    .unique();
  const now = Date.now();

  if (existing === null) {
    const id = await ctx.db.insert("newsletterIssues", {
      ...issue,
      status: issue.status ?? "draft",
      createdAt: now,
      updatedAt: now,
    });
    const inserted = await ctx.db.get("newsletterIssues", id);
    if (inserted !== null) await upsertNewsletterIssueDigest(ctx, inserted);
    return inserted;
  }

  await ctx.db.patch("newsletterIssues", existing._id, {
    ...issue,
    updatedAt: now,
  });
  const updated = await ctx.db.get("newsletterIssues", existing._id);
  if (updated !== null) await upsertNewsletterIssueDigest(ctx, updated);
  return updated;
}

function publicSubscriber(subscriber: Doc<"newsletterSubscribers">) {
  return {
    _id: subscriber._id,
    _creationTime: subscriber._creationTime,
    email: subscriber.email,
    status: subscriber.status,
    source: subscriber.source,
    dailyOptIn: subscriber.dailyOptIn ?? true,
    weeklyOptIn: subscriber.weeklyOptIn ?? true,
    resendContactId: subscriber.resendContactId,
    resendSyncStatus: subscriber.resendSyncStatus,
    resendSyncedAt: subscriber.resendSyncedAt,
    resendError: subscriber.resendError,
    createdAt: subscriber.createdAt,
    confirmedAt: subscriber.confirmedAt,
    unsubscribedAt: subscriber.unsubscribedAt,
    updatedAt: subscriber.updatedAt,
  };
}
