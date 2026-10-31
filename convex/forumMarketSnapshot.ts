import { record, isSolanaAddress } from "../lib/forum-commerce";
import { MARKET_QUOTES, marketPrice } from "../lib/terminal-market-source";
import {
  parseMarketStats,
  type MarketBinding,
} from "../lib/symf-market-overview";
import {
  CHART_CACHE_FRESH_MS,
  CHART_CACHE_RETENTION_MS,
  CHART_CACHE_LEASE_MS,
  marketFailureBackoff,
} from "../lib/chart-cache-policy";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";
import { marketFailureCodeValidator } from "./forumMarketSchema";

type Snapshot = Doc<"forumDexMarketSnapshots">;
const completeArgs = {
  mint: v.string(),
  lease: v.string(),
  attemptAt: v.number(),
  payload: v.union(v.string(), v.null()),
  checkedAt: v.number(),
  failureCode: v.optional(marketFailureCodeValidator),
  retryAfterAt: v.optional(v.number()),
};
const completeValidator = v.object(completeArgs);
export const completeSnapshotRef = makeFunctionReference<
  "mutation",
  Infer<typeof completeValidator>,
  boolean
>("forumMarketSnapshot:complete");
export const expireSnapshotRef = makeFunctionReference<
  "mutation",
  { id: Snapshot["_id"] },
  null
>("forumMarketSnapshot:expire");
export type DexPair = MarketBinding & {
  priceUsd: number | null;
  stats: ReturnType<typeof parseMarketStats>;
};

/** Persist only exact identities and parsed public numeric fields, never raw bodies. */
export function normalizeDexPairs(value: unknown, mint: string): DexPair[] {
  if (!isSolanaAddress(mint) || !Array.isArray(value) || value.length > 100)
    throw Error("invalid_market_snapshot");
  const pairs: DexPair[] = [],
    seen = new Set<string>();
  for (const raw of value) {
    const pair = record(raw),
      quote = record(pair.quoteToken).address,
      liquidity = record(pair.liquidity).usd;
    if (
      pair.chainId !== "solana" ||
      record(pair.baseToken).address !== mint ||
      !isSolanaAddress(String(pair.pairAddress)) ||
      !MARKET_QUOTES.includes(quote as (typeof MARKET_QUOTES)[number]) ||
      typeof liquidity !== "number" ||
      !Number.isFinite(liquidity) ||
      liquidity <= 0
    )
      continue;
    const identity = `${pair.pairAddress}:${String(quote)}`;
    if (seen.has(identity)) throw Error("invalid_market_snapshot");
    seen.add(identity);
    const binding = {
      mint,
      pool: String(pair.pairAddress),
      quote: String(quote),
    };
    const stats = parseMarketStats([raw], binding);
    pairs.push({ ...binding, priceUsd: marketPrice([raw], binding), stats });
  }
  return pairs;
}

