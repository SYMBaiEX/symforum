import { installation, installationBinding, installationMatches } from "./installation";
import { v } from "convex/values";
import { RateLimiter, DAY, HOUR } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import {
  env,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { requireOwner } from "./authz";
import { researchSource } from "./telegramYapResearch";
import schema from "./schema";
import { xSealed } from "./xAgentSchema";
import {
  ALPHA_BOARDS,
  ALPHA_MAX_AGE_MS,
  ALPHA_DELIVERY_TTL_MS,
  ALPHA_PUBLISHER_SLUG,
  ALPHA_X_USER_ID,
  alphaLeadMs,
  alphaShareText,
  alphaProjectMention,
  alphaTelegramText,
} from "../lib/forum-alpha-editorial";
import { X_ACTIVITY_SCOPES, validXDraft } from "../lib/x-agent-policy";
import { telegramBotRegistry } from "../lib/telegram-agent-policy";

const limits = new RateLimiter(components.rateLimiter, {
  alphaRead: {
    kind: "token bucket",
    rate: 1,
    period: 15 * 60_000,
    capacity: 1,
  },
  alphaReadDay: { kind: "fixed window", rate: 6, period: DAY },
  alphaDay: { kind: "fixed window", rate: 6, period: DAY },
  alphaSpacing: {
    kind: "token bucket",
    rate: 1,
    period: 2 * HOUR,
    capacity: 1,
  },
});
function topic() {
  const id = Number(env.TELEGRAM_ALPHA_TOPIC_ID);
  return Number.isSafeInteger(id) &&
    id > 0 &&
    ![1, 7, 9, 13, 85, 273, 296, 310].includes(id)
    ? id
    : null;
}
function enabled() {
  return (
    env.FORUM_ALPHA_DISTRIBUTION_ENABLED === "true" &&
    env.TELEGRAM_AGENTS_ENABLED === "true" &&
    !!topic() &&
    telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).has("suki")
  );
}
async function source(ctx: QueryCtx, row: Doc<"forumAlphaDeliveries">) {
  const s = await researchSource(ctx, row.threadId);
  const t = await ctx.db.get("forumThreads", row.threadId);
  return s &&
    t &&
    t.title === row.title &&
    t.body === row.body &&
    s.url === row.url &&
    ALPHA_BOARDS.some((b) => b === s.category) &&
    Date.now() - row.sourcePublishedAt <= ALPHA_MAX_AGE_MS
    ? s
    : null;
}
async function brand(ctx: QueryCtx) {
  const a = await ctx.db
    .query("xAgentAccounts")
    .withIndex("by_agentSlug", (q) => q.eq("agentSlug", ALPHA_PUBLISHER_SLUG))
    .unique();
  if (
    !a?.connected ||
    a.xUserId !== ALPHA_X_USER_ID ||
    a.username !== installation.x.accounts.symforum ||
    !a.grant ||
    a.publisherHold ||
    !X_ACTIVITY_SCOPES.every((s) => a.scope?.split(" ").includes(s))
  )
    return null;
  const owner = await ctx.db.get("users", a.ownerUserId);
  return owner?.role === "owner" && !owner.isAgent ? a : null;
}
/** Atomic with approved publication. No history backfill, and no private content. */
export async function queueAlphaPublication(
  ctx: MutationCtx,
  args: {
    threadId: Id<"forumThreads">;
    promptVersion?: string;
    qualityScore?: number;
    sourcePublishedAt?: number;
    sourceUrls: string[];
  },
) {
  const at = args.sourcePublishedAt;
  if (
    !enabled() ||
    !args.promptVersion?.includes(":alpha-v1:") ||
    (args.qualityScore ?? 0) < 85 ||
    !at ||
    at > Date.now() + 5 * 60_000 ||
    Date.now() - at > ALPHA_MAX_AGE_MS
  )
    return;
  if (
    await ctx.db
      .query("forumAlphaDeliveries")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique()
  )
    return;
  const s = await researchSource(ctx, args.threadId);
  const t = await ctx.db.get("forumThreads", args.threadId);
  if (
    !s ||
    !t ||
    !ALPHA_BOARDS.some((b) => b === s.category) ||
    !alphaShareText(t.title, s.url)
  )
    return;
  const now = Date.now();
  await ctx.db.insert("forumAlphaDeliveries", {
      installationBinding,
    threadId: t._id,
    title: t.title,
    body: t.body,
    url: s.url,
    sourceUrls: args.sourceUrls.slice(0, 12),
    sourcePublishedAt: at,
    topicId: topic()!,
    telegramStatus: "queued",
    xStatus: "queued",
    createdAt: now,
    updatedAt: now,
    notBefore: now + ALPHA_DELIVERY_TTL_MS,
    expiresAt: now + ALPHA_DELIVERY_TTL_MS,
  });
}
export const due = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("forumAlphaDeliveries"),
      destination: v.union(v.literal("telegram"), v.literal("x")),
    }),
  ),
  handler: async (ctx) => {
    if (!enabled()) return [];
    const tg = await ctx.db
      .query("forumAlphaDeliveries")
      .withIndex("by_telegramStatus_and_createdAt", (q) =>
        q.eq("telegramStatus", "queued"),
      )
      .order("asc")
      .take(1);
    const x = await ctx.db
      .query("forumAlphaDeliveries")
      .withIndex("by_xStatus_and_notBefore", (q) =>
        q.eq("xStatus", "queued").lte("notBefore", Date.now()),
      )
      .take(1);
    return [
      ...tg.map((r) => ({ id: r._id, destination: "telegram" as const })),
      ...x.map((r) => ({ id: r._id, destination: "x" as const })),
    ];
  },
});
const key = { id: v.id("forumAlphaDeliveries") };
export const claimTelegram = internalMutation({
  args: key,
  returns: v.union(
    v.null(),
    v.object({ text: v.string(), topicId: v.number(), url: v.string() }),
  ),
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get("forumAlphaDeliveries", id);
    if (r && !installationMatches(r)) return null;
    if (!r || r.telegramStatus !== "queued" || !enabled()) return null;
    if (
      r.expiresAt <= Date.now() ||
      topic() !== r.topicId ||
      !(await source(ctx, r))
    ) {
      await ctx.db.patch("forumAlphaDeliveries", id, {
        telegramStatus: "skipped",
        xStatus: "skipped",
        issue: "source_or_destination_changed_or_expired",
        updatedAt: Date.now(),
      });
      return null;
    }
    if (!(await limits.limit(ctx, "alphaSpacing", { key: "telegram" })).ok)
      return null;
    if (!(await limits.limit(ctx, "alphaDay", { key: "telegram" })).ok)
      return null;
    await ctx.db.patch("forumAlphaDeliveries", id, {
      telegramStatus: "sending",
      updatedAt: Date.now(),
    });
    return {
      text: alphaTelegramText(r.title, r.body),
      topicId: r.topicId,
      url: r.url,
    };
  },
});
export const finishTelegram = internalMutation({
  args: { ...key, messageId: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { id, messageId }) => {
    const r = await ctx.db.get("forumAlphaDeliveries", id);
    if (!r || r.telegramStatus !== "sending") return null;
    const sent = Number.isSafeInteger(messageId) && messageId! > 0;
    const now = Date.now();
    await ctx.db.patch("forumAlphaDeliveries", id, {
      telegramStatus: sent ? "sent" : "held",
      xStatus: sent ? "queued" : "held",
      telegramMessageId: sent ? messageId : undefined,
      telegramSentAt: sent ? now : undefined,
      notBefore: sent
        ? now + alphaLeadMs(env.FORUM_ALPHA_LEAD_MINUTES)
        : r.notBefore,
      issue: sent ? undefined : "telegram_delivery_unconfirmed",
      updatedAt: now,
    });
    return null;
  },
});
export const claimX = internalMutation({
  args: key,
  returns: v.union(
    v.null(),
    v.object({ account: schema.doc("xAgentAccounts") }),
  ),
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get("forumAlphaDeliveries", id);
    if (r && !installationMatches(r)) return null;
    const a = await brand(ctx);
    if (
      !r ||
      r.xStatus !== "queued" ||
      r.telegramStatus !== "sent" ||
      !r.telegramSentAt ||
      !r.telegramMessageId ||
      !enabled() ||
      env.X_AGENTS_ENABLED !== "true" ||
      !a ||
      a.publisherRefreshClaim ||
      r.notBefore > Date.now() ||
      Date.now() < r.telegramSentAt + alphaLeadMs(env.FORUM_ALPHA_LEAD_MINUTES)
    )
      return null;
    if (r.expiresAt <= Date.now() || !(await source(ctx, r))) {
      await ctx.db.patch("forumAlphaDeliveries", id, {
        xStatus: "skipped",
        issue: "source_changed_or_expired",
        updatedAt: Date.now(),
      });
      return null;
    }
    const handles: string[] = [];
    for (const u of r.sourceUrls.slice(0, 12)) {
      let host;
      try {
        host = new URL(u).hostname.toLowerCase();
      } catch {
        continue;
      }
      const p = await ctx.db
        .query("forumAlphaProjects")
        .withIndex("by_host", (q) => q.eq("host", host))
        .unique();
      if (p && Date.now() - p.updatedAt < 30 * DAY) handles.push(p.username);
    }
    const projects = await ctx.db
      .query("forumAlphaProjects")
      .withIndex("by_updatedAt", (q) =>
        q.gte("updatedAt", Date.now() - 30 * DAY),
      )
      .order("desc")
      .take(80);
    for (const project of projects)
      if (alphaProjectMention(project.name, r.title, r.body))
        handles.push(project.username);
    const text = alphaShareText(r.title, r.url, handles);
    if (!text || !validXDraft(text)) {
      await ctx.db.patch("forumAlphaDeliveries", id, {
        xStatus: "skipped",
        issue: "headline_not_shareable",
        updatedAt: Date.now(),
      });
      return null;
    }
    if (
      !(await limits.limit(ctx, "alphaRead", { key: "x" })).ok ||
      !(await limits.limit(ctx, "alphaReadDay", { key: "x" })).ok
    )
      return null;
    await ctx.db.patch("forumAlphaDeliveries", id, {
      xStatus: "preparing",
      xText: text,
      accountId: a._id,
      accountEpoch: a.epoch,
      updatedAt: Date.now(),
    });
    return { account: a };
  },
});
export const refreshBrand = internalMutation({
  args: {
    ...key,
    grant: v.optional(xSealed),
    scope: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const r = await ctx.db.get("forumAlphaDeliveries", args.id);
    const a = await brand(ctx);
    if (
      !r ||
      r.xStatus !== "preparing" ||
      !a ||
      r.accountId !== a._id ||
      r.accountEpoch !== a.epoch
    )
      return false;
    if (!args.grant) {
      if (a.publisherRefreshClaim) return false;
      await ctx.db.patch("xAgentAccounts", a._id, {
        publisherRefreshClaim: r._id,
      });
      return true;
    }
    if (
      a.publisherRefreshClaim !== r._id ||
      !args.scope ||
      !args.expiresAt ||
      !X_ACTIVITY_SCOPES.every((s) => args.scope!.split(" ").includes(s))
    )
      return false;
    await ctx.db.patch("xAgentAccounts", a._id, {
      grant: args.grant,
      scope: args.scope,
      expiresAt: args.expiresAt,
      publisherRefreshClaim: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});
/** Recheck after rotating refresh and immediately before the irreversible send. */
export const authorizeXSend = internalMutation({
  args: key,
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get("forumAlphaDeliveries", id);
    if (r && !installationMatches(r)) return null;
    const a = await brand(ctx);
    if (
      !r ||
      r.xStatus !== "preparing" ||
      !enabled() ||
      env.X_AGENTS_ENABLED !== "true" ||
      !a ||
      a.publisherRefreshClaim ||
      r.accountEpoch !== a.epoch ||
      r.accountId !== a._id ||
      r.expiresAt <= Date.now() ||
      r.telegramStatus !== "sent" ||
      !r.telegramSentAt ||
      Date.now() <
        r.telegramSentAt + alphaLeadMs(env.FORUM_ALPHA_LEAD_MINUTES) ||
      !(await source(ctx, r))
    )
      return null;
    if (
      !(await limits.limit(ctx, "alphaSpacing", { key: "x" })).ok ||
      !(await limits.limit(ctx, "alphaDay", { key: "x" })).ok
    )
      return null;
    await ctx.db.patch("forumAlphaDeliveries", id, {
      xStatus: "sending",
      updatedAt: Date.now(),
    });
    return r.xText ?? null;
  },
});
export const finishX = internalMutation({
  args: { ...key, postId: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { id, postId }) => {
    const r = await ctx.db.get("forumAlphaDeliveries", id);
    if (!r || !["sending", "preparing"].includes(r.xStatus)) return null;
    await ctx.db.patch("forumAlphaDeliveries", id, {
      xStatus: postId ? "sent" : "held",
      xPostId: postId,
      issue: postId ? undefined : "x_execution_unconfirmed",
      updatedAt: Date.now(),
    });
    if (r.accountId) {
      const a = await ctx.db.get("xAgentAccounts", r.accountId);
      if (a && a.epoch === r.accountEpoch && a.publisherRefreshClaim === r._id)
        await ctx.db.patch("xAgentAccounts", a._id, {
          publisherHold: "refresh_unconfirmed_reconnect_required",
        });
    }
    return null;
  },
});
export const expire = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    // Never requeue a claimed operation. A crashed worker remains an audit hold.
    for (const status of ["sending", "preparing"] as const) {
      const rows = await ctx.db
        .query("forumAlphaDeliveries")
        .withIndex("by_xStatus_and_notBefore", (q) => q.eq("xStatus", status))
        .take(12);
      for (const r of rows)
        if (r.updatedAt < Date.now() - 5 * 60_000) {
          await ctx.db.patch("forumAlphaDeliveries", r._id, {
            xStatus: "held",
            issue: "x_execution_unconfirmed",
            updatedAt: Date.now(),
          });
          if (r.accountId) {
            const a = await ctx.db.get("xAgentAccounts", r.accountId);
            if (
              a &&
              a.epoch === r.accountEpoch &&
              a.publisherRefreshClaim === r._id
            )
              await ctx.db.patch("xAgentAccounts", a._id, {
                publisherHold: "refresh_unconfirmed_reconnect_required",
              });
          }
        }
    }
    const tg = await ctx.db
      .query("forumAlphaDeliveries")
      .withIndex("by_telegramStatus_and_createdAt", (q) =>
        q.eq("telegramStatus", "sending"),
      )
      .take(12);
    for (const r of tg)
      if (r.updatedAt < Date.now() - 5 * 60_000)
        await ctx.db.patch("forumAlphaDeliveries", r._id, {
          telegramStatus: "held",
          xStatus: "held",
          issue: "telegram_delivery_unconfirmed",
          updatedAt: Date.now(),
        });
    return null;
  },
});
export const dashboard = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    topicId: v.union(v.number(), v.null()),
    leadMinutes: v.number(),
    brandConnected: v.boolean(),
    deliveries: v.array(
      v.object({
        id: v.id("forumAlphaDeliveries"),
        title: v.string(),
        telegramStatus: v.string(),
        xStatus: v.string(),
        notBefore: v.number(),
        issue: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const viewer = await requireOwner(ctx);
    if (viewer.isAgent) throw Error("Human owner required");
    return {
      enabled: enabled(),
      topicId: topic(),
      leadMinutes: alphaLeadMs(env.FORUM_ALPHA_LEAD_MINUTES) / 60_000,
      brandConnected: !!(await brand(ctx)),
      deliveries: (
        await ctx.db
          .query("forumAlphaDeliveries")
          .withIndex("by_createdAt")
          .order("desc")
          .take(12)
      ).map((r) => ({
        id: r._id,
        title: r.title,
        telegramStatus: r.telegramStatus,
        xStatus: r.xStatus,
        notBefore: r.notBefore,
        issue: r.issue,
      })),
    };
  },
});
export const verifyProject = mutation({
  args: {
    name: v.optional(v.string()),
    host: v.string(),
    username: v.string(),
    proofUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requireOwner(ctx);
    if (owner.isAgent) throw Error("Human owner required");
    const name = args.name?.trim();
    if (name && !/^[A-Za-z0-9][A-Za-z0-9 .&+\x27-]{5,79}$/.test(name))
      throw Error("Use the project’s full public name.");
    const host = args.host.toLowerCase();
    const url = new URL(args.proofUrl);
    if (
      !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ||
      url.protocol !== "https:" ||
      url.hostname !== host ||
      url.username ||
      url.password ||
      url.port ||
      args.proofUrl.length > 2048 ||
      !/^[A-Za-z0-9_]{1,15}$/.test(args.username)
    )
      throw Error(
        "Use the original project website linking its official X account.",
      );
    const prior = await ctx.db
      .query("forumAlphaProjects")
      .withIndex("by_host", (q) => q.eq("host", host))
      .unique();
    const value = {
      name,
      host,
      username: args.username.toLowerCase(),
      proofUrl: args.proofUrl,
      verifiedBy: owner._id,
      updatedAt: Date.now(),
    };
    if (prior) await ctx.db.patch("forumAlphaProjects", prior._id, value);
    else await ctx.db.insert("forumAlphaProjects", value);
    return null;
  },
});

