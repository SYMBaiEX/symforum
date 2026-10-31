import { ConvexError, v } from "convex/values";
import { action, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { commerceActor, publicCommerceThread } from "./forumCommerceAccess";
import { isSolanaAddress } from "../lib/forum-commerce";
import {
  snapshotToTerminal,
  TERMINAL_FRESH_MS,
  TERMINAL_RETENTION_MS,
  validTerminalPrice,
} from "../lib/forum-terminal-data";
import type { TerminalMarket } from "../lib/forum-terminal-model";
import {
  terminalBandValidator,
  terminalMarketValidator,
  terminalRiskValidator,
  terminalWalletValidator,
} from "./forumTerminalSchema";
import { tokenPlatformValidator } from "./tokenAlphaSchema";
import { terminalReadLimiter } from "./forumTerminalData";
import { readTerminalRisk, readTerminalWallet } from "./forumTerminalWallet";
import { FORUM_SITE_URL } from "../lib/site-urls";
import { matchesMarketCap } from "../lib/forum-market-cap";
import { withRefreshedMarket } from "../lib/terminal-market-refresh-source";

async function marketView(
  ctx: QueryCtx,
  row: Doc<"forumTerminalMarkets">,
): Promise<TerminalMarket> {
  const view = snapshotToTerminal(row.snapshot);
  const bound = await ctx.db
    .query("tokenAlphaTrackedTokens")
    .withIndex("by_chain_and_mint", (q) =>
      q.eq("chain", "solana").eq("mint", row.mint),
    )
    .unique();
  const thread = bound ? await publicCommerceThread(ctx, bound.threadId) : null;
  return thread
    ? {
        ...view,
        threadId: thread._id,
        threadUrl: `${FORUM_SITE_URL}/${encodeURIComponent(thread.categorySlug)}/${encodeURIComponent(thread.slug)}`,
      }
    : view;
}
export const listMarket = query({
  args: {
    band: v.optional(terminalBandValidator),
    platform: v.optional(tokenPlatformValidator),
    now: v.number(),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    markets: v.array(terminalMarketValidator),
    band: terminalBandValidator,
    coverage: v.literal("sampled"),
    sampledAt: v.union(v.number(), v.null()),
    stale: v.boolean(),
  }),
  handler: async (ctx, { band = "all", platform, now, limit = 30 }) => {
    if (
      !Number.isSafeInteger(now) ||
      now <= 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 60
    )
      throw new ConvexError("Invalid terminal window.");
    const floor = now - TERMINAL_RETENTION_MS;
    const query = ctx.db.query("forumTerminalMarkets");
    // The original scout band is not necessarily the current display band.
    // Merge a bounded retained cohort first, then filter actual displayed cap.
    const rows = platform
      ? await query
          .withIndex("by_platform_and_observedAt", (q) =>
            q
              .eq("platform", platform)
              .gte("observedAt", floor)
              .lte("observedAt", now + 60_000),
          )
          .order("desc")
          .take(60)
      : await query
          .withIndex("by_observedAt", (q) =>
            q.gte("observedAt", floor).lte("observedAt", now + 60_000),
          )
          .order("desc")
          .take(60);
    const cache = await ctx.db
      .query("forumMarketSampleCache")
      .withIndex("by_key", (q) => q.eq("key", "markets"))
      .unique();
    const overlays = new Map(cache?.quotes.map((quote) => [quote.mint, quote]));
    const displayed = rows
      .map((row) => ({
        row,
        market: withRefreshedMarket(
          snapshotToTerminal(row.snapshot),
          overlays.get(row.mint),
          now,
        ),
      }))
      .filter(({ market }) => matchesMarketCap(market.marketCapUsd, band))
      .slice(0, limit);
    // Only hydrate public discussion links for the returned, filtered rows.
    const markets = await Promise.all(
      displayed.map(async ({ row, market }) => {
        const publicView = await marketView(ctx, row);
        return {
          ...market,
          threadId: publicView.threadId,
          threadUrl: publicView.threadUrl,
        };
      }),
    );
    const sampledAt = markets.length
      ? Math.max(...markets.map((market) => market.observedAt))
      : null;
    return {
      markets,
      band,
      coverage: "sampled" as const,
      sampledAt,
      stale:
        markets.length === 0 ||
        markets.every((market) =>
          market.marketData
            ? market.marketData.state !== "available" ||
              now - market.marketData.checkedAt > TERMINAL_FRESH_MS
            : now - market.metricsAsOf > TERMINAL_FRESH_MS,
        ),
    };
  },
});
export const getMarket = query({
  args: { mint: v.string(), now: v.number() },
  returns: v.union(terminalMarketValidator, v.null()),
  handler: async (ctx, { mint, now }) => {
    if (!isSolanaAddress(mint) || !Number.isSafeInteger(now) || now <= 0)
      throw new ConvexError("Invalid token window.");
    const row = await ctx.db
      .query("forumTerminalMarkets")
      .withIndex("by_mint", (q) => q.eq("mint", mint))
      .unique();
    return row &&
      now - row.observedAt <= TERMINAL_RETENTION_MS &&
      row.observedAt <= now + 60_000
      ? marketView(ctx, row)
      : null;
  },
});
export const getWalletReadState = action({
  args: { wallet: v.string(), selectedMint: v.optional(v.string()) },
  returns: v.union(terminalWalletValidator, v.null()),
  handler: readTerminalWallet,
});
export const getRisk = query({
  args: { mint: v.string() },
  returns: v.union(terminalRiskValidator, v.null()),
  handler: async (ctx, { mint }) => {
    if (!isSolanaAddress(mint)) throw new ConvexError("Invalid token mint.");
    return (
      (
        await ctx.db
          .query("forumTerminalRisks")
          .withIndex("by_mint", (q) => q.eq("mint", mint))
          .unique()
      )?.risk ?? null
    );
  },
});
export const refreshRisk = action({
  args: { wallet: v.string(), mint: v.string() },
  returns: v.union(terminalRiskValidator, v.null()),
  handler: readTerminalRisk,
});
export const listWatchlist = query({
  args: {},
  returns: v.array(
    v.object({
      mint: v.string(),
      symbol: v.union(v.string(), v.null()),
      priceAboveUsd: v.union(v.number(), v.null()),
      priceBelowUsd: v.union(v.number(), v.null()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const actor = await commerceActor(ctx);
    const rows = await ctx.db
      .query("forumTerminalWatches")
      .withIndex("by_authUserId_and_updatedAt", (q) =>
        q.eq("authUserId", actor.authUserId),
      )
      .order("desc")
      .take(50);
    return Promise.all(
      rows.map(async (row) => ({
        mint: row.mint,
        symbol:
          (
            await ctx.db
              .query("forumTerminalMarkets")
              .withIndex("by_mint", (q) => q.eq("mint", row.mint))
              .unique()
          )?.snapshot.symbol ?? null,
        priceAboveUsd: row.priceAboveUsd,
        priceBelowUsd: row.priceBelowUsd,
        updatedAt: row.updatedAt,
      })),
    );
  },
});
export const setWatchlist = mutation({
  args: {
    mint: v.string(),
    enabled: v.boolean(),
    priceAboveUsd: v.optional(v.union(v.number(), v.null())),
    priceBelowUsd: v.optional(v.union(v.number(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, { mint, enabled, priceAboveUsd, priceBelowUsd }) => {
    const actor = await commerceActor(ctx);
    if (
      !isSolanaAddress(mint) ||
      !validTerminalPrice(priceAboveUsd) ||
      !validTerminalPrice(priceBelowUsd)
    )
      throw new ConvexError("Enter a valid mint and positive price threshold.");
    const gate = await terminalReadLimiter.limit(ctx, "terminalWatchEdit", {
      key: actor.authUserId,
    });
    if (!gate.ok)
      throw new ConvexError("Watchlist changes are temporarily limited.");
    const old = await ctx.db
      .query("forumTerminalWatches")
      .withIndex("by_authUserId_and_mint", (q) =>
        q.eq("authUserId", actor.authUserId).eq("mint", mint),
      )
      .unique();
    if (!enabled) {
      if (old) await ctx.db.delete("forumTerminalWatches", old._id);
      return null;
    }
    const above =
      priceAboveUsd !== undefined
        ? priceAboveUsd
        : (old?.priceAboveUsd ?? null);
    const below =
      priceBelowUsd !== undefined
        ? priceBelowUsd
        : (old?.priceBelowUsd ?? null);
    if (above !== null && below !== null && below >= above)
      throw new ConvexError(
        "The lower threshold must be below the upper threshold.",
      );
    const now = Date.now();
    if (old) {
      await ctx.db.patch("forumTerminalWatches", old._id, {
        ...(priceAboveUsd !== undefined ? { priceAboveUsd } : {}),
        ...(priceBelowUsd !== undefined ? { priceBelowUsd } : {}),
        updatedAt: now,
      });
      return null;
    }
    const existing = await ctx.db
      .query("forumTerminalWatches")
      .withIndex("by_authUserId_and_updatedAt", (q) =>
        q.eq("authUserId", actor.authUserId),
      )
      .take(50);
    if (existing.length >= 50)
      throw new ConvexError("Each account can save up to 50 tokens.");
    const sample = await ctx.db
      .query("forumTerminalMarkets")
      .withIndex("by_mint", (q) => q.eq("mint", mint))
      .unique();
    const fresh =
      sample && now - sample.snapshot.metricsAsOf <= TERMINAL_FRESH_MS;
    await ctx.db.insert("forumTerminalWatches", {
      authUserId: actor.authUserId,
      userId: actor.userId,
      mint,
      priceAboveUsd: priceAboveUsd ?? null,
      priceBelowUsd: priceBelowUsd ?? null,
      previousPriceUsd: fresh ? sample.snapshot.priceUsd : null,
      lastObservedAt: fresh ? sample.snapshot.metricsAsOf : 0,
      updatedAt: now,
    });
    return null;
  },
});
export const listAlerts = query({
  args: {},
  returns: v.array(
    v.object({
      id: v.id("forumTerminalAlerts"),
      mint: v.string(),
      symbol: v.union(v.string(), v.null()),
      direction: v.union(v.literal("above"), v.literal("below")),
      thresholdUsd: v.number(),
      priceUsd: v.number(),
      observedAt: v.number(),
      acknowledged: v.boolean(),
    }),
  ),
  handler: async (ctx) => {
    const actor = await commerceActor(ctx);
    const rows = await ctx.db
      .query("forumTerminalAlerts")
      .withIndex("by_authUserId_and_observedAt", (q) =>
        q.eq("authUserId", actor.authUserId),
      )
      .order("desc")
      .take(50);
    return rows.map((row) => ({
      id: row._id,
      mint: row.mint,
      symbol: row.symbol,
      direction: row.direction,
      thresholdUsd: row.thresholdUsd,
      priceUsd: row.priceUsd,
      observedAt: row.observedAt,
      acknowledged: row.acknowledged,
    }));
  },
});
export const acknowledgeAlert = mutation({
  args: { id: v.id("forumTerminalAlerts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const actor = await commerceActor(ctx),
      row = await ctx.db.get("forumTerminalAlerts", id);
    if (!row || row.authUserId !== actor.authUserId)
      throw new ConvexError("Alert not found.");
    await ctx.db.patch("forumTerminalAlerts", id, { acknowledged: true });
    return null;
  },
});
