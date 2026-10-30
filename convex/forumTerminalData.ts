import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { commerceActor } from "./forumCommerceAccess";
import { isSolanaAddress } from "../lib/forum-commerce";
import { classifyMarketCap } from "../lib/forum-market-cap";
import {
  crossedPrice,
  TERMINAL_FRESH_MS,
  TERMINAL_RISK_TTL_MS,
  TERMINAL_WALLET_TTL_MS,
} from "../lib/forum-terminal-data";
import { tokenSnapshotValidator } from "./tokenAlphaSchema";
import {
  terminalWalletValidator,
  terminalRiskValidator,
} from "./forumTerminalSchema";
import { components } from "./_generated/api";
import { SYMF_TOKEN } from "../lib/symf-token";

export const terminalReadLimiter = new RateLimiter(components.rateLimiter, {
  // Sub-budget of the unchanged shared commerce1000/day limit. Root public
  // market/chart cache admissions use the same name/key and accounting window.
  terminalReadDaily: {
    kind: "fixed window",
    rate: 100,
    period: 86_400_000,
    start: 0,
  },
  terminalWatchEdit: {
    kind: "token bucket",
    rate: 12,
    period: 60_000,
    capacity: 4,
  },
});

export async function reserveTerminalRead(
  ctx: MutationCtx,
  wallet: string,
  cost: number,
) {
  const gate = await terminalReadLimiter.limit(ctx, "terminalReadDaily", {
    key: "all",
    count: cost,
  });
  if (!gate.ok)
    throw new ConvexError(
      "Terminal data allowance reached. Existing receipts and swaps remain available.",
    );
  await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
    wallet,
    cost,
  });
}

export const recordSnapshots = internalMutation({
  args: { snapshots: v.array(tokenSnapshotValidator) },
  returns: v.null(),
  handler: async (ctx, { snapshots }) => {
    const now = Date.now();
    if (snapshots.length > 5) throw new Error("Bounded sample required.");
    const seen = new Set<string>();
    for (const snapshot of snapshots) {
      if (
        seen.has(snapshot.mint) ||
        !isSolanaAddress(snapshot.mint) ||
        !Number.isSafeInteger(snapshot.metricsAsOf) ||
        now - snapshot.metricsAsOf > TERMINAL_FRESH_MS ||
        snapshot.metricsAsOf > now + 60_000 ||
        !Number.isSafeInteger(snapshot.observedAt) ||
        snapshot.observedAt > now + 60_000 ||
        now - snapshot.observedAt > TERMINAL_FRESH_MS ||
        !Number.isFinite(snapshot.priceUsd) ||
        Number(snapshot.priceUsd) <= 0 ||
        !Number.isFinite(snapshot.marketCapUsd) ||
        Number(snapshot.marketCapUsd) <= 0 ||
        snapshot.name.length > 200 ||
        snapshot.symbol.length > 80
      )
        throw new Error("Invalid terminal sample.");
      seen.add(snapshot.mint);
      const old = await ctx.db
        .query("forumTerminalMarkets")
        .withIndex("by_mint", (q) => q.eq("mint", snapshot.mint))
        .unique();
      if (old && old.snapshot.metricsAsOf >= snapshot.metricsAsOf) continue;
      const value = {
        mint: snapshot.mint,
        platform: snapshot.platform,
        band: classifyMarketCap(snapshot.marketCapUsd),
        observedAt: snapshot.observedAt,
        snapshot,
      };
      if (old) await ctx.db.patch("forumTerminalMarkets", old._id, value);
      else await ctx.db.insert("forumTerminalMarkets", value);
      await ctx.scheduler.runAfter(
        0,
        internal.forumTerminalData.evaluateAlerts,
        { snapshot, paginationOpts: { numItems: 100, cursor: null } },
      );
    }
    // Bounded housekeeping removes only reproducible stale display samples.
    const expired = await ctx.db
      .query("forumTerminalMarkets")
      .withIndex("by_observedAt", (q) =>
        q.lt("observedAt", now - 24 * 3_600_000),
      )
      .take(25);
    for (const row of expired)
      await ctx.db.delete("forumTerminalMarkets", row._id);
    // Private sampled-price notifications are not financial receipts/holds.
    // Retain30days, pruning one bounded batch on existing ingestion only.
    const oldAlerts = await ctx.db
      .query("forumTerminalAlerts")
      .withIndex("by_observedAt", (q) =>
        q.lt("observedAt", now - 30 * 86_400_000),
      )
      .take(50);
    for (const row of oldAlerts)
      await ctx.db.delete("forumTerminalAlerts", row._id);
    return null;
  },
});

