import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import schema from "./schema";
import { feedBuy } from "./telegramTradeSchema";
import {
  GECKO_BASE,
  SYMF_MINT,
  SYMF_FEED_TOPIC,
  symfPools,
  poolBuys,
  renderFeedBuys,
} from "../lib/telegram-trade-feed";
import {
  telegramBotRegistry,
  TELEGRAM_COMMUNITY_ID,
} from "../lib/telegram-agent-policy";
import type { Id } from "./_generated/dataModel";
const limiter = new RateLimiter(components.rateLimiter, {
  symfPoll: { kind: "token bucket", rate: 1, period: MINUTE, capacity: 1 },
});
function enabled() {
  return (
    env.TELEGRAM_TRADE_FEED_ENABLED === "true" &&
    env.TELEGRAM_TRADE_FEED_TOPIC_ID === String(SYMF_FEED_TOPIC) &&
    env.TELEGRAM_AGENTS_ENABLED === "true" &&
    telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).has("suki")
  );
}

export const begin = internalMutation({
  args: {},
  returns: v.union(v.number(), v.null()),
  handler: async (ctx) => {
    if (
      !enabled() ||
      !(await limiter.limit(ctx, "symfPoll", { key: TELEGRAM_COMMUNITY_ID })).ok
    )
      return null;
    let state = await ctx.db
      .query("telegramTradeState")
      .withIndex("by_key", (q) => q.eq("key", "symf"))
      .unique();
    if (!state) {
      const id = await ctx.db.insert("telegramTradeState", {
        key: "symf",
        startedAt: Date.now() - 5 * MINUTE,
        coverageWarning: false,
      });
      state = (await ctx.db.get("telegramTradeState", id))!;
    }
    return state.startedAt;
  },
});
export const record = internalMutation({
  args: {
    pool: v.string(),
    ids: v.array(v.string()),
    buys: v.array(feedBuy),
    oldestAt: v.union(v.number(), v.null()),
    headId: v.union(v.string(), v.null()),
    headAt: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!enabled()) return null;
    if (args.ids.length > 300 || args.buys.length > 300)
      throw Error("provider_window_exceeded");
    const state = await ctx.db
      .query("telegramTradeState")
      .withIndex("by_key", (q) => q.eq("key", "symf"))
      .unique();
    if (!state) return null;
    const prior = await ctx.db
      .query("telegramTradePools")
      .withIndex("by_pool", (q) => q.eq("pool", args.pool))
      .unique();
    const gap =
      prior?.gap === true ||
      (!prior &&
        args.oldestAt !== null &&
        args.ids.length === 300 &&
        args.oldestAt > state.startedAt) ||
      !!(
        prior?.headId &&
        prior.headAt &&
        args.oldestAt &&
        args.oldestAt > prior.headAt &&
        !args.ids.includes(prior.headId)
      );
    const pool = {
      pool: args.pool,
      headId: args.headId,
      headAt: args.headAt,
      gap,
      updatedAt: Date.now(),
    };
    if (prior) await ctx.db.patch("telegramTradePools", prior._id, pool);
    else await ctx.db.insert("telegramTradePools", pool);
    if (gap)
      await ctx.db.patch("telegramTradeState", state._id, {
        coverageWarning: true,
        reason: "provider_history_gap",
      });
    for (const buy of args.buys) {
      if (
        buy.pool !== args.pool ||
        buy.occurredAt < state.startedAt ||
        buy.occurredAt > Date.now() + MINUTE
      )
        continue;
      if (
        !(await ctx.db
          .query("telegramTradeEvents")
          .withIndex("by_key", (q) => q.eq("key", buy.key))
          .unique())
      )
        await ctx.db.insert("telegramTradeEvents", {
          ...buy,
          status: "queued",
          createdAt: Date.now(),
        });
    }
    return null;
  },
});
export const health = internalMutation({
  args: { reason: v.optional(v.string()), truncated: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const state = await ctx.db
      .query("telegramTradeState")
      .withIndex("by_key", (q) => q.eq("key", "symf"))
      .unique();
    if (state)
      await ctx.db.patch("telegramTradeState", state._id, {
        lastPollAt: Date.now(),
        ...(args.truncated
          ? { coverageWarning: true, reason: "pool_discovery_limit" }
          : args.reason
            ? { reason: args.reason }
            : !state.coverageWarning
              ? { reason: undefined }
              : {}),
      });
    return null;
  },
});
export const claim = internalMutation({
  args: {},
  returns: v.union(
    v.null(),
    v.object({ batchId: v.id("telegramTradeBatches"), text: v.string() }),
  ),
  handler: async (ctx) => {
    if (!enabled()) return null;
    const rows = await ctx.db
      .query("telegramTradeEvents")
      .withIndex("by_status_and_occurredAt", (q) => q.eq("status", "queued"))
      .take(8);
    if (!rows.length) return null;
    const state = await ctx.db
      .query("telegramTradeState")
      .withIndex("by_key", (q) => q.eq("key", "symf"))
      .unique();
    const text =
      renderFeedBuys(rows) +
      (state?.coverageWarning
        ? "\n⚠️ Provider coverage gap detected; some earlier trades may be missing."
        : "");
    if (text.length > 3900) throw Error("feed_batch_too_long");
    for (const row of rows)
      await ctx.db.patch("telegramTradeEvents", row._id, { status: "sending" });
    const batchId = await ctx.db.insert("telegramTradeBatches", {
      eventIds: rows.map((r) => r._id),
      text,
      status: "sending",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      3 * MINUTE,
      internal.telegramTradeFeed.expire,
      { batchId },
    );
    return { batchId, text };
  },
});
const batchArgs = { batchId: v.id("telegramTradeBatches") };
export const finish = internalMutation({
  args: { ...batchArgs, messageId: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { batchId, messageId }) => {
    const batch = await ctx.db.get("telegramTradeBatches", batchId);
    if (batch?.status !== "sending") return null;
    const status = messageId ? ("sent" as const) : ("held" as const);
    await ctx.db.patch("telegramTradeBatches", batchId, {
      status,
      ...(messageId ? { messageId } : {}),
    });
    for (const eventId of batch.eventIds)
      await ctx.db.patch("telegramTradeEvents", eventId, { status });
    return null;
  },
});
export const expire = internalMutation({
  args: batchArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const batch = await ctx.db.get("telegramTradeBatches", args.batchId);
    if (
      batch?.status === "sending" &&
      Date.now() - batch.createdAt >= 3 * MINUTE
    )
      await ctx.runMutation(internal.telegramTradeFeed.finish, args);
    return null;
  },
});
async function read(path: string): Promise<unknown> {
  const response = await fetch(`${GECKO_BASE}${path}`, {
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json;version=20230302" },
  });
  if (!response.ok) throw Error(`provider_http_${response.status}`);
  return (await response.json()) as unknown;
}
export const poll = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const since: number | null = await ctx.runMutation(
      internal.telegramTradeFeed.begin,
      {},
    );
    if (since === null) return null;
    try {
      const discovery = symfPools(await read(`/tokens/${SYMF_MINT}/pools`));
      if (!discovery.pools.length) throw Error("no_matching_pools");
      for (const pool of discovery.pools) {
        const trades = poolBuys(
          await read(
            `/pools/${pool}/trades?trade_volume_in_usd_greater_than=0`,
          ),
          pool,
          since,
          Date.now(),
        );
        await ctx.runMutation(internal.telegramTradeFeed.record, {
          pool,
          ...trades,
        });
      }
      await ctx.runMutation(internal.telegramTradeFeed.health, {
        truncated: discovery.truncated,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      await ctx.runMutation(internal.telegramTradeFeed.health, {
        reason: /^(provider_http_[0-9]{3}|invalid_[a-z_]+|no_matching_pools)$/.test(code) ? code : "provider_poll_unconfirmed",
      });
    }
    const batch: { batchId: Id<"telegramTradeBatches">; text: string } | null =
      await ctx.runMutation(internal.telegramTradeFeed.claim, {});
    if (!batch || !enabled()) return null;
    const bot = telegramBotRegistry(env.TELEGRAM_AGENT_BOTS).get("suki")!;
    let messageId: number | undefined;
    try {
      const response = await fetch(
        `https://api.telegram.org/bot${bot.token}/sendMessage`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TELEGRAM_COMMUNITY_ID,
            message_thread_id: SYMF_FEED_TOPIC,
            text: batch.text,
            parse_mode: "HTML",
            disable_notification: true,
            link_preview_options: { is_disabled: true },
          }),
        },
      );
      const body: unknown = await response.json();
      if (
        response.ok &&
        body &&
        typeof body === "object" &&
        "ok" in body &&
        body.ok === true &&
        "result" in body &&
        body.result &&
        typeof body.result === "object"
      ) {
        const r = body.result;
        if (
          "message_id" in r &&
          typeof r.message_id === "number" &&
          "message_thread_id" in r &&
          r.message_thread_id === SYMF_FEED_TOPIC &&
          "chat" in r &&
          r.chat &&
          typeof r.chat === "object" &&
          "id" in r.chat &&
          String(r.chat.id) === TELEGRAM_COMMUNITY_ID
        )
          messageId = r.message_id;
      }
    } catch {
      /* An uncertain Telegram send stays held. Never replay it. */
    }
    await ctx.runMutation(internal.telegramTradeFeed.finish, {
      batchId: batch.batchId,
      ...(messageId ? { messageId } : {}),
    });
    return null;
  },
});
export const inspect = internalQuery({
  args: {},
  returns: v.object({
    state: v.union(v.null(), schema.doc("telegramTradeState")),
    pools: v.array(schema.doc("telegramTradePools")),
    batches: v.array(schema.doc("telegramTradeBatches")),
    pending: v.number(),
  }),
  handler: async (ctx) => ({
    state: await ctx.db
      .query("telegramTradeState")
      .withIndex("by_key", (q) => q.eq("key", "symf"))
      .unique(),
    pools: await ctx.db
      .query("telegramTradePools")
      .withIndex("by_pool")
      .take(20),
    batches: await ctx.db
      .query("telegramTradeBatches")
      .withIndex("by_createdAt")
      .order("desc")
      .take(6),
    pending: (
      await ctx.db
        .query("telegramTradeEvents")
        .withIndex("by_status_and_occurredAt", (q) => q.eq("status", "queued"))
        .take(301)
    ).length,
  }),
});

/** Expire confirmed receipts after seven days; uncertain deliveries remain held. */
export const cleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 7 * 24 * 60 * MINUTE;
    const rows = await ctx.db
      .query("telegramTradeEvents")
      .withIndex("by_status_and_occurredAt", (q) =>
        q.eq("status", "sent").lt("occurredAt", cutoff),
      )
      .take(100);
    for (const row of rows) await ctx.db.delete("telegramTradeEvents", row._id);
    const batches = await ctx.db
      .query("telegramTradeBatches")
      .withIndex("by_status_and_createdAt", (q) =>
        q.eq("status", "sent").lt("createdAt", cutoff),
      )
      .take(100);
    for (const batch of batches)
      await ctx.db.delete("telegramTradeBatches", batch._id);
    return null;
  },
});
