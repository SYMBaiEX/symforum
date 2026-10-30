import { v } from "convex/values";
import { isSolanaAddress } from "../lib/forum-commerce";
import { TERMINAL_FRESH_MS } from "../lib/forum-terminal-data";
import {
  TOKEN_ALPHA_AGENTS,
  type TokenPlatform,
  type TokenSnapshot,
} from "../lib/token-alpha";
import { internal } from "./_generated/api";
import { env, internalMutation, type MutationCtx } from "./_generated/server";
import {
  identityUsable,
  pilotEnabled,
  tokenAlphaRunKey,
} from "./tokenAlphaData";
import {
  tokenPlatformValidator,
  tokenSnapshotValidator,
} from "./tokenAlphaSchema";

const LIFETIME_MS = 30 * 60_000;
const PAYLOAD_RETENTION_MS = 24 * 60 * 60_000;
const PRUNE_BATCH_SIZE = 5;
const snapshotList = v.array(tokenSnapshotValidator);

export type ObservationClaim = {
  runKey: string;
  state: "claimed" | "ready" | "unavailable";
  snapshots: TokenSnapshot[];
};

/** Source authority deliberately excludes model health/spend/publication gates.
 * It can only observe public data; the original claimRun retains those gates. */
async function observationEnabled(ctx: MutationCtx, platform: TokenPlatform) {
  if (!(await pilotEnabled(ctx)) || env.ELIZA_RUNTIME_MODE !== "live")
    return false;
  const entry = TOKEN_ALPHA_AGENTS[platform];
  const agent = await ctx.db
    .query("forumAgents")
    .withIndex("by_slug", (q) => q.eq("slug", entry.slug))
    .unique();
  if (!agent?.enabled || agent.dailyPostTarget < 1) return false;
  const user = await ctx.db.get("users", agent.userId);
  return (
    user !== null &&
    identityUsable(user, Date.now()) &&
    user.agentSlug === entry.slug
  );
}

/** Persistence is not a second provider parser, but must reject forged/stale
 * internal writes before exposing them through the shared public projection. */
export function validObservationSnapshots(
  snapshots: TokenSnapshot[],
  platform: TokenPlatform,
  now: number,
) {
  if (snapshots.length > 5) return false;
  const seen = new Set<string>();
  for (const [index, snapshot] of snapshots.entries()) {
    if (
      snapshot.platform !== platform ||
      !isSolanaAddress(snapshot.mint) ||
      seen.has(snapshot.mint) ||
      !snapshot.name.trim() ||
      snapshot.name.length > 200 ||
      !snapshot.symbol.trim() ||
      snapshot.symbol.length > 80 ||
      !Number.isSafeInteger(snapshot.metricsAsOf) ||
      !Number.isSafeInteger(snapshot.observedAt) ||
      snapshot.metricsAsOf < now - TERMINAL_FRESH_MS ||
      snapshot.observedAt < now - TERMINAL_FRESH_MS ||
      snapshot.metricsAsOf > now + 60_000 ||
      snapshot.observedAt > now + 60_000 ||
      !Number.isSafeInteger(snapshot.sourceRank) ||
      snapshot.sourceRank !== index + 1 ||
      (index > 0 &&
        Number(snapshot.volume1hUsd) >
          Number(snapshots[index - 1].volume1hUsd)) ||
      snapshot.sourceUrl !==
        `https://www.solanatracker.io/token/${snapshot.mint}` ||
      [
        snapshot.priceUsd,
        snapshot.marketCapUsd,
        snapshot.holders,
        snapshot.volume1hUsd,
        snapshot.liquidityUsd,
      ].some((value) => !Number.isFinite(value) || Number(value) <= 0) ||
      (snapshot.priceChange1hPercent !== null &&
        !Number.isFinite(snapshot.priceChange1hPercent))
    )
      return false;
    seen.add(snapshot.mint);
  }
  return true;
}

/** Keep the permanent idempotency receipt, not unbounded historical payloads.
 * The completed/expiry index excludes fresh, failed and in-flight records. */
