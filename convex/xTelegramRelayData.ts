import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  env,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { SYMFORUM_X_USER_ID } from "../lib/x-telegram-relay";
import schema from "./schema";

const config = (ctx: Pick<QueryCtx, "db">) =>
  ctx.db
    .query("xTelegramRelayConfig")
    .withIndex("by_key", (q) => q.eq("key", "symforum"))
    .unique();
export const enabled = internalQuery({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => (await config(ctx))?.enabled === true,
});
// Operator-only, one-time activation. Server time is the immutable no-backfill cutoff.
export const initialize = internalMutation({
  args: { topicId: v.number() },
  returns: v.number(),
  handler: async (ctx, { topicId }) => {
    if (!Number.isSafeInteger(topicId) || topicId <= 0)
      throw Error("Invalid topic");
    if (await config(ctx))
      throw Error("Relay already configured; never reset its cutoff");
    const now = Date.now();
    await ctx.db.insert("xTelegramRelayConfig", {
      key: "symforum",
      enabled: true,
      topicId,
      enabledAt: now,
      updatedAt: now,
    });
    return now;
  },
});
export const disable = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const c = await config(ctx);
    if (c)
      await ctx.db.patch("xTelegramRelayConfig", c._id, {
        enabled: false,
        updatedAt: Date.now(),
      });
    return null;
  },
});
export async function enqueueRelay(
  ctx: MutationCtx,
  posts: Array<{
    id: string;
    authorId: string;
    text: string;
    createdAt: number;
  }>,
) {
  const c = await config(ctx);
  if (!c?.enabled || posts.length > 5) return;
  let ordinal = 0;
  // Each fetched page arrives newest-first. Deliver its posts in chronological order.
  for (const p of posts
    .filter((p) => /^\d{1,19}$/.test(p.id))
    .sort(
      (a, b) =>
        a.createdAt - b.createdAt || (BigInt(a.id) < BigInt(b.id) ? -1 : 1),
    )) {
    if (
      p.authorId !== SYMFORUM_X_USER_ID ||
      !/^\d{1,19}$/.test(p.id) ||
      !p.text.trim() ||
      p.text.length > 25000 ||
      !Number.isFinite(p.createdAt) ||
      p.createdAt < c.enabledAt ||
      p.createdAt > Date.now() + 60_000
    )
      continue;
    if (
      await ctx.db
        .query("xTelegramDeliveries")
        .withIndex("by_postId", (q) => q.eq("postId", p.id))
        .unique()
    )
      continue;
    const id = await ctx.db.insert("xTelegramDeliveries", {
      postId: p.id,
      topicId: c.topicId,
      sourceCreatedAt: p.createdAt,
      text: p.text,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      ordinal++ * 3000,
      internal.xTelegramRelay.deliver,
      { id },
    );
  }
}
export const claim = internalMutation({
  args: { id: v.id("xTelegramDeliveries") },
  returns: v.union(v.null(), schema.doc("xTelegramDeliveries")),
  handler: async (ctx, { id }) => {
    const c = await config(ctx);
    const d = await ctx.db.get("xTelegramDeliveries", id);
    if (!d || d.status !== "queued") return null;
    if (
      !c?.enabled ||
      c.topicId !== d.topicId ||
      env.TELEGRAM_AGENTS_ENABLED !== "true"
    ) {
      await ctx.db.patch("xTelegramDeliveries", id, {
        status: "held",
        issue: "relay_disabled",
        text: undefined,
        updatedAt: Date.now(),
      });
      return null;
    }
    // No lease recovery: an interrupted send can never be automatically replayed.
    await ctx.db.patch("xTelegramDeliveries", id, {
      status: "sending",
      issue: "send_in_flight_or_unknown",
      updatedAt: Date.now(),
    });
    return d;
  },
});
export const settle = internalMutation({
  args: {
    id: v.id("xTelegramDeliveries"),
    messageId: v.optional(v.number()),
    issue: v.optional(
      v.union(
        v.literal("bot_unavailable"),
        v.literal("delivery_unknown"),
        v.literal("telegram_rejected"),
      ),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const d = await ctx.db.get("xTelegramDeliveries", args.id);
    if (!d || d.status !== "sending") return null;
    if (
      args.messageId !== undefined &&
      (!Number.isSafeInteger(args.messageId) ||
        args.messageId <= 0 ||
        args.issue)
    )
      throw Error("Invalid receipt");
    await ctx.db.patch("xTelegramDeliveries", d._id, {
      status: args.messageId ? "sent" : "held",
      messageId: args.messageId,
      issue: args.messageId ? undefined : (args.issue ?? "delivery_unknown"),
      text: undefined,
      updatedAt: Date.now(),
    });
    return null;
  },
});
