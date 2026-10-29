import { v } from "convex/values";
import { createThread } from "@convex-dev/agent";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { components, internal } from "./_generated/api";
import {
  env,
  internalMutation,
  mutation,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireOwner } from "./authz";
import { researchSource } from "./telegramYapResearch";
import {
  X_ACTIVITY_SCOPES,
  X_ORIGINAL_INTERVAL_MS,
  validXDraft,
  xOriginalKind,
} from "../lib/x-agent-policy";

const admission = new RateLimiter(components.rateLimiter, {
  xOriginalGeneration: {
    kind: "token bucket",
    rate: 1,
    period: X_ORIGINAL_INTERVAL_MS,
    capacity: 1,
  },
});
async function ownedActivity(ctx: MutationCtx, slug: string) {
  const u = await requireOwner(ctx);
  if (u.isAgent || env.X_AGENTS_ENABLED !== "true")
    throw Error("Human owner access required.");
  const a = await ctx.db
    .query("xAgentAccounts")
    .withIndex("by_agentSlug", (q) => q.eq("agentSlug", slug))
    .unique();
  if (
    !a ||
    a.ownerUserId !== u._id ||
    !a.connected ||
    !a.grant ||
    !X_ACTIVITY_SCOPES.every((s) => a.scope?.split(" ").includes(s))
  )
    throw Error("Connected posting access required.");
  const r = await ctx.db
    .query("xAgentActivity")
    .withIndex("by_accountId", (q) => q.eq("accountId", a._id))
    .unique();
  if (
    !r ||
    !r.enabled ||
    r.epoch !== a.epoch ||
    r.holdReason ||
    r.refreshClaimed
  )
    throw Error("Resolve the activity hold before publishing.");
  return { a, r, u };
}
export const setAutomatic = mutation({
  args: { agentSlug: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!args.enabled) {
      const u = await requireOwner(ctx);
      if (u.isAgent) throw Error("Human owner required.");
      const a = await ctx.db
        .query("xAgentAccounts")
        .withIndex("by_agentSlug", (q) => q.eq("agentSlug", args.agentSlug))
        .unique();
      if (!a || a.ownerUserId !== u._id) throw Error("Account unavailable.");
      const r = await ctx.db
        .query("xAgentActivity")
        .withIndex("by_accountId", (q) => q.eq("accountId", a._id))
        .unique();
      await ctx.db.patch("xAgentAccounts", a._id, {
        mode: "drafts",
        updatedAt: Date.now(),
      });
      if (r)
        await ctx.db.patch("xAgentActivity", r._id, {
          options: { ...r.options, originals: false },
        });
      return null;
    }
    const { a, r } = await ownedActivity(ctx, args.agentSlug);
    await ctx.db.patch("xAgentAccounts", a._id, {
      mode: "automatic",
      updatedAt: Date.now(),
    });
    await ctx.db.patch("xAgentActivity", r._id, {
      options: { ...r.options, originals: true },
      nextOriginalAt: r.nextOriginalAt ?? Date.now() + X_ORIGINAL_INTERVAL_MS,
    });
    return null;
  },
});
export const queueApproved = internalMutation({
  args: { draftId: v.id("xAgentDrafts") },
  returns: v.object({
    activityId: v.id("xAgentActivity"),
    operationId: v.id("xAgentOperations"),
  }),
  handler: async (ctx, { draftId }) => {
    const u = await requireOwner(ctx);
    const d = await ctx.db.get("xAgentDrafts", draftId);
    if (!d || d.ownerUserId !== u._id || d.kind === "reply")
      throw Error("Original draft unavailable.");
    const { a, r } = await ownedActivity(ctx, d.agentSlug);
    const key = `publish:${a._id}:${d._id}`;
    const prior = await ctx.db
      .query("xAgentOperations")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (prior) return { activityId: r._id, operationId: prior._id };
    if (
      d.status !== "draft" ||
      !d.text ||
      !validXDraft(d.text) ||
      (d.sourceThreadId && !(await researchSource(ctx, d.sourceThreadId)))
    )
      throw Error("Only a ready, current original draft can be published.");
    const operationId = await ctx.db.insert("xAgentOperations", {
      accountId: a._id,
      epoch: a.epoch,
      key,
      kind: "original",
      ownerRequested: true,
      approvedText: d.text,
      draftId: d._id,
      status: "queued",
      notBefore: Date.now(),
      expiresAt: Date.now() + 2 * 60 * 60_000,
      updatedAt: Date.now(),
    });
    await ctx.db.patch("xAgentDrafts", d._id, { accountEpoch: a.epoch });
    await ctx.db.patch("xAgentActivity", r._id, {
      nextPollAt: Date.now(),
      nextOriginalAt: Date.now() + X_ORIGINAL_INTERVAL_MS,
    });
    return { activityId: r._id, operationId };
  },
});
export async function admitOriginal(
  ctx: MutationCtx,
  a: Doc<"xAgentAccounts">,
  r: Doc<"xAgentActivity">,
) {
  if (
    !r.options.originals ||
    a.mode !== "automatic" ||
    env.ELIZA_RUNTIME_MODE !== "live" ||
    (r.nextOriginalAt ?? Infinity) > Date.now()
  )
    return;
  const key = `original4:${a._id}:${Math.floor(Date.now() / X_ORIGINAL_INTERVAL_MS)}`;
  // Admission advances before inference, so failures never become retry loops.
  await ctx.db.patch("xAgentActivity", r._id, {
    nextOriginalAt: Date.now() + X_ORIGINAL_INTERVAL_MS,
  });
  if (
    await ctx.db
      .query("xAgentOperations")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique()
  )
    return;
  if (!(await admission.limit(ctx, "xOriginalGeneration", { key: a._id })).ok)
    return;
  const kind = xOriginalKind(a.agentSlug, r.automaticOrdinal ?? 0);
  let sourceThreadId;
  if (kind === "forum") {
    const prior = await ctx.db
      .query("xAgentDrafts")
      .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", a.ownerUserId))
      .order("desc")
      .take(40);
    const used = new Set(
      prior
        .filter((d) => d.agentSlug === a.agentSlug && d.status === "published")
        .slice(0, 6)
        .map((d) => d.sourceThreadId),
    );
    const candidates = await ctx.db
      .query("forumThreads")
      .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "active"))
      .order("desc")
      .take(24);
    candidates.sort(
      (x, y) =>
        Number(
          /agent|hardware|retro|robot|security|weird|game/i.test(y.title),
        ) -
        Number(/agent|hardware|retro|robot|security|weird|game/i.test(x.title)),
    );
    for (const t of candidates)
      if (
        !t.categorySlug.startsWith("crypto") &&
        !used.has(t._id) &&
        (await researchSource(ctx, t._id))
      ) {
        sourceThreadId = t._id;
        break;
      }
    if (!sourceThreadId) return;
  }
  const conversationId = await createThread(ctx, components.agent, {
    title: `X original: ${a.agentSlug}`,
    summary:
      "Only confirmed public posts by this identity and an optional currently public Forum source. No member histories.",
  });
  const draftId = await ctx.db.insert("xAgentDrafts", {
    ownerUserId: a.ownerUserId,
    agentSlug: a.agentSlug,
    accountEpoch: a.epoch,
    key,
    kind,
    sourceThreadId,
    brief:
      "A fresh original in your own personality. Usually banter or a meme-like observation; occasionally a Forum find. Avoid recurring stock jokes, fake progress and repeating prior posts. No compulsory plug.",
    status: "queued",
    conversationId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  await ctx.db.insert("xAgentOperations", {
    accountId: a._id,
    epoch: a.epoch,
    key,
    kind: "original",
    draftId,
    status: "queued",
    notBefore: Date.now(),
    expiresAt: Date.now() + 2 * 60 * 60_000,
    updatedAt: Date.now(),
  });
  await ctx.db.patch("xAgentActivity", r._id, {
    automaticOrdinal: (r.automaticOrdinal ?? 0) + 1,
  });
  await ctx.scheduler.runAfter(0, internal.xAgentDraft.generate, { draftId });
}

export const wakeOwner = internalMutation({
  args: { agentSlug: v.string() },
  returns: v.id("xAgentActivity"),
  handler: async (ctx, args) => {
    const { r } = await ownedActivity(ctx, args.agentSlug);
    await ctx.db.patch("xAgentActivity", r._id, { nextPollAt: Date.now() });
    return r._id;
  },
});