/** Explicit metadata-only release migration. No fetches, alerts or agent runs. */
export const backfillTrackedMarkets = internalMutation({
  args: {},
  returns: v.object({ processed: v.number(), complete: v.boolean() }),
  handler: async (ctx) => {
    const state = await ctx.db
      .query("forumTerminalProjection")
      .withIndex("by_key", (q) => q.eq("key", "markets"))
      .unique();
    if (state?.complete) return { processed: 0, complete: true };
    const now = Date.now();
    const page = await ctx.db
      .query("tokenAlphaTrackedTokens")
      .withIndex("by_creation_time")
      .paginate({ numItems: 50, cursor: state?.cursor ?? null });
    for (const row of page.page) {
      const snapshot = row.latestSnapshot;
      if (
        !snapshot ||
        !isSolanaAddress(snapshot.mint) ||
        !Number.isSafeInteger(snapshot.metricsAsOf) ||
        !Number.isSafeInteger(snapshot.observedAt) ||
        !Number.isFinite(snapshot.priceUsd) ||
        Number(snapshot.priceUsd) <= 0 ||
        !Number.isFinite(snapshot.marketCapUsd) ||
        Number(snapshot.marketCapUsd) <= 0 ||
        snapshot.metricsAsOf > now + 60_000 ||
        now - snapshot.metricsAsOf > 24 * 3_600_000 ||
        snapshot.observedAt > now + 60_000
      )
        continue;
      const old = await ctx.db
        .query("forumTerminalMarkets")
        .withIndex("by_mint", (q) => q.eq("mint", snapshot.mint))
        .unique();
      if (old && old.snapshot.metricsAsOf >= snapshot.metricsAsOf) continue;
      const fields = {
        mint: snapshot.mint,
        platform: snapshot.platform,
        band: classifyMarketCap(snapshot.marketCapUsd),
        observedAt: snapshot.observedAt,
        snapshot,
      };
      if (old) await ctx.db.patch("forumTerminalMarkets", old._id, fields);
      else await ctx.db.insert("forumTerminalMarkets", fields);
    }
    const fields = {
      key: "markets" as const,
      complete: page.isDone,
      cursor: page.isDone ? null : page.continueCursor,
      updatedAt: now,
    };
    if (state) await ctx.db.patch("forumTerminalProjection", state._id, fields);
    else await ctx.db.insert("forumTerminalProjection", fields);
    return { processed: page.page.length, complete: page.isDone };
  },
});

export const evaluateAlerts = internalMutation({
  args: {
    snapshot: tokenSnapshotValidator,
    paginationOpts: paginationOptsValidator,
  },
  returns: v.null(),
  handler: async (ctx, { snapshot, paginationOpts }) => {
    if (
      snapshot.priceUsd === null ||
      !Number.isFinite(snapshot.priceUsd) ||
      snapshot.priceUsd <= 0 ||
      Date.now() - snapshot.metricsAsOf > TERMINAL_FRESH_MS
    )
      return null;
    // Old queued samples cannot overwrite newer observations or create alerts.
    const current = await ctx.db
      .query("forumTerminalMarkets")
      .withIndex("by_mint", (q) => q.eq("mint", snapshot.mint))
      .unique();
    if (!current || current.snapshot.metricsAsOf !== snapshot.metricsAsOf)
      return null;
    const page = await ctx.db
      .query("forumTerminalWatches")
      .withIndex("by_mint", (q) => q.eq("mint", snapshot.mint))
      .paginate(paginationOpts);
    for (const row of page.page) {
      if (row.lastObservedAt >= snapshot.metricsAsOf) continue;
      for (const direction of ["above", "below"] as const) {
        const threshold =
          direction === "above" ? row.priceAboveUsd : row.priceBelowUsd;
        if (
          threshold !== null &&
          crossedPrice(
            row.previousPriceUsd,
            snapshot.priceUsd,
            threshold,
            direction,
          )
        ) {
          await ctx.db.insert("forumTerminalAlerts", {
            authUserId: row.authUserId,
            mint: row.mint,
            symbol: snapshot.symbol,
            direction,
            thresholdUsd: threshold,
            priceUsd: snapshot.priceUsd,
            observedAt: snapshot.metricsAsOf,
            acknowledged: false,
          });
        }
      }
      await ctx.db.patch("forumTerminalWatches", row._id, {
        previousPriceUsd: snapshot.priceUsd,
        lastObservedAt: snapshot.metricsAsOf,
      });
    }
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        internal.forumTerminalData.evaluateAlerts,
        {
          snapshot,
          paginationOpts: { ...paginationOpts, cursor: page.continueCursor },
        },
      );
    return null;
  },
});

