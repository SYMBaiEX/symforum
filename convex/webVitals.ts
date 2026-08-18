import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  WEB_VITAL_BUDGETS,
  WEB_VITAL_METRICS,
  WEB_VITAL_NAVIGATION_TYPES,
  WEB_VITAL_RATINGS,
  publicRouteTemplate,
  type WebVitalMetricName,
} from "../lib/web-vitals";
import { env, internalMutation, mutation, query } from "./_generated/server";
import { requireSiteAdmin } from "./authz";

const webVitalsEnv = env as typeof env & {
  WEB_VITALS_COLLECTION_ENABLED: string | undefined;
  WEB_VITALS_CLEANUP_ENABLED: string | undefined;
};

const WEB_VITAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;
const WEB_VITAL_CLEANUP_BATCH = 250;
const WEB_VITAL_ADMIN_SAMPLE_LIMIT = 5_000;
const WEB_VITAL_MINUTE_CAP = 500;
const WEB_VITAL_DEDUPE_WINDOW_MS = 10_000;
const cleanupExpiredRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  unknown
>("webVitals:cleanupExpired");
const metricValidator = v.union(...WEB_VITAL_METRICS.map(v.literal));
const ratingValidator = v.union(...WEB_VITAL_RATINGS.map(v.literal));
const navigationTypeValidator = v.union(
  ...WEB_VITAL_NAVIGATION_TYPES.map(v.literal),
);

export const record = mutation({
  args: {
    route: v.string(),
    name: metricValidator,
    value: v.number(),
    rating: ratingValidator,
    navigationType: navigationTypeValidator,
    timestamp: v.number(),
  },
  returns: v.object({ recorded: v.boolean(), deduped: v.boolean() }),
  handler: async (ctx, args) => {
    if (!collectionEnabled() || !validValue(args.name, args.value)) {
      return { recorded: false, deduped: false };
    }
    const route = publicRouteTemplate(args.route);
    if (route === null || route !== args.route) {
      return { recorded: false, deduped: false };
    }
    const now = Date.now();
    if (
      !Number.isFinite(args.timestamp) ||
      Math.abs(now - args.timestamp) > 300_000
    ) {
      return { recorded: false, deduped: false };
    }
    const dedupeKey = `${route}:${args.name}:${args.navigationType}:${Math.floor(
      args.timestamp / WEB_VITAL_DEDUPE_WINDOW_MS,
    )}:${Math.round(args.value * 100)}`;
    const duplicate = await ctx.db
      .query("webVitalEvents")
      .withIndex("by_dedupeKey", (q) => q.eq("dedupeKey", dedupeKey))
      .unique();
    if (duplicate !== null) return { recorded: false, deduped: true };

    const minute = Math.floor(now / 60_000);
    const bucket = await ctx.db
      .query("webVitalMinuteBuckets")
      .withIndex("by_minute", (q) => q.eq("minute", minute))
      .unique();
    if ((bucket?.sampleCount ?? 0) >= WEB_VITAL_MINUTE_CAP) {
      return { recorded: false, deduped: false };
    }
    if (bucket === null) {
      await ctx.db.insert("webVitalMinuteBuckets", {
        minute,
        sampleCount: 1,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch("webVitalMinuteBuckets", bucket._id, {
        sampleCount: bucket.sampleCount + 1,
        updatedAt: now,
      });
    }
    await ctx.db.insert("webVitalEvents", {
      route,
      name: args.name,
      value: args.value,
      rating: args.rating,
      navigationType: args.navigationType,
      timestamp: args.timestamp,
      dedupeKey,
      createdAt: now,
    });
    return { recorded: true, deduped: false };
  },
});

export const summaryAdmin = query({
  args: { days: v.optional(v.number()), now: v.optional(v.number()) },
  returns: v.object({
    windowDays: v.number(),
    sampled: v.number(),
    routes: v.array(
      v.object({
        route: v.string(),
        name: metricValidator,
        samples: v.number(),
        p50: v.number(),
        p75: v.number(),
        p95: v.number(),
        passRate: v.number(),
        budget: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const days = Math.max(1, Math.min(Math.floor(args.days ?? 14), 30));
    const now = args.now ?? Date.now();
    const start = now - days * 24 * 60 * 60 * 1_000;
    const sample = await ctx.db
      .query("webVitalEvents")
      .withIndex("by_createdAt", (q) =>
        q.gte("createdAt", start).lte("createdAt", now),
      )
      .order("desc")
      .take(WEB_VITAL_ADMIN_SAMPLE_LIMIT);
    const groups = new Map<string, typeof sample>();
    for (const event of sample) {
      const key = `${event.route}:${event.name}`;
      const group = groups.get(key) ?? [];
      group.push(event);
      groups.set(key, group);
    }
    return {
      windowDays: days,
      sampled: sample.length,
      routes: [...groups.values()]
        .map((events) => summarize(events))
        .sort(
          (left, right) =>
            right.samples - left.samples ||
            left.route.localeCompare(right.route),
        ),
    };
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  returns: v.object({
    deletedEvents: v.number(),
    deletedBuckets: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    if (!cleanupEnabled()) {
      return { deletedEvents: 0, deletedBuckets: 0, hasMore: false };
    }
    const cutoff = Date.now() - WEB_VITAL_RETENTION_MS;
    const [events, buckets] = await Promise.all([
      ctx.db
        .query("webVitalEvents")
        .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
        .take(WEB_VITAL_CLEANUP_BATCH),
      ctx.db
        .query("webVitalMinuteBuckets")
        .withIndex("by_minute", (q) =>
          q.lt("minute", Math.floor(cutoff / 60_000)),
        )
        .take(WEB_VITAL_CLEANUP_BATCH),
    ]);
    await Promise.all([
      ...events.map((event) => ctx.db.delete("webVitalEvents", event._id)),
      ...buckets.map((bucket) =>
        ctx.db.delete("webVitalMinuteBuckets", bucket._id),
      ),
    ]);
    const hasMore =
      events.length === WEB_VITAL_CLEANUP_BATCH ||
      buckets.length === WEB_VITAL_CLEANUP_BATCH;
    if (hasMore) {
      await ctx.scheduler.runAfter(0, cleanupExpiredRef, {});
    }
    return {
      deletedEvents: events.length,
      deletedBuckets: buckets.length,
      hasMore,
    };
  },
});

function summarize(
  events: Array<{ route: string; name: WebVitalMetricName; value: number }>,
) {
  const values = events
    .map((event) => event.value)
    .sort((left, right) => left - right);
  const first = events[0];
  if (first === undefined)
    throw new Error("Web Vitals summary requires events.");
  const budget = WEB_VITAL_BUDGETS[first.name];
  return {
    route: first.route,
    name: first.name,
    samples: values.length,
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p95: percentile(values, 0.95),
    passRate:
      events.filter((event) => event.value <= budget).length / events.length,
    budget,
  };
}

function percentile(values: number[], percentileValue: number) {
  return (
    values[
      Math.min(
        values.length - 1,
        Math.ceil(values.length * percentileValue) - 1,
      )
    ] ?? 0
  );
}

function validValue(name: WebVitalMetricName, value: number) {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= (name === "CLS" ? 10 : 120_000)
  );
}

function collectionEnabled() {
  return (
    webVitalsEnv.WEB_VITALS_COLLECTION_ENABLED?.trim().toLowerCase() !== "false"
  );
}

function cleanupEnabled() {
  return (
    webVitalsEnv.WEB_VITALS_CLEANUP_ENABLED?.trim().toLowerCase() !== "false"
  );
}
