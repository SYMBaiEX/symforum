import { ALPHA_PUBLISHER_SLUG } from "../lib/forum-alpha-editorial";
import { v } from "convex/values";
import { createThread } from "@convex-dev/agent";
import { RateLimiter, DAY, HOUR } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import {
  env,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { relaySource } from "./xTelegramRelaySchema";
import { enqueueRelay } from "./xTelegramRelayData";
import { admitOriginal } from "./xAgentOriginals";
import { researchSource } from "./telegramYapResearch";
import { requireOwner } from "./authz";
import { xActivityOptions, xOfficialPost, xSealed } from "./xAgentSchema";
import {
  X_ACTIVITY_SCOPES,
  X_ACTIVITY_TTL_MS,
  X_OFFICIAL_SOURCES,
  officialXAuthor,
  validXDraft,
  X_ORIGINAL_INTERVAL_MS,
} from "../lib/x-agent-policy";

const limits = new RateLimiter(components.rateLimiter, {
  xAllActions: { kind: "fixed window", rate: 24, period: DAY },
  xAllSpacing: { kind: "token bucket", rate: 12, period: HOUR, capacity: 1 },
  xOriginals: { kind: "fixed window", rate: 6, period: DAY },
  xOriginalSpacing: {
    kind: "token bucket",
    rate: 1,
    period: X_ORIGINAL_INTERVAL_MS,
    capacity: 1,
  },
  xReads: { kind: "fixed window", rate: 360, period: DAY },
  xRepostsV2: { kind: "fixed window", rate: 12, period: DAY },
  xCommentsV2: { kind: "fixed window", rate: 6, period: DAY },
  xRepostSpacingV2: {
    kind: "token bucket",
    rate: 3,
    period: HOUR,
    capacity: 1,
  },
  xCommentSpacingV2: {
    kind: "token bucket",
    rate: 1,
    period: HOUR,
    capacity: 1,
  },
});
const leaseArgs = { activityId: v.id("xAgentActivity"), lease: v.string() };
const UNSUMMONED_REPLY =
  "X requires this official post to mention the agent or quote one of its posts before an automatic reply. Skipped without sending.";
function writeScope(a: Doc<"xAgentAccounts">) {
  return X_ACTIVITY_SCOPES.every((s) => a.scope?.split(" ").includes(s));
}
export async function configureActivity(
  ctx: MutationCtx,
  a: Doc<"xAgentAccounts">,
  options: {
    reposts: boolean;
    comments: boolean;
    aiRepliesApproved: boolean;
    originals?: boolean;
  },
) {
  if (a.agentSlug === ALPHA_PUBLISHER_SLUG)
    throw Error("Project publisher uses Telegram-first coverage only.");
  if (!a.connected || !writeScope(a))
    throw Error("Reconnect X with posting permission first.");
  if (options.comments && !options.aiRepliesApproved)
    throw Error("X approval is required for AI replies.");
  const prior = await ctx.db
    .query("xAgentActivity")
    .withIndex("by_accountId", (q) => q.eq("accountId", a._id))
    .unique();
  if (prior?.epoch === a.epoch && (prior.lease || prior.refreshClaimed))
    throw Error(
      "External work is in progress or uncertain. Reconcile it; reconnect for a fresh grant if needed.",
    );
  const values = {
    accountId: a._id,
    enabled: options.reposts || options.comments || options.originals === true,
    epoch: a.epoch,
    options: {
      ...options,
      originals: options.originals ?? prior?.options.originals,
    },
    nextOriginalAt: prior?.nextOriginalAt,
    enabledAt: Date.now(),
    nextPollAt: Date.now(),
    cursors: X_OFFICIAL_SOURCES.map((s) => ({ userId: s.userId })),
    lease: undefined,
    leaseUntil: undefined,
    refreshClaimed: undefined,
    holdReason: undefined,
  };
  if (prior) await ctx.db.patch("xAgentActivity", prior._id, values);
  else await ctx.db.insert("xAgentActivity", values);
}
export const configure = mutation({
  args: { agentSlug: v.string(), options: xActivityOptions },
  returns: v.null(),
  handler: async (ctx, args) => {
    const u = await requireOwner(ctx);
    if (u.isAgent) throw Error("A human owner is required.");
    const a = await ctx.db
      .query("xAgentAccounts")
      .withIndex("by_agentSlug", (q) => q.eq("agentSlug", args.agentSlug))
      .unique();
    if (!a || a.ownerUserId !== u._id) throw Error("Account unavailable.");
    if (
      !args.options.reposts &&
      !args.options.comments &&
      !args.options.originals
    ) {
      const row = await ctx.db
        .query("xAgentActivity")
        .withIndex("by_accountId", (q) => q.eq("accountId", a._id))
        .unique();
      if (row)
        await ctx.db.patch("xAgentActivity", row._id, {
          enabled: false,
          options: { ...args.options, originals: false },
          lease: undefined,
          leaseUntil: undefined,
        });
      await ctx.db.patch("xAgentAccounts", a._id, {
        mode: "drafts",
        updatedAt: Date.now(),
      });
    } else await configureActivity(ctx, a, args.options);
    return null;
  },
});
async function active(
  ctx: MutationCtx,
  id: Id<"xAgentActivity">,
  lease: string,
) {
  const r = await ctx.db.get("xAgentActivity", id);
  if (
    !r ||
    !r.enabled ||
    r.lease !== lease ||
    (r.leaseUntil ?? 0) <= Date.now() ||
    env.X_AGENTS_ENABLED !== "true"
  )
    return null;
  const a = await ctx.db.get("xAgentAccounts", r.accountId);
  const user = a && (await ctx.db.get("users", a.ownerUserId));
  const agent =
    a &&
    (await ctx.db
      .query("forumAgents")
      .withIndex("by_slug", (q) => q.eq("slug", a.agentSlug))
      .unique());
  if (
    !a?.connected ||
    !a.grant ||
    !a.xUserId ||
    !writeScope(a) ||
    a.epoch !== r.epoch ||
    user?.role !== "owner" ||
    user.isAgent ||
    !agent?.enabled
  )
    return null;
  return { activity: r, account: a };
}
export const due = internalQuery({
  args: { now: v.number() },
  returns: v.array(v.id("xAgentActivity")),
  handler: async (ctx, { now }) =>
    env.X_AGENTS_ENABLED !== "true"
      ? []
      : (
          await ctx.db
            .query("xAgentActivity")
            .withIndex("by_enabled_and_nextPollAt", (q) =>
              q.eq("enabled", true).lte("nextPollAt", now),
            )
            .take(4)
        ).map((r) => r._id),
});
export const claim = internalMutation({
  args: {
    activityId: v.id("xAgentActivity"),
    lease: v.string(),
    force: v.optional(v.boolean()),
  },
  returns: v.union(
    v.null(),
    v.object({
      activity: schema.doc("xAgentActivity"),
      account: schema.doc("xAgentAccounts"),
    }),
  ),
  handler: async (ctx, args) => {
    const r = await ctx.db.get("xAgentActivity", args.activityId);
    if (!r?.enabled || (!args.force && r.nextPollAt > Date.now())) return null;
    if (r.lease) {
      if ((r.leaseUntil ?? 0) > Date.now()) return null;
      // Expired external work may have refreshed a rotating token or sent a post.
      await ctx.db.patch("xAgentActivity", r._id, {
        enabled: false,
        holdReason:
          "An external operation was interrupted. Reconcile before reconnecting; no automatic replay.",
      });
      return null;
    }
    await ctx.db.patch("xAgentActivity", r._id, {
      lease: args.lease,
      leaseUntil: Date.now() + 8 * 60_000,
      nextPollAt: Date.now() + 60_000,
    });
    const current = await active(ctx, r._id, args.lease);
    if (!current)
      await ctx.db.patch("xAgentActivity", r._id, {
        enabled: false,
        lease: undefined,
        holdReason: "Account access changed. Reconnect to resume.",
      });
    return current;
  },
});
export const release = internalMutation({
  args: {
    ...leaseArgs,
    poll: v.boolean(),
    issue: v.optional(v.string()),
    delayMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const r = await ctx.db.get("xAgentActivity", args.activityId);
    if (r?.lease !== args.lease) return null;
    await ctx.db.patch("xAgentActivity", r._id, {
      lease: undefined,
      leaseUntil: undefined,
      nextPollAt: Date.now() + (args.delayMs ?? 60_000),
      nextSourcePollAt: args.poll
        ? Date.now() + 15 * 60_000
        : r.nextSourcePollAt,
      holdReason: args.issue,
      enabled: args.issue ? false : r.enabled,
    });
    return null;
  },
});
export const apiRead = internalMutation({
  args: leaseArgs,
  returns: v.boolean(),
  handler: async (ctx, args) =>
    Boolean(await active(ctx, args.activityId, args.lease)) &&
    (await limits.limit(ctx, "xReads", { key: args.activityId })).ok,
});
export const refresh = internalMutation({
  args: {
    ...leaseArgs,
    grant: v.optional(xSealed),
    expiresAt: v.optional(v.number()),
    scope: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const c = await active(ctx, args.activityId, args.lease);
    if (!c) return false;
    if (!args.grant) {
      if (c.activity.refreshClaimed) return false;
      await ctx.db.patch("xAgentActivity", c.activity._id, {
        refreshClaimed: true,
      });
    } else {
      if (
        !c.activity.refreshClaimed ||
        !args.expiresAt ||
        !args.scope ||
        !X_ACTIVITY_SCOPES.every((s) => args.scope!.split(" ").includes(s))
      )
        return false;
      await ctx.db.patch("xAgentAccounts", c.account._id, {
        grant: args.grant,
        expiresAt: args.expiresAt,
        scope: args.scope,
        updatedAt: Date.now(),
      });
      await ctx.db.patch("xAgentActivity", c.activity._id, {
        refreshClaimed: undefined,
      });
    }
    return true;
  },
});
export const ingest = internalMutation({
  args: {
    ...leaseArgs,
    userId: v.string(),
    posts: v.array(xOfficialPost),
    relayPosts: v.optional(v.array(relaySource)),
    newestId: v.optional(v.string()),
    nextPage: v.optional(v.string()),
    ownerRequested: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const c = await active(ctx, args.activityId, args.lease);
    if (!c || !officialXAuthor(args.userId) || args.posts.length > 5)
      return null;
    if (
      !args.ownerRequested &&
      args.relayPosts?.every((p) => p.authorId === args.userId)
    )
      await enqueueRelay(ctx, args.relayPosts);
    for (const post of args.posts) {
      if (
        post.authorId !== args.userId ||
        !/^\d{1,19}$/.test(post.id) ||
        post.text.length > 25000 ||
        (post.invitationParent &&
          (env.X_AGENT_FIRST_REPLY_INVITATIONS_ENABLED !== "true" ||
            post.invitationParent.authorId !== post.authorId ||
            !/^\d{1,19}$/.test(post.invitationParent.id) ||
            post.invitationParent.id === post.id ||
            post.replyEligible !== true)) ||
        (!args.ownerRequested && post.createdAt < c.activity.enabledAt) ||
        post.createdAt < Date.now() - X_ACTIVITY_TTL_MS ||
        post.createdAt > Date.now() + 60_000
      )
        continue;
      for (const kind of ["repost", "comment"] as const) {
        if (post.invitationParent && kind === "repost") continue;
        if (
          kind === "repost"
            ? !c.activity.options.reposts
            : !c.activity.options.comments ||
              !c.activity.options.aiRepliesApproved
        )
          continue;
        const key = post.invitationParent
          ? `${c.account._id}:${post.invitationParent.id}:invitation-comment`
          : `${c.account._id}:${post.id}:${kind}`;
        if (post.invitationParent) {
          const rootReply = await ctx.db
            .query("xAgentOperations")
            .withIndex("by_key", (q) =>
              q.eq(
                "key",
                `${c.account._id}:${post.invitationParent!.id}:comment`,
              ),
            )
            .unique();
          // A clearly unsummoned root can be followed by a new invitation.
          // Prior sends, eligible attempts and legacy uncertainty stay blocked.
          if (
            rootReply &&
            !(
              rootReply.post?.replyEligible === false &&
              ["queued", "held"].includes(rootReply.status)
            )
          )
            continue;
        }
        if (
          await ctx.db
            .query("xAgentOperations")
            .withIndex("by_key", (q) => q.eq("key", key))
            .unique()
        )
          continue;
        const jitter = Number(post.id.slice(-3)) % 10;
        await ctx.db.insert("xAgentOperations", {
          accountId: c.account._id,
          epoch: c.account.epoch,
          key,
          kind,
          post,
          ownerRequested: args.ownerRequested,
          status: "queued",
          notBefore:
            Date.now() +
            (args.ownerRequested
              ? 0
              : kind === "comment"
                ? 20 + jitter
                : jitter) *
              60_000,
          expiresAt: post.createdAt + X_ACTIVITY_TTL_MS,
          updatedAt: Date.now(),
        });
      }
    }
    if (!args.ownerRequested)
      await ctx.db.patch("xAgentActivity", c.activity._id, {
        cursors: c.activity.cursors.map((s) =>
          s.userId !== args.userId
            ? s
            : {
                userId: s.userId,
                sinceId: args.nextPage
                  ? s.sinceId
                  : (args.newestId ?? s.newestId ?? s.sinceId),
                page: args.nextPage,
                newestId: args.nextPage
                  ? (args.newestId ?? s.newestId)
                  : undefined,
              },
        ),
      });
    return null;
  },
});
export const next = internalMutation({
  args: leaseArgs,
  returns: v.union(v.null(), schema.doc("xAgentOperations")),
  handler: async (ctx, args) => {
    const c = await active(ctx, args.activityId, args.lease);
    if (!c) return null;
    await admitOriginal(ctx, c.account, c.activity);
    const rows = await ctx.db
      .query("xAgentOperations")
      .withIndex("by_accountId_and_status_and_notBefore", (q) =>
        q
          .eq("accountId", c.account._id)
          .eq("status", "queued")
          .lte("notBefore", Date.now()),
      )
      .take(12);
    for (const op of rows) {
      const permitted =
        op.kind === "original"
          ? op.ownerRequested ||
            (c.activity.options.originals && c.account.mode === "automatic")
          : op.kind === "repost"
            ? c.activity.options.reposts
            : c.activity.options.comments &&
              c.activity.options.aiRepliesApproved;
      if (
        !permitted ||
        op.epoch !== c.account.epoch ||
        (op.kind !== "original" &&
          (!op.post ||
            (!op.ownerRequested && op.post.createdAt < c.activity.enabledAt) ||
            !officialXAuthor(op.post.authorId))) ||
        op.expiresAt <= Date.now() ||
        (op.post?.invitationParent &&
          env.X_AGENT_FIRST_REPLY_INVITATIONS_ENABLED !== "true")
      ) {
        await ctx.db.patch("xAgentOperations", op._id, {
          status: "held",
          issue: "Expired or access changed.",
          updatedAt: Date.now(),
        });
        continue;
      }
      if (op.kind !== "repost") {
        if (op.kind === "comment" && op.post?.replyEligible !== true) {
          await ctx.db.patch("xAgentOperations", op._id, {
            status: "held",
            issue: UNSUMMONED_REPLY,
            updatedAt: Date.now(),
          });
          continue;
        }
        if (!op.draftId) {
          if (op.kind !== "comment" || !op.post) continue;
          if (env.ELIZA_RUNTIME_MODE !== "live") continue;
          const conversationId = await createThread(ctx, components.agent, {
            title: `Private X reply: ${c.account.agentSlug}`,
            summary: "One official public post only. No private histories.",
          });
          const draftId = await ctx.db.insert("xAgentDrafts", {
            ownerUserId: c.account.ownerUserId,
            agentSlug: c.account.agentSlug,
            accountEpoch: c.account.epoch,
            key: op.key,
            kind: "reply",
            officialPost: op.post,
            activityId: op._id,
            brief:
              "A short contextual comment in your own voice. Add a specific reaction rather than generic applause. No link or ticker unless directly relevant.",
            status: "queued",
            conversationId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          await ctx.db.patch("xAgentOperations", op._id, { draftId });
          await ctx.scheduler.runAfter(0, internal.xAgentDraft.generate, {
            draftId,
          });
          continue;
        }
        const d = await ctx.db.get("xAgentDrafts", op.draftId);
        if (
          !d ||
          (d.manuallyEdited && !op.ownerRequested) ||
          ["held", "archived"].includes(d.status)
        ) {
          await ctx.db.patch("xAgentOperations", op._id, {
            status: "held",
            issue: "Reply was held or archived.",
            updatedAt: Date.now(),
          });
          continue;
        }
        if (d.status !== "draft") continue;
      }
      return op;
    }
    return null;
  },
});
export const claimSend = internalMutation({
  args: { ...leaseArgs, operationId: v.id("xAgentOperations") },
  returns: v.union(v.null(), v.object({ text: v.optional(v.string()) })),
  handler: async (ctx, args) => {
    const c = await active(ctx, args.activityId, args.lease);
    const op = await ctx.db.get("xAgentOperations", args.operationId);
    if (
      !c ||
      !op ||
      op.accountId !== c.account._id ||
      op.epoch !== c.account.epoch ||
      op.status !== "queued" ||
      op.notBefore > Date.now() ||
      op.expiresAt <= Date.now() ||
      (op.kind !== "original" &&
        (!op.post || !officialXAuthor(op.post.authorId)))
    )
      return null;
    const enabled =
      op.kind === "original"
        ? op.ownerRequested ||
          (c.activity.options.originals && c.account.mode === "automatic")
        : op.kind === "repost"
          ? c.activity.options.reposts
          : c.activity.options.comments && c.activity.options.aiRepliesApproved;
    if (!enabled) return null;
    if (
      op.post?.invitationParent &&
      env.X_AGENT_FIRST_REPLY_INVITATIONS_ENABLED !== "true"
    )
      return null;
    if (op.kind === "comment" && op.post?.replyEligible !== true) return null;
    const d = op.draftId ? await ctx.db.get("xAgentDrafts", op.draftId) : null;
    if (
      op.kind !== "repost" &&
      (!d ||
        d.status !== "draft" ||
        (d.manuallyEdited && !op.ownerRequested) ||
        (op.approvedText !== undefined && d.text !== op.approvedText) ||
        d.accountEpoch !== c.account.epoch ||
        !d.text ||
        !validXDraft(d.text))
    )
      return null;
    if (d?.sourceThreadId && !(await researchSource(ctx, d.sourceThreadId))) {
      await ctx.db.patch("xAgentOperations", op._id, {
        status: "held",
        issue: "Forum source is no longer eligible.",
        updatedAt: Date.now(),
      });
      return null;
    }
    const names = [
      "xAllSpacing",
      "xAllActions",
      op.kind === "original"
        ? "xOriginalSpacing"
        : op.kind === "repost"
          ? "xRepostSpacingV2"
          : "xCommentSpacingV2",
      op.kind === "original"
        ? "xOriginals"
        : op.kind === "repost"
          ? "xRepostsV2"
          : "xCommentsV2",
    ] as const;
    for (const name of names) {
      const available = await limits.check(ctx, name, { key: c.account._id });
      if (!available.ok) {
        await ctx.db.patch("xAgentOperations", op._id, {
          notBefore: Date.now() + available.retryAfter,
        });
        return null;
      }
    }
    if (d?.text) {
      const recent = await ctx.db
        .query("xAgentOperations")
        .withIndex("by_accountId_and_status_and_notBefore", (q) =>
          q.eq("accountId", c.account._id).eq("status", "confirmed"),
        )
        .order("desc")
        .take(24);
      for (const prior of recent)
        if (prior.draftId) {
          const old = await ctx.db.get("xAgentDrafts", prior.draftId);
          if (
            old?.text?.toLowerCase().replace(/\s+/g, " ") ===
            d.text.toLowerCase().replace(/\s+/g, " ")
          ) {
            await ctx.db.patch("xAgentOperations", op._id, {
              status: "held",
              issue: "Duplicate reply text.",
              updatedAt: Date.now(),
            });
            return null;
          }
        }
    }
    for (const name of names)
      await limits.limit(ctx, name, { key: c.account._id, throws: true });
    if (d)
      await ctx.db.patch("xAgentDrafts", d._id, {
        status: "publishing",
        updatedAt: Date.now(),
      });
    await ctx.db.patch("xAgentOperations", op._id, {
      status: "sending",
      updatedAt: Date.now(),
    });
    return { text: d?.text };
  },
});
export const holdIneligibleReply = internalMutation({
  args: { ...leaseArgs, operationId: v.id("xAgentOperations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const c = await active(ctx, args.activityId, args.lease);
    const op = await ctx.db.get("xAgentOperations", args.operationId);
    if (
      !c ||
      !op ||
      op.accountId !== c.account._id ||
      op.kind !== "comment" ||
      op.status !== "queued"
    )
      return null;
    await ctx.db.patch("xAgentOperations", op._id, {
      status: "held",
      issue: UNSUMMONED_REPLY,
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const finishSend = internalMutation({
  args: {
    ...leaseArgs,
    operationId: v.id("xAgentOperations"),
    resultId: v.optional(v.string()),
    confirmed: v.boolean(),
    issue: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const r = await ctx.db.get("xAgentActivity", args.activityId);
    const op = await ctx.db.get("xAgentOperations", args.operationId);
    // Record a confirmed external result even if the owner paused during flight.
    if (!r || !op || op.accountId !== r.accountId || op.status !== "sending")
      return null;
    await ctx.db.patch("xAgentOperations", op._id, {
      status: args.confirmed ? "confirmed" : "held",
      resultId: args.resultId,
      issue: args.issue,
      updatedAt: Date.now(),
    });
    if (args.confirmed && op.kind === "original")
      await ctx.db.patch("xAgentActivity", r._id, {
        nextOriginalAt: Date.now() + X_ORIGINAL_INTERVAL_MS,
      });
    if (op.draftId)
      await ctx.db.patch("xAgentDrafts", op.draftId, {
        status: args.confirmed ? "published" : "held",
        issues: args.confirmed
          ? []
          : [args.issue ?? "Delivery uncertain. Never replay."],
        updatedAt: Date.now(),
      });
    return null;
  },
});