export function parseDexSnapshot(payload: string, mint: string): DexPair[] {
  if (payload.length > 200_000) throw Error("invalid_market_snapshot");
  const value: unknown = JSON.parse(payload);
  if (!Array.isArray(value) || value.length > 100 || value.length === 0)
    throw Error("invalid_market_snapshot");
  const seen = new Set<string>();
  return value.map((raw) => {
    const p = record(raw),
      stats = record(p.stats),
      identity = `${String(p.pool)}:${String(p.quote)}`;
    if (
      p.mint !== mint ||
      !isSolanaAddress(String(p.pool)) ||
      !MARKET_QUOTES.includes(p.quote as (typeof MARKET_QUOTES)[number]) ||
      seen.has(identity) ||
      typeof stats.liquidity !== "number" ||
      stats.liquidity <= 0 ||
      !["marketCap", "fdv", "liquidity", "volume24h"].every(
        (key) =>
          stats[key] === null ||
          (typeof stats[key] === "number" &&
            Number.isFinite(stats[key]) &&
            Number(stats[key]) >= 0),
      ) ||
      !(
        p.priceUsd === null ||
        (typeof p.priceUsd === "number" &&
          Number.isFinite(p.priceUsd) &&
          p.priceUsd > 0)
      )
    )
      throw Error("invalid_market_snapshot");
    seen.add(identity);
    return {
      mint,
      pool: String(p.pool),
      quote: String(p.quote),
      priceUsd: p.priceUsd as number | null,
      stats: stats as DexPair["stats"],
    };
  });
}
export async function dexSnapshot(ctx: MutationCtx, mint: string) {
  return ctx.db
    .query("forumDexMarketSnapshots")
    .withIndex("by_mint", (q) => q.eq("mint", mint))
    .unique();
}
export function freshDexSnapshot(
  row: Snapshot | null,
  now: number,
): string | null {
  if (
    !row?.payload ||
    row.checkedAt === null ||
    !Number.isSafeInteger(row.checkedAt) ||
    row.checkedAt <= 0 ||
    row.checkedAt > now + 60_000 ||
    now >= row.checkedAt + CHART_CACHE_FRESH_MS
  )
    return null;
  try {
    parseDexSnapshot(row.payload, row.mint);
    return row.payload;
  } catch {
    return null;
  }
}
export async function claimDexSnapshot(
  ctx: MutationCtx,
  row: Snapshot | null,
  mint: string,
  lease: string,
  now: number,
) {
  const cleanupAt = Math.max(
    now + CHART_CACHE_RETENTION_MS,
    (row?.checkedAt ?? 0) + CHART_CACHE_RETENTION_MS,
  );
  const value = {
    mint,
    payload: row?.payload ?? null,
    checkedAt: row?.checkedAt ?? null,
    lease,
    leaseUntil: now + CHART_CACHE_LEASE_MS,
    lastAttemptAt: now,
    nextAttemptAt:
      now +
      marketFailureBackoff(
        Math.min(
          1000,
          (row?.failureCount ?? 0) + (row && row.leaseUntil > 0 ? 1 : 0),
        ) + 1,
      ),
    failureCount: Math.min(
      1000,
      (row?.failureCount ?? 0) + (row && row.leaseUntil > 0 ? 1 : 0),
    ),
    failureCode: row?.failureCode,
    cleanupAt,
  };
  const id = row
    ? row._id
    : await ctx.db.insert("forumDexMarketSnapshots", value);
  if (row) await ctx.db.replace("forumDexMarketSnapshots", id, value);
  await ctx.scheduler.runAfter(cleanupAt - now + 1, expireSnapshotRef, { id });
}
export const complete = internalMutation({
  args: completeArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const now = Date.now(),
      row = await dexSnapshot(ctx, args.mint);
    if (
      !row ||
      row.lease !== args.lease ||
      row.leaseUntil <= now ||
      row.lastAttemptAt !== args.attemptAt ||
      row.nextAttemptAt <= now
    )
      return false;
    if (
      !Number.isSafeInteger(args.checkedAt) ||
      args.checkedAt < args.attemptAt ||
      args.checkedAt > now + 60_000
    )
      throw Error("invalid_market_snapshot");
    if (args.payload !== null) parseDexSnapshot(args.payload, args.mint);
    const failures =
      args.payload === null ? Math.min(1000, row.failureCount + 1) : 0;
    const nextAttemptAt =
      args.payload !== null
        ? args.checkedAt + CHART_CACHE_FRESH_MS
        : Math.max(
            row.nextAttemptAt,
            now + marketFailureBackoff(failures),
            Number.isSafeInteger(args.retryAfterAt)
              ? Math.min(args.retryAfterAt!, now + CHART_CACHE_RETENTION_MS)
              : 0,
          );
    const cleanupAt = Math.max(
      row.cleanupAt,
      nextAttemptAt,
      (args.payload === null ? (row.checkedAt ?? 0) : args.checkedAt) +
        CHART_CACHE_RETENTION_MS,
    );
    await ctx.db.patch("forumDexMarketSnapshots", row._id, {
      payload: args.payload ?? row.payload,
      checkedAt: args.payload === null ? row.checkedAt : args.checkedAt,
      leaseUntil: 0,
      nextAttemptAt,
      cleanupAt,
      failureCount: failures,
      failureCode:
        args.payload === null
          ? (args.failureCode ?? "invalid-response")
          : undefined,
    });
    if (cleanupAt !== row.cleanupAt)
      await ctx.scheduler.runAfter(
        Math.max(1, cleanupAt - now + 1),
        expireSnapshotRef,
        { id: row._id },
      );
    return true;
  },
});
export const expire = internalMutation({
  args: { id: v.id("forumDexMarketSnapshots") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("forumDexMarketSnapshots", id);
    if (
      row &&
      row.cleanupAt <= Date.now() &&
      row.leaseUntil <= Date.now() &&
      row.nextAttemptAt <= Date.now()
    )
      await ctx.db.delete("forumDexMarketSnapshots", id);
    return null;
  },
});
