import { getGithubPortfolioMetrics } from "../lib/github-portfolio";
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";

const SNAPSHOT_KEY = "symbaiex";
const MIN_REFRESH_INTERVAL_MS = 10 * 60 * 1000;

const latestForRefreshRef = makeFunctionReference<
  "query",
  Record<string, never>,
  { refreshedAt: number } | null
>("githubPortfolio:latestForRefresh");

const storeSnapshotRef = makeFunctionReference<
  "mutation",
  {
    key: string;
    metricsJson: string;
    source: "cron" | "manual";
    refreshedAt: number;
  },
  { stored: boolean }
>("githubPortfolio:storeSnapshot");

const markRefreshFailedRef = makeFunctionReference<
  "mutation",
  {
    key: string;
    errorMessage: string;
    failedAt: number;
  },
  { marked: boolean }
>("githubPortfolio:markRefreshFailed");

export const latest = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("githubPortfolioSnapshots")
      .withIndex("by_key", (q) => q.eq("key", SNAPSHOT_KEY))
      .unique();
  },
});

export const latestForRefresh = internalQuery({
  args: {},
  handler: async (ctx) => {
    const snapshot = await ctx.db
      .query("githubPortfolioSnapshots")
      .withIndex("by_key", (q) => q.eq("key", SNAPSHOT_KEY))
      .unique();
    return snapshot ? { refreshedAt: snapshot.refreshedAt } : null;
  },
});

export const refreshPortfolioMetrics = internalAction({
  args: {
    force: v.optional(v.boolean()),
    source: v.optional(v.union(v.literal("cron"), v.literal("manual"))),
  },
  handler: async (ctx, args) => {
    const source = args.source ?? "manual";
    const latestSnapshot = await ctx.runQuery(latestForRefreshRef, {});
    const now = Date.now();

    if (
      !args.force &&
      latestSnapshot &&
      now - latestSnapshot.refreshedAt < MIN_REFRESH_INTERVAL_MS
    ) {
      return {
        ok: true,
        skipped: true,
        refreshedAt: latestSnapshot.refreshedAt,
      };
    }

    try {
      const metrics = await getGithubPortfolioMetrics({ allowFallback: false });
      const refreshedAt = Date.now();
      await ctx.runMutation(storeSnapshotRef, {
        key: SNAPSHOT_KEY,
        metricsJson: JSON.stringify(metrics),
        refreshedAt,
        source,
      });
      return { ok: true, skipped: false, refreshedAt };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "GitHub metric refresh failed";
      await ctx.runMutation(markRefreshFailedRef, {
        key: SNAPSHOT_KEY,
        errorMessage,
        failedAt: Date.now(),
      });
      return { ok: false, errorMessage };
    }
  },
});

export const storeSnapshot = internalMutation({
  args: {
    key: v.string(),
    metricsJson: v.string(),
    source: v.union(v.literal("cron"), v.literal("manual")),
    refreshedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubPortfolioSnapshots")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    const nextSnapshot = {
      metricsJson: args.metricsJson,
      source: args.source,
      refreshedAt: args.refreshedAt,
      lastErrorMessage: undefined,
      lastErrorAt: undefined,
    };

    if (existing === null) {
      await ctx.db.insert("githubPortfolioSnapshots", {
        key: args.key,
        ...nextSnapshot,
      });
    } else {
      await ctx.db.patch(existing._id, nextSnapshot);
    }

    return { stored: true };
  },
});

export const markRefreshFailed = internalMutation({
  args: {
    key: v.string(),
    errorMessage: v.string(),
    failedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("githubPortfolioSnapshots")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    if (existing === null) {
      return { marked: false };
    }

    await ctx.db.patch(existing._id, {
      lastErrorAt: args.failedAt,
      lastErrorMessage: args.errorMessage.slice(0, 500),
    });
    return { marked: true };
  },
});
