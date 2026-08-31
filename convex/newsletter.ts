import { getAuthUserId } from "@convex-dev/auth/server";
import { vOnEmailEventArgs } from "@convex-dev/resend";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
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
  upsertNewsletterIssueDigest,
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
    const { subscriber, tokenStored } = await upsertPendingSubscriber(ctx, {
      email: args.email,
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
    const issue = await issueBySlug(ctx, args.slug);
    if (issue === null || issue.status !== "sent") {
      return null;
    }
    const payload = parseEditorialNewsletterPayload(issue.body);
    if (payload === null) {
      return null;
    }
    if (args.target === "forum") {
      return issue.forumCategorySlug && issue.forumThreadSlug
        ? {
            url: `${payload.siteUrl}/forum/${issue.forumCategorySlug}/${issue.forumThreadSlug}`,
            eventType: "forum_click" as const,
          }
        : null;
    }
    if (args.target === "news") {
      return {
        url: payload.newsUrl,
        eventType: "news_index_click" as const,
      };
    }
    if (args.target === "archive") {
      return {
        url: payload.archiveUrl,
        eventType: "archive_click" as const,
      };
    }
    const match = args.target.match(/^(source|discussion)-(\d+)$/);
    if (match === null) {
      return null;
    }
    const storyId = Number(match[2]);
    const story = payload.stories.find(
      (candidate) => candidate.hnItemId === storyId,
    );
    if (story === undefined) {
      return null;
    }
    return {
      url: match[1] === "source" ? story.sourceUrl : story.discussionUrl,
      eventType:
        match[1] === "source"
          ? ("source_click" as const)
          : ("discussion_click" as const),
      hnItemId: storyId,
    };
  },
});

export const recordPublicEngagement = mutation({
  args: {
    slug: v.string(),
    eventType: v.union(
      v.literal("archive_view"),
      v.literal("archive_click"),
      v.literal("source_click"),
      v.literal("discussion_click"),
      v.literal("forum_click"),
      v.literal("news_index_click"),
    ),
    hnItemId: v.optional(v.number()),
    visitorKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const issue = await issueBySlug(ctx, args.slug);
    if (issue === null || issue.status !== "sent") {
      return { recorded: false };
    }
    const payload = parseEditorialNewsletterPayload(issue.body);
    if (payload === null) {
      return { recorded: false };
    }
    const storyEvent =
      args.eventType === "source_click" ||
      args.eventType === "discussion_click";
    if (
      (storyEvent &&
        (args.hnItemId === undefined ||
          !payload.stories.some(
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
      const recent = await ctx.db
        .query("newsletterEngagements")
        .withIndex("by_issueId_and_eventType_and_createdAt", (q) =>
          q.eq("issueId", issue._id).eq("eventType", args.eventType),
        )
        .order("desc")
        .take(100);
      const dedupeWindow =
        args.eventType === "archive_view" ? 60 * 60 * 1000 : 10 * 1000;
      if (
        recent.some(
          (row) =>
            row.visitorKey === visitorKey &&
            row.hnItemId === args.hnItemId &&
            now - row.createdAt < dedupeWindow,
        )
      ) {
        return { recorded: false };
      }
    }
    await ctx.db.insert("newsletterEngagements", {
      issueId: issue._id,
      eventType: args.eventType,
      hnItemId: args.hnItemId,
      visitorKey,
      createdAt: now,
    });
    return { recorded: true };
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
    const rows = await Promise.all(
      issues.map(async (issue) => {
        const [events, engagements] = await Promise.all([
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
        const saveRows =
          payload === null
            ? []
            : (
                await Promise.all(
                  payload.stories.map((story) =>
                    ctx.db
                      .query("interactions")
                      .withIndex("by_entityType_and_entityId", (q) =>
                        q
                          .eq("entityType", "hnStory")
                          .eq("entityId", String(story.hnItemId)),
                      )
                      .take(1_000),
                  ),
                )
              ).flat();
        return {
          issueId: issue._id,
          slug: issue.slug,
          subject: issue.subject,
          status: issue.status,
          edition: issue.edition,
          qualityScore: issue.qualityScore ?? payload?.quality.score,
          sentAt: issue.sentAt,
          delivered: countEvent(events, "email.delivered"),
          opened: countEvent(events, "email.opened"),
          bounced: countEvent(events, "email.bounced"),
          complained: countEvent(events, "email.complained"),
          clicked: engagements.filter((row) => row.eventType.endsWith("_click"))
            .length,
          archiveViews: engagements.filter(
            (row) => row.eventType === "archive_view",
          ).length,
          sourceClicks: engagements.filter(
            (row) => row.eventType === "source_click",
          ).length,
          forumClicks: engagements.filter(
            (row) => row.eventType === "forum_click",
          ).length,
          forumReplies: forumThread?.replyCount ?? 0,
          saves: saveRows.filter((row) => row.saved).length,
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
    const keys = [...new Set(args.keys)].slice(0, 20);
    const requested = new Set(keys);
    const rows = await ctx.db.query("newsletterSettings").take(100);
    return rows
      .filter((row) => requested.has(row.key))
      .map((row) => ({ key: row.key, value: row.value }));
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
    // recipient address, and use their own idempotent event ledger.
    if (
      await applyContactEmailEvent(ctx, {
        resendEmailId: args.id,
        event: args.event,
      })
    ) {
      return null;
    }
    const data = args.event.data;
    const to = Array.isArray(data.to) ? data.to[0] : data.to;
    const email = typeof to === "string" ? to.toLowerCase() : undefined;
    const eventId = `${args.id}:${args.event.type}:${args.event.created_at}`;
    const existingEvent = await ctx.db
      .query("newsletterEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", eventId))
      .unique();
    if (existingEvent !== null) {
      return null;
    }

    const subscriber = email
      ? await ctx.db
          .query("newsletterSubscribers")
          .withIndex("by_emailNormalized", (q) =>
            q.eq("emailNormalized", email),
          )
          .unique()
      : null;
    const broadcastId =
      "broadcast_id" in data && typeof data.broadcast_id === "string"
        ? data.broadcast_id
        : undefined;
    const issue = broadcastId
      ? await ctx.db
          .query("newsletterIssues")
          .withIndex("by_resendBroadcastId", (q) =>
            q.eq("resendBroadcastId", broadcastId),
          )
          .unique()
      : null;

    await ctx.db.insert("newsletterEvents", {
      provider: "resend",
      eventId,
      eventType: args.event.type,
      email,
      subscriberId: subscriber?._id,
      issueId: issue?._id,
      resendEmailId: data.email_id,
      metadataJson: JSON.stringify(args.event).slice(0, 5000),
      receivedAt: Date.now(),
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