export const tick = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.runMutation(internal.forumAlphaDistribution.expire, {});
    const due = await ctx.runQuery(internal.forumAlphaDistribution.due, {});
    for (const item of due)
      await ctx.scheduler.runAfter(
        0,
        internal.forumAlphaDelivery.deliver,
        item,
      );
    return null;
  },
});

/** Authenticated CLI diagnostics without any sealed grant or member content. */
export const inspect = internalQuery({
  args: {},
  returns: v.object({
    editorialEnabled: v.boolean(),
    distributionEnabled: v.boolean(),
    topicId: v.union(v.number(), v.null()),
    brandConnected: v.boolean(),
    recent: v.array(
      v.object({
        id: v.id("forumAlphaDeliveries"),
        threadId: v.id("forumThreads"),
        title: v.string(),
        telegramStatus: v.string(),
        xStatus: v.string(),
        telegramMessageId: v.optional(v.number()),
        xPostId: v.optional(v.string()),
        notBefore: v.number(),
        issue: v.optional(v.string()),
      }),
    ),
  }),
  handler: async (ctx) => ({
    editorialEnabled: env.FORUM_ALPHA_EDITORIAL_ENABLED === "true",
    distributionEnabled: enabled(),
    topicId: topic(),
    brandConnected: !!(await brand(ctx)),
    recent: (
      await ctx.db
        .query("forumAlphaDeliveries")
        .withIndex("by_createdAt")
        .order("desc")
        .take(12)
    ).map((r) => ({
      id: r._id,
      threadId: r.threadId,
      title: r.title,
      telegramStatus: r.telegramStatus,
      xStatus: r.xStatus,
      telegramMessageId: r.telegramMessageId,
      xPostId: r.xPostId,
      notBefore: r.notBefore,
      issue: r.issue,
    })),
  }),
});

