import { getFirstPartyAuthUserId as getAuthUserId } from "./authz";
import { ANALYTICS_DEDUPE_WINDOW_MS } from "../lib/analytics-attempt-throttle";
import { MINUTE, RateLimiter } from "@convex-dev/rate-limiter";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireSiteAdmin } from "./authz";

const analyticsSource = v.union(
  v.literal("client"),
  v.literal("server"),
  v.literal("api"),
  v.literal("convex"),
);

const NAME_LIMIT = 96;
const PATH_LIMIT = 220;
const SHORT_LIMIT = 180;
const USER_AGENT_LIMIT = 420;
const METADATA_LIMIT = 2_000;
const DEDUPE_WINDOW_MS = ANALYTICS_DEDUPE_WINDOW_MS;
const ADMIN_EVENT_LIMIT = 2_500;
const ANALYTICS_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const ANALYTICS_CLEANUP_BATCH = 200;

const publicAnalyticsRateLimiter = new RateLimiter(components.rateLimiter, {
  anonymousAnalyticsEvents: {
    kind: "token bucket",
    rate: 30,
    period: MINUTE,
    capacity: 30,
    // All actors share one global budget; caller-controlled account, visitor,
    // and session IDs must not split it. Three shards preserve the same 30/min
    // ceiling while reducing contention on the limiter component.
    shards: 3,
  },
});

type AnalyticsSource = Doc<"analyticsEvents">["source"];
type AnalyticsEvent = Doc<"analyticsEvents">;

export const record = mutation({
  args: {
    name: v.string(),
    path: v.optional(v.string()),
    route: v.optional(v.string()),
    title: v.optional(v.string()),
    referrer: v.optional(v.string()),
    sessionId: v.optional(v.string()),
    visitorId: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    device: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const name = cleanEventName(args.name);
    if (name.length === 0) {
      return { recorded: false, deduped: false, id: null };
    }

    const path = optionalClean(stripPath(args.path), PATH_LIMIT);
    const sessionId = optionalToken(args.sessionId);
    const visitorId = optionalToken(args.visitorId);
    const actorUserId = await getAuthUserId(ctx);

    const capacity = await publicAnalyticsRateLimiter.limit(
      ctx,
      "anonymousAnalyticsEvents",
      { key: "global" },
    );
    if (!capacity.ok) {
      await incrementDailyMetric(ctx, now, "droppedRateLimited");
      return {
        recorded: false,
        deduped: false,
        id: null,
        reason: "RATE_LIMITED" as const,
        retryAfter: capacity.retryAfter,
      };
    }

    if (sessionId !== undefined) {
      const recent = await ctx.db
        .query("analyticsEvents")
        .withIndex("by_sessionId_and_createdAt", (q) =>
          q.eq("sessionId", sessionId),
        )
        .order("desc")
        .take(5);
      const duplicate = recent.find(
        (event) =>
          event.name === name &&
          event.path === path &&
          now - event.createdAt < DEDUPE_WINDOW_MS,
      );
      if (duplicate !== undefined) {
        return { recorded: true, deduped: true, id: duplicate._id };
      }
    }

    const id = await ctx.db.insert("analyticsEvents", {
      name,
      source: "client",
      createdAt: now,
      ...(actorUserId !== null ? { actorUserId } : {}),
      ...optionalFields({
        path,
        route: optionalClean(args.route, PATH_LIMIT),
        title: optionalClean(args.title, SHORT_LIMIT),
        referrer: optionalClean(stripReferrer(args.referrer), PATH_LIMIT),
        sessionId,
        visitorId,
        userAgent: optionalClean(args.userAgent, USER_AGENT_LIMIT),
        device: optionalClean(args.device, SHORT_LIMIT),
        metadataJson: optionalClean(args.metadataJson, METADATA_LIMIT),
      }),
    });
    await incrementDailyMetric(ctx, now, "captured");

    return { recorded: true, deduped: false, id };
  },
});

export const listAdmin = query({
  args: {
    name: v.optional(v.string()),
    source: v.optional(analyticsSource),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 80), 200));
    const name = args.name ? cleanEventName(args.name) : undefined;

    if (name !== undefined && name.length > 0) {
      return await ctx.db
        .query("analyticsEvents")
        .withIndex("by_name_and_createdAt", (q) => q.eq("name", name))
        .order("desc")
        .take(limit);
    }

    if (args.source !== undefined) {
      return await ctx.db
        .query("analyticsEvents")
        .withIndex("by_source_and_createdAt", (q) =>
          q.eq("source", args.source!),
        )
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("analyticsEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .take(limit);
  },
});

