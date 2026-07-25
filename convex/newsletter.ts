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
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireSiteAdmin } from "./authz";
import {
  newsletterIssueInputValidator,
  normalizeEmail,
  normalizeIssueInput,
  normalizeNewsletterSource,
  normalizeSiteUrl,
  normalizeTokenHash,
} from "./newsletterModel";

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
          siteUrl: normalizeSiteUrl(args.siteUrl),
        });
      } else {
        await ctx.scheduler.runAfter(0, sendConfirmationEmailRef, {
          subscriberId: subscriber._id,
          token: args.token,
          siteUrl: normalizeSiteUrl(args.siteUrl),
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
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Sign in to manage newsletter preferences");
    }

    const { subscriber, tokenStored } = await upsertPendingSubscriber(ctx, {
      email: args.email,
      source: args.source ?? "profile",
      tokenHash: args.tokenHash,
      userId,
    });

    if (subscriber.status !== "confirmed" && tokenStored) {
      await ctx.scheduler.runAfter(0, sendConfirmationEmailRef, {
        subscriberId: subscriber._id,
        token: args.token,
        siteUrl: normalizeSiteUrl(args.siteUrl),
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
    const user = await ctx.db.get(userId);
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
      await ctx.db.patch(subscriber._id, {
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
        siteUrl: normalizeSiteUrl(args.siteUrl),
      });
    } else {
      await ctx.scheduler.runAfter(0, syncSubscriberRef, {
        subscriberId: subscriber._id,
      });
    }

    const updated = await ctx.db.get(subscriber._id);
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

    await ctx.db.patch(subscriber._id, {
      status: "unsubscribed",
      unsubscribedAt: Date.now(),
      resendSyncStatus: "idle",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, syncSubscriberRef, {
      subscriberId: subscriber._id,
    });

    const updated = await ctx.db.get(subscriber._id);
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
    await ctx.db.patch(issue._id, {
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
    await ctx.db.patch(issue._id, {
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
    await ctx.db.patch(issue._id, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    return { cancelled: true };
  },
});

export const readSubscriber = internalQuery({
  args: { subscriberId: v.id("newsletterSubscribers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.subscriberId);
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
    return await ctx.db.get(args.issueId);
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
    await ctx.db.patch(existing._id, {
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
    await ctx.db.patch(args.subscriberId, {
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
    const issue = await ctx.db.get(args.issueId);
    await ctx.db.patch(args.issueId, {
      status: args.status,
      resendBroadcastId: args.resendBroadcastId,
      errorMessage: args.errorMessage,
      sentAt: args.status === "sent" ? Date.now() : undefined,
      updatedAt: Date.now(),
    });

    const dailyRun = await ctx.db
      .query("dailyNewsletterRuns")
      .withIndex("by_issueId", (q) => q.eq("issueId", args.issueId))
      .unique();
    if (dailyRun !== null) {
      const now = Date.now();
      await ctx.db.patch(dailyRun._id, {
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
      await ctx.db.patch(subscriber._id, {
        status: "bounced",
        resendSyncStatus: "failed",
        resendError: "Email bounced",
        updatedAt: Date.now(),
      });
    }
    if (subscriber && args.event.type === "email.complained") {
      await ctx.db.patch(subscriber._id, {
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
      tokenHash,
      resendSyncStatus: "idle",
      createdAt: now,
      updatedAt: now,
    });
    const created = await ctx.db.get(id);
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

  await ctx.db.patch(existing._id, {
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
  const updated = await ctx.db.get(existing._id);
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

async function issueBySlug(ctx: MutationCtx, slug: string) {
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
    return await ctx.db.get(id);
  }

  await ctx.db.patch(existing._id, {
    ...issue,
    updatedAt: now,
  });
  return await ctx.db.get(existing._id);
}

function publicSubscriber(subscriber: Doc<"newsletterSubscribers">) {
  return {
    _id: subscriber._id,
    _creationTime: subscriber._creationTime,
    email: subscriber.email,
    status: subscriber.status,
    source: subscriber.source,
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