/** Safe deferral after a confirmed read, before any post request is authorized. */
export const deferX = internalMutation({
  args: { ...key, notBefore: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, notBefore }) => {
    const r = await ctx.db.get("forumAlphaDeliveries", id);
    const a = await brand(ctx);
    if (
      !r ||
      r.xStatus !== "preparing" ||
      !a ||
      a.publisherRefreshClaim ||
      r.accountId !== a._id ||
      r.accountEpoch !== a.epoch ||
      !Number.isFinite(notBefore) ||
      notBefore <= Date.now()
    )
      return null;
    await ctx.db.patch("forumAlphaDeliveries", id, {
      xStatus: notBefore >= r.expiresAt ? "skipped" : "queued",
      notBefore: Math.max(r.notBefore, notBefore),
      accountId: undefined,
      accountEpoch: undefined,
      xText: undefined,
      issue: "recent_account_original",
      updatedAt: Date.now(),
    });
    return null;
  },
});

/** A bounded launch preview of a newly reviewed article, never historical backfill. */
export const queueRecentApproved = internalMutation({
  args: { runKey: v.string(), sourcePublishedAt: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (
      run?.status !== "published" ||
      !run.threadId ||
      !run.promptVersion?.includes(":alpha-v1:")
    )
      return false;
    const thread = await ctx.db.get("forumThreads", run.threadId);
    if (
      !thread ||
      thread.createdAt < Date.now() - 30 * 60_000 ||
      thread.updatedAt !== thread.createdAt
    )
      return false;
    if (
      await ctx.db
        .query("forumAlphaDeliveries")
        .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
        .unique()
    )
      return false;
    await queueAlphaPublication(ctx, {
      threadId: thread._id,
      promptVersion: run.promptVersion,
      qualityScore: run.qualityScore,
      sourceUrls: run.sourceUrls,
      sourcePublishedAt: args.sourcePublishedAt,
    });
    return !!(await ctx.db
      .query("forumAlphaDeliveries")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .unique());
  },
});