export const summaryAdmin = query({
  args: {
    days: v.optional(v.number()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const days = Math.max(1, Math.min(Math.floor(args.days ?? 14), 90));
    // Optional during rolling deploys so the previous web bundle remains
    // compatible; current callers always pass a stable query timestamp.
    const now = args.now ?? Date.now();
    const start = now - days * 24 * 60 * 60 * 1000;
    const sample = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_createdAt")
      .order("desc")
      .take(ADMIN_EVENT_LIMIT);
    const events = sample.filter((event) => event.createdAt >= start);
    const pageViews = events.filter((event) => event.name === "page_view");
    const metrics = await ctx.db
      .query("analyticsDailyMetrics")
      .withIndex("by_date", (q) =>
        q.gte("date", dayKey(start)).lte("date", dayKey(now)),
      )
      .take(days);
    const captured = metrics.reduce((total, row) => total + row.captured, 0);
    const droppedRateLimited = metrics.reduce(
      (total, row) => total + row.droppedRateLimited,
      0,
    );
    const attempts = captured + droppedRateLimited;
    const todayKey = dayKey(now);

    return {
      windowDays: days,
      sampleSize: events.length,
      totals: {
        events: events.length,
        pageViews: pageViews.length,
        visitors: uniqueCount(events.map((event) => event.visitorId)),
        sessions: uniqueCount(events.map((event) => event.sessionId)),
        signedInEvents: events.filter(
          (event) => event.actorUserId !== undefined,
        ).length,
        todayEvents: events.filter(
          (event) => dayKey(event.createdAt) === todayKey,
        ).length,
      },
      capture: {
        captured,
        droppedRateLimited,
        captureRatio: attempts === 0 ? null : captured / attempts,
      },
      topEvents: ranked(events, (event) => event.name, 8),
      topPages: ranked(pageViews, (event) => event.path ?? "(unknown)", 10),
      referrers: ranked(
        pageViews,
        (event) => referrerHost(event.referrer) ?? "direct",
        8,
      ),
      sources: ranked(events, (event) => event.source, 8) as Array<{
        key: AnalyticsSource;
        count: number;
      }>,
      daily: dailyBuckets(events, days, now),
      recent: events.slice(0, 20),
    };
  },
});

export const cleanupExpired = internalMutation({
  args: {},
  returns: v.object({
    cutoff: v.number(),
    deleted: v.number(),
    hasMore: v.boolean(),
  }),
  handler: async (ctx) => {
    const cutoff = Date.now() - ANALYTICS_RETENTION_MS;
    const expired = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(ANALYTICS_CLEANUP_BATCH);
    await Promise.all(
      expired.map((event) => ctx.db.delete("analyticsEvents", event._id)),
    );
    return {
      cutoff,
      deleted: expired.length,
      hasMore: expired.length === ANALYTICS_CLEANUP_BATCH,
    };
  },
});

function ranked<T>(rows: T[], keyForRow: (row: T) => string, limit: number) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyForRow(row).trim() || "(unknown)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.key.localeCompare(right.key),
    )
    .slice(0, limit);
}

function dailyBuckets(events: AnalyticsEvent[], days: number, now: number) {
  const counts = new Map<string, { events: number; pageViews: number }>();
  const today = new Date(now);
  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - index);
    counts.set(date.toISOString().slice(0, 10), { events: 0, pageViews: 0 });
  }
  for (const event of events) {
    const key = dayKey(event.createdAt);
    const bucket = counts.get(key);
    if (bucket === undefined) {
      continue;
    }
    bucket.events += 1;
    if (event.name === "page_view") {
      bucket.pageViews += 1;
    }
  }
  return [...counts.entries()].map(([date, values]) => ({
    date,
    ...values,
  }));
}

function uniqueCount(values: Array<string | undefined>) {
  return new Set(values.filter((value): value is string => value !== undefined))
    .size;
}

function dayKey(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

async function incrementDailyMetric(
  ctx: MutationCtx,
  timestamp: number,
  field: "captured" | "droppedRateLimited",
) {
  const date = dayKey(timestamp);
  const existing = await ctx.db
    .query("analyticsDailyMetrics")
    .withIndex("by_date", (q) => q.eq("date", date))
    .unique();
  if (existing === null) {
    await ctx.db.insert("analyticsDailyMetrics", {
      date,
      captured: field === "captured" ? 1 : 0,
      droppedRateLimited: field === "droppedRateLimited" ? 1 : 0,
      updatedAt: timestamp,
    });
    return;
  }
  await ctx.db.patch("analyticsDailyMetrics", existing._id, {
    [field]: existing[field] + 1,
    updatedAt: timestamp,
  });
}

function referrerHost(value: string | undefined) {
  if (value === undefined || value.length === 0) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function cleanEventName(value: string) {
  return clean(value, NAME_LIMIT)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function optionalToken(value: string | undefined) {
  const cleaned = optionalClean(value, 120);
  if (cleaned === undefined) {
    return undefined;
  }
  return /^[a-zA-Z0-9:_-]+$/.test(cleaned) ? cleaned : undefined;
}

function optionalFields<T extends Record<string, unknown>>(fields: T) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

function optionalClean(value: string | undefined, limit: number) {
  if (value === undefined) {
    return undefined;
  }
  const cleaned = clean(value, limit);
  return cleaned.length > 0 ? cleaned : undefined;
}

function clean(value: string, limit: number) {
  return redact(value).replace(/\s+/g, " ").trim().slice(0, limit);
}

function stripPath(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  try {
    const url = new URL(value, "https://symbaiex.local");
    return url.pathname;
  } catch {
    return value.split("#")[0]?.split("?")[0] ?? value;
  }
}

function stripReferrer(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return value.split("#")[0]?.split("?")[0] ?? value;
  }
}

function redact(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(re|sk|sym|jrt)_[A-Za-z0-9_-]{12,}\b/g, "[secret]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [secret]");
}