async function pruneExpiredPayloads(ctx: MutationCtx, now: number) {
  const expired = await ctx.db
    .query("tokenAlphaObservations")
    .withIndex("by_status_and_payloadExpiresAt", (q) =>
      q
        .eq("status", "completed")
        .gte("payloadExpiresAt", 0)
        .lte("payloadExpiresAt", now),
    )
    .take(PRUNE_BATCH_SIZE);
  for (const row of expired)
    await ctx.db.patch("tokenAlphaObservations", row._id, {
      snapshots: undefined,
      payloadExpiresAt: undefined,
    });
}

export const claim = internalMutation({
  args: { platform: tokenPlatformValidator, claimToken: v.string() },
  returns: v.object({
    runKey: v.string(),
    state: v.union(
      v.literal("claimed"),
      v.literal("ready"),
      v.literal("unavailable"),
    ),
    snapshots: snapshotList,
  }),
  handler: async (ctx, { platform, claimToken }): Promise<ObservationClaim> => {
    if (!claimToken.trim() || claimToken.length > 128)
      throw new Error("Invalid source claim token");
    const now = Date.now();
    const runKey = tokenAlphaRunKey(platform, now);
    const unavailable = {
      runKey,
      state: "unavailable" as const,
      snapshots: [],
    };
    if (!(await observationEnabled(ctx, platform))) return unavailable;
    await pruneExpiredPayloads(ctx, now);
    const existing = await ctx.db
      .query("tokenAlphaObservations")
      .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
      .unique();
    if (existing) {
      // A failed, expired or incomplete intent is never reopened. Even if the
      // worker died before its HTTP response, the request might have cost quota.
      return existing.status === "completed" &&
        existing.snapshots !== undefined &&
        validObservationSnapshots(existing.snapshots, platform, now)
        ? { runKey, state: "ready", snapshots: existing.snapshots }
        : unavailable;
    }
    // Before cutover an ordinary run may already have fetched or generated.
    // Do not route around that old intent or spend again in its same hour.
    const priorRun = await ctx.db
      .query("tokenAlphaRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
      .unique();
    if (priorRun) return unavailable;
    await ctx.db.insert("tokenAlphaObservations", {
      runKey,
      platform,
      claimToken,
      status: "running",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + LIFETIME_MS,
    });
    return { runKey, state: "claimed", snapshots: [] };
  },
});

export const complete = internalMutation({
  args: { runKey: v.string(), claimToken: v.string(), snapshots: snapshotList },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("tokenAlphaObservations")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    const now = Date.now();
    if (
      !row ||
      row.claimToken !== args.claimToken ||
      row.status !== "running" ||
      row.expiresAt <= now
    )
      return false;
    if (!(await observationEnabled(ctx, row.platform))) return false;
    if (!validObservationSnapshots(args.snapshots, row.platform, now))
      throw new Error("Invalid source observation");
    // The immutable source receipt and public display projection commit in the
    // same transaction. If projection fails, neither is marked complete.
    await ctx.runMutation(internal.forumTerminalData.recordSnapshots, {
      snapshots: args.snapshots,
    });
    await ctx.db.patch("tokenAlphaObservations", row._id, {
      status: "completed",
      snapshots: args.snapshots,
      payloadExpiresAt: now + PAYLOAD_RETENTION_MS,
      sourceCount: args.snapshots.length,
      updatedAt: now,
    });
    return true;
  },
});

export const fail = internalMutation({
  args: { runKey: v.string(), claimToken: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!/^token-source-[a-z0-9:-]{1,100}$/.test(args.reason))
      throw new Error("Invalid source failure code");
    const row = await ctx.db
      .query("tokenAlphaObservations")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (row?.status === "running" && row.claimToken === args.claimToken)
      await ctx.db.patch("tokenAlphaObservations", row._id, {
        status: "failed",
        reason: args.reason,
        updatedAt: Date.now(),
      });
    return null;
  },
});