export const claimWalletRead = internalMutation({
  args: {
    wallet: v.string(),
    selectedMint: v.optional(v.string()),
    lease: v.string(),
  },
  returns: v.object({
    fetch: v.boolean(),
    state: v.union(terminalWalletValidator, v.null()),
  }),
  handler: async (ctx, { wallet, selectedMint, lease }) => {
    await commerceActor(ctx, wallet);
    if (selectedMint && !isSolanaAddress(selectedMint))
      throw new ConvexError("Invalid token mint.");
    const now = Date.now(),
      selection = selectedMint ?? SYMF_TOKEN.mint;
    const old = await ctx.db
      .query("forumTerminalWallets")
      .withIndex("by_wallet", (q) => q.eq("wallet", wallet))
      .unique();
    const state = old?.selection === selection ? (old.state ?? null) : null;
    if (old && (old.leaseUntil > now || old.nextFetchAt > now))
      return { fetch: false, state };
    const mintCount = new Set(
      [SYMF_TOKEN.mint, selection].filter(
        (m) => m && m !== "So11111111111111111111111111111111111111112",
      ),
    ).size;
    await reserveTerminalRead(ctx, wallet, 1 + 2 * mintCount);
    const fields = {
      wallet,
      selection,
      lease,
      leaseUntil: now + 30_000,
      nextFetchAt: now + TERMINAL_WALLET_TTL_MS,
      // A failed request for B must not relabel A's cached balances as B.
      state: old?.selection === selection ? old.state : undefined,
    };
    if (old) await ctx.db.patch("forumTerminalWallets", old._id, fields);
    else await ctx.db.insert("forumTerminalWallets", fields);
    return { fetch: true, state };
  },
});
export const saveWalletRead = internalMutation({
  args: {
    wallet: v.string(),
    lease: v.string(),
    state: v.union(terminalWalletValidator, v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { wallet, lease, state }) => {
    await commerceActor(ctx, wallet);
    const row = await ctx.db
      .query("forumTerminalWallets")
      .withIndex("by_wallet", (q) => q.eq("wallet", wallet))
      .unique();
    if (!row || row.lease !== lease) return null;
    if (state && state.wallet !== wallet)
      throw new Error("Wallet binding mismatch.");
    await ctx.db.patch("forumTerminalWallets", row._id, {
      leaseUntil: 0,
      ...(state ? { state } : {}),
    });
    return null;
  },
});
export const claimRiskRead = internalMutation({
  args: { wallet: v.string(), mint: v.string(), lease: v.string() },
  returns: v.object({
    fetch: v.boolean(),
    risk: v.union(terminalRiskValidator, v.null()),
  }),
  handler: async (ctx, { wallet, mint, lease }) => {
    await commerceActor(ctx, wallet);
    if (!isSolanaAddress(mint)) throw new ConvexError("Invalid token mint.");
    const now = Date.now(),
      old = await ctx.db
        .query("forumTerminalRisks")
        .withIndex("by_mint", (q) => q.eq("mint", mint))
        .unique();
    if (old && (old.leaseUntil > now || old.nextFetchAt > now))
      return { fetch: false, risk: old.risk ?? null };
    await reserveTerminalRead(ctx, wallet, 1);
    const fields = {
      mint,
      lease,
      leaseUntil: now + 20_000,
      nextFetchAt: now + TERMINAL_RISK_TTL_MS,
    };
    if (old) await ctx.db.patch("forumTerminalRisks", old._id, fields);
    else await ctx.db.insert("forumTerminalRisks", fields);
    return { fetch: true, risk: old?.risk ?? null };
  },
});
export const saveRiskRead = internalMutation({
  args: {
    mint: v.string(),
    lease: v.string(),
    risk: v.union(terminalRiskValidator, v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { mint, lease, risk }) => {
    const row = await ctx.db
      .query("forumTerminalRisks")
      .withIndex("by_mint", (q) => q.eq("mint", mint))
      .unique();
    if (!row || row.lease !== lease) return null;
    if (risk && risk.mint !== mint) throw new Error("Mint binding mismatch.");
    await ctx.db.patch("forumTerminalRisks", row._id, {
      leaseUntil: 0,
      ...(risk ? { risk } : {}),
    });
    return null;
  },
});

export const cachedWalletRead = internalQuery({
  args: { wallet: v.string() },
  returns: v.union(terminalWalletValidator, v.null()),
  handler: async (ctx, { wallet }) => {
    await commerceActor(ctx, wallet);
    return (
      (
        await ctx.db
          .query("forumTerminalWallets")
          .withIndex("by_wallet", (q) => q.eq("wallet", wallet))
          .unique()
      )?.state ?? null
    );
  },
});
