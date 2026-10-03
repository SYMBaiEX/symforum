import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { contentSummary, contentSummaries } from "./contentAggregates";
import {
  deleteUniversalSearchProjection,
  syncNewsStoryUniversalSearchProjection,
} from "./universalSearchProjection";

const HN_TOP_STORIES_URL =
  "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item/";

const storeSnapshotRef = makeFunctionReference<
  "mutation",
  {
    snapshotDate: string;
    startedAt: number;
    stories: Array<{
      hnItemId: number;
      snapshotDate: string;
      rank: number;
      title: string;
      url?: string;
      host?: string;
      by?: string;
      text?: string;
      score?: number;
      descendants?: number;
      timePosted?: number;
      fetchedAt: number;
    }>;
  },
  null
>("news:storeSnapshot");

const markSnapshotStartedRef = makeFunctionReference<
  "mutation",
  {
    snapshotDate: string;
    startedAt: number;
  },
  null
>("news:markSnapshotStarted");

const markSnapshotFailedRef = makeFunctionReference<
  "mutation",
  {
    snapshotDate: string;
    startedAt: number;
    errorMessage: string;
  },
  null
>("news:markSnapshotFailed");

function clampStoryLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 30;
  }
  return Math.max(1, Math.min(100, Math.floor(value)));
}

function snapshotDate(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function hostname(url: string | undefined) {
  const safeUrl = safeExternalUrl(url);
  if (!safeUrl) {
    return undefined;
  }
  try {
    return new URL(safeUrl).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function safeExternalUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

async function getPlatformStats(ctx: QueryCtx, hnItemId: number) {
  return await contentSummary(ctx, "hnStory", String(hnItemId));
}

async function withPlatformStats(ctx: QueryCtx, story: Doc<"hnStories">) {
  return {
    ...story,
    platformStats: await getPlatformStats(ctx, story.hnItemId),
  };
}

async function recentSnapshots(ctx: QueryCtx) {
  return await ctx.db
    .query("newsSnapshots")
    .withIndex("by_snapshotDate")
    .order("desc")
    .take(60);
}

async function latestIndexedSnapshot(ctx: QueryCtx) {
  // The normal case is that today's newest snapshot completed with stories.
  // Read that single indexed row first instead of transferring the entire
  // 60-snapshot timeline on every homepage/latest-news request. Retain the
  // bounded historical scan only for an in-progress, failed, or empty latest
  // refresh so callers keep the existing last-known-good fallback.
  const [latest] = await ctx.db
    .query("newsSnapshots")
    .withIndex("by_snapshotDate")
    .order("desc")
    .take(1);
  if (
    latest !== undefined &&
    latest.status === "complete" &&
    latest.storyCount > 0
  ) {
    return latest;
  }
  const snapshots = await recentSnapshots(ctx);
  return (
    snapshots.find(
      (snapshot) => snapshot.status === "complete" && snapshot.storyCount > 0,
    ) ??
    latest ??
    null
  );
}

async function snapshotForDate(ctx: QueryCtx, date: string) {
  const rows = await ctx.db
    .query("newsSnapshots")
    .withIndex("by_snapshotDate", (q) => q.eq("snapshotDate", date))
    .take(1);
  return rows[0] ?? null;
}

async function storiesForSnapshot(ctx: QueryCtx, date: string) {
  return await ctx.db
    .query("hnStories")
    .withIndex("by_snapshotDate_and_rank", (q) => q.eq("snapshotDate", date))
    .order("asc")
    .take(30);
}

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const snapshot = await latestIndexedSnapshot(ctx);
    if (snapshot === null) {
      return { snapshot: null, stories: [] };
    }

    return {
      snapshot,
      stories: await storiesForSnapshot(ctx, snapshot.snapshotDate),
    };
  },
});

export const readIndexedSnapshot = internalQuery({
  args: {
    snapshotDate: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const snapshot = args.snapshotDate
      ? await snapshotForDate(ctx, args.snapshotDate)
      : await latestIndexedSnapshot(ctx);
    if (snapshot === null) {
      return { snapshot: null, stories: [] };
    }

    const stories = await ctx.db
      .query("hnStories")
      .withIndex("by_snapshotDate_and_rank", (q) =>
        q.eq("snapshotDate", snapshot.snapshotDate),
      )
      .order("asc")
      .take(clampStoryLimit(args.limit));

    return { snapshot, stories };
  },
});

/** Read only snapshot metadata when orchestration needs no story payload. */
export const readIndexedSnapshotSummary = internalQuery({
  args: {
    snapshotDate: v.optional(v.string()),
    completedAfter: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const snapshot = args.snapshotDate
      ? await snapshotForDate(ctx, args.snapshotDate)
      : await latestIndexedSnapshot(ctx);
    if (
      snapshot === null ||
      snapshot.status !== "complete" ||
      snapshot.storyCount <= 0 ||
      (args.completedAfter !== undefined &&
        (snapshot.completedAt === undefined ||
          snapshot.completedAt < args.completedAfter))
    ) {
      return null;
    }
    return {
      snapshotDate: snapshot.snapshotDate,
      storyCount: snapshot.storyCount,
      ...(snapshot.completedAt === undefined
        ? {}
        : { completedAt: snapshot.completedAt }),
    };
  },
});

export const readRecentStoryCorpus = internalQuery({
  args: {
    days: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const days = Math.max(1, Math.min(Math.floor(args.days ?? 7), 14));
    const limit = Math.max(8, Math.min(Math.floor(args.limit ?? 28), 60));
    const snapshots = (await recentSnapshots(ctx))
      .filter(
        (snapshot) => snapshot.status === "complete" && snapshot.storyCount > 0,
      )
      .slice(0, days);
    const rows = (
      await Promise.all(
        snapshots.map((snapshot) =>
          ctx.db
            .query("hnStories")
            .withIndex("by_snapshotDate_and_rank", (q) =>
              q.eq("snapshotDate", snapshot.snapshotDate),
            )
            .order("asc")
            .take(20),
        ),
      )
    ).flat();
    const bestByStoryId = new Map<number, Doc<"hnStories">>();
    for (const story of rows) {
      const existing = bestByStoryId.get(story.hnItemId);
      if (
        existing === undefined ||
        story.rank < existing.rank ||
        (story.rank === existing.rank &&
          (story.score ?? 0) > (existing.score ?? 0))
      ) {
        bestByStoryId.set(story.hnItemId, story);
      }
    }
    const stories = [...bestByStoryId.values()]
      .sort(
        (left, right) =>
          left.rank - right.rank || (right.score ?? 0) - (left.score ?? 0),
      )
      .slice(0, limit);

    return {
      snapshotDate: snapshots[0]?.snapshotDate ?? null,
      stories,
    };
  },
});

export const timeline = query({
  args: {
    snapshotDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const snapshots = await recentSnapshots(ctx);
    const snapshot = args.snapshotDate
      ? await snapshotForDate(ctx, args.snapshotDate)
      : (snapshots.find(
          (row) => row.status === "complete" && row.storyCount > 0,
        ) ??
        snapshots[0] ??
        null);

    if (snapshot === null) {
      return { snapshots, snapshot: null, stories: [] };
    }

    return {
      snapshots,
      snapshot,
      stories: await storiesForSnapshot(ctx, snapshot.snapshotDate),
    };
  },
});

/** Shared forum/news read boundary: stored HN snapshots only, never fetches. */
export async function readForumNewsFeed(
  ctx: QueryCtx,
  args: { snapshotDate?: string; limit?: number },
) {
  if (
    args.snapshotDate !== undefined &&
    !/^\d{4}-\d{2}-\d{2}$/.test(args.snapshotDate)
  ) {
    throw new Error("Use a YYYY-MM-DD news snapshot date.");
  }
  const limit = args.limit ?? 12;
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
    throw new Error("Request 1–30 news stories.");
  }
  const snapshots = await recentSnapshots(ctx);
  const snapshot = args.snapshotDate
    ? await snapshotForDate(ctx, args.snapshotDate)
    : (snapshots.find(
        (row) => row.status === "complete" && row.storyCount > 0,
      ) ??
      snapshots[0] ??
      null);
  const metadata = (row: Doc<"newsSnapshots">) => ({
    snapshotDate: row.snapshotDate,
    status: row.status,
    storyCount: row.storyCount,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  });
  if (snapshot === null || snapshot.status !== "complete") {
    return {
      snapshots: snapshots.map(metadata),
      snapshot: snapshot ? metadata(snapshot) : null,
      stories: [],
    };
  }
  const stories: Doc<"hnStories">[] = [];
  let bodyCharactersRead = 0;
  let limited = false;
  for await (const story of ctx.db
    .query("hnStories")
    .withIndex("by_snapshotDate_and_rank", (q) =>
      q.eq("snapshotDate", snapshot.snapshotDate),
    )
    .order("asc")) {
    stories.push(story);
    bodyCharactersRead += (story.text?.length ?? 0) + story.title.length;
    // A stored document is <1 MiB. Stop before starting another read once
    // accumulated text reaches this reserve, leaving room for shared stats.
    if (bodyCharactersRead >= 1_000_000) {
      limited = true;
      break;
    }
    if (stories.length >= limit) break;
  }
  const migrations = await Promise.all(
    ["interaction-aggregates-v1", "comment-aggregates-v1"].map((key) =>
      ctx.db
        .query("optimizationMigrations")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique(),
    ),
  );
  // Existing detail endpoints retain legacy fallback. A multi-story feed must
  // not multiply that fallback into 60k full comment/interaction reads.
  const statsAvailable = migrations.every((row) => row?.status === "completed");
  const stats = statsAvailable
    ? await contentSummaries(
        ctx,
        "hnStory",
        stories.map((story) => String(story.hnItemId)),
      )
    : null;
  return {
    snapshots: snapshots.map(metadata),
    snapshot: metadata(snapshot),
    limited,
    stories: stories.map((story) => ({
      hnItemId: story.hnItemId,
      title: story.title,
      rank: story.rank,
      url: safeExternalUrl(story.url),
      host: hostname(story.url),
      by: story.by,
      hnScore: story.score,
      hnCommentCount: story.descendants,
      timePosted: story.timePosted,
      fetchedAt: story.fetchedAt,
      discussionUrl: `https://news.ycombinator.com/item?id=${story.hnItemId}`,
      platformStats: stats?.get(String(story.hnItemId)) ?? null,
      platformStatsStatus: statsAvailable
        ? ("available" as const)
        : ("unavailable" as const),
    })),
  };
}

export const getStory = query({
  args: {
    hnItemId: v.number(),
  },
  handler: async (ctx, args) => {
    const story = await ctx.db
      .query("hnStories")
      .withIndex("by_hnItemId_and_fetchedAt", (q) =>
        q.eq("hnItemId", args.hnItemId),
      )
      .order("desc")
      .first();
    if (story === null) {
      return null;
    }
    return await withPlatformStats(ctx, story);
  },
});

export const refreshTopStories = internalAction({
  args: {
    limit: v.optional(v.number()),
    scheduleForumDigest: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const date = snapshotDate();
    const startedAt = Date.now();
    const limit = clampStoryLimit(args.limit);
    await ctx.runMutation(markSnapshotStartedRef, {
      snapshotDate: date,
      startedAt,
    });

    try {
      const topResponse = await fetch(HN_TOP_STORIES_URL);
      if (!topResponse.ok) {
        throw new Error(`HN topstories failed: ${topResponse.status}`);
      }
      const ids = (await topResponse.json()) as number[];
      const topIds = ids.slice(0, limit);
      const stories = await Promise.all(
        topIds.map(async (id, index) => {
          const response = await fetch(`${HN_ITEM_URL}${id}.json`);
          if (!response.ok) {
            return null;
          }
          const item = (await response.json()) as {
            id: number;
            title?: string;
            url?: string;
            by?: string;
            text?: string;
            score?: number;
            descendants?: number;
            time?: number;
            deleted?: boolean;
            dead?: boolean;
          } | null;
          if (!item || item.deleted || item.dead || !item.title) {
            return null;
          }
          const url = safeExternalUrl(item.url);
          return {
            hnItemId: item.id,
            snapshotDate: date,
            rank: index + 1,
            title: item.title,
            url,
            host: hostname(url),
            by: item.by,
            text: item.text,
            score: item.score,
            descendants: item.descendants,
            timePosted: item.time,
            fetchedAt: Date.now(),
          };
        }),
      );

      const cleanStories = stories.filter((story) => story !== null);
      await ctx.runMutation(storeSnapshotRef, {
        snapshotDate: date,
        startedAt,
        stories: cleanStories,
      });
      if (args.scheduleForumDigest !== false) {
        await ctx.scheduler.runAfter(
          60_000,
          internal.belleForumAgent.runDailyHackerNewsDigest,
          {
            snapshotDate: date,
          },
        );
      }
      return { snapshotDate: date, storyCount: cleanStories.length };
    } catch (error) {
      await ctx.runMutation(markSnapshotFailedRef, {
        snapshotDate: date,
        startedAt,
        errorMessage:
          error instanceof Error ? error.message : "Unknown news refresh error",
      });
      throw error;
    }
  },
});

export const markSnapshotStarted = internalMutation({
  args: {
    snapshotDate: v.string(),
    startedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("newsSnapshots")
      .withIndex("by_snapshotDate", (q) =>
        q.eq("snapshotDate", args.snapshotDate),
      )
      .take(1);
    const existingSnapshot = existing[0] ?? null;

    if (existingSnapshot === null) {
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: args.snapshotDate,
        status: "running",
        startedAt: args.startedAt,
        storyCount: 0,
      });
      return null;
    }

    await ctx.db.patch("newsSnapshots", existingSnapshot._id, {
      status: "running",
      startedAt: args.startedAt,
      errorMessage: undefined,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.news.reconcileSnapshotProjections,
      {
        snapshotDate: args.snapshotDate,
      },
    );
    return null;
  },
});

export const markSnapshotFailed = internalMutation({
  args: {
    snapshotDate: v.string(),
    startedAt: v.number(),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("newsSnapshots")
      .withIndex("by_snapshotDate", (q) =>
        q.eq("snapshotDate", args.snapshotDate),
      )
      .take(1);
    const existingSnapshot = existing[0] ?? null;
    const errorMessage = args.errorMessage.slice(0, 1000);

    if (existingSnapshot === null) {
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: args.snapshotDate,
        status: "failed",
        startedAt: args.startedAt,
        completedAt: Date.now(),
        storyCount: 0,
        errorMessage,
      });
      return null;
    }

    await ctx.db.patch("newsSnapshots", existingSnapshot._id, {
      status: "failed",
      startedAt: args.startedAt,
      completedAt: Date.now(),
      errorMessage,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.news.reconcileSnapshotProjections,
      {
        snapshotDate: args.snapshotDate,
      },
    );
    return null;
  },
});

export const storeSnapshot = internalMutation({
  args: {
    snapshotDate: v.string(),
    startedAt: v.number(),
    stories: v.array(
      v.object({
        hnItemId: v.number(),
        snapshotDate: v.string(),
        rank: v.number(),
        title: v.string(),
        url: v.optional(v.string()),
        host: v.optional(v.string()),
        by: v.optional(v.string()),
        text: v.optional(v.string()),
        score: v.optional(v.number()),
        descendants: v.optional(v.number()),
        timePosted: v.optional(v.number()),
        fetchedAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("newsSnapshots")
      .withIndex("by_snapshotDate", (q) =>
        q.eq("snapshotDate", args.snapshotDate),
      )
      .take(1);
    const existingSnapshot = existing[0] ?? null;

    if (existingSnapshot === null) {
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: args.snapshotDate,
        status: "complete",
        startedAt: args.startedAt,
        completedAt: Date.now(),
        storyCount: args.stories.length,
      });
    } else {
      await ctx.db.patch("newsSnapshots", existingSnapshot._id, {
        status: "complete",
        completedAt: Date.now(),
        storyCount: args.stories.length,
        errorMessage: undefined,
      });
    }

    const current = await ctx.db
      .query("hnStories")
      .withIndex("by_snapshotDate_and_rank", (q) =>
        q.eq("snapshotDate", args.snapshotDate),
      )
      .take(100);
    for (const story of current) {
      await ctx.db.delete("hnStories", story._id);
    }
    for (const story of args.stories) {
      const storyId = await ctx.db.insert("hnStories", story);
      await syncNewsStoryUniversalSearchProjection(
        ctx,
        { ...story, _id: storyId },
        { snapshotIsComplete: true },
      );
    }
    const retainedIds = new Set(args.stories.map((story) => story.hnItemId));
    for (const hnItemId of new Set(current.map((story) => story.hnItemId))) {
      if (!retainedIds.has(hnItemId)) {
        await ctx.scheduler.runAfter(
          0,
          internal.news.reconcileStoryProjection,
          {
            hnItemId,
          },
        );
      }
    }
  },
});

// Read gates invalidate the snapshot immediately; physical reconciliation is
// paginated so a historical snapshot cannot create an unbounded transaction.
export const reconcileSnapshotProjections = internalMutation({
  args: { snapshotDate: v.string(), cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("hnStories")
      .withIndex("by_snapshotDate_and_rank", (q) =>
        q.eq("snapshotDate", args.snapshotDate),
      )
      .paginate({ cursor: args.cursor ?? null, numItems: 16 });
    for (const story of page.page) {
      await ctx.scheduler.runAfter(0, internal.news.reconcileStoryProjection, {
        hnItemId: story.hnItemId,
      });
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.news.reconcileSnapshotProjections,
        {
          snapshotDate: args.snapshotDate,
          cursor: page.continueCursor,
        },
      );
    }
    return null;
  },
});

// An item can occur in arbitrarily many historical daily snapshots. Reconcile
// in bounded transactions instead of scanning that history during refresh.
export const reconcileStoryProjection = internalMutation({
  args: {
    hnItemId: v.number(),
    cursor: v.optional(v.string()),
    newestStoryId: v.optional(v.id("hnStories")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const newest = await ctx.db
      .query("hnStories")
      .withIndex("by_hnItemId", (q) => q.eq("hnItemId", args.hnItemId))
      .order("desc")
      .first();
    // A concurrent refresh may insert a row before the continuation cursor.
    // Restart in that case rather than deleting its freshly published result.
    const cursor =
      newest?._id === args.newestStoryId ? (args.cursor ?? null) : null;
    const page = await ctx.db
      .query("hnStories")
      .withIndex("by_hnItemId", (q) => q.eq("hnItemId", args.hnItemId))
      .order("desc")
      .paginate({ cursor, numItems: 16 });
    for (const story of page.page) {
      const snapshot = await ctx.db
        .query("newsSnapshots")
        .withIndex("by_snapshotDate", (q) =>
          q.eq("snapshotDate", story.snapshotDate),
        )
        .first();
      if (snapshot?.status === "complete" && snapshot.storyCount > 0) {
        // Replace metadata from the removed snapshot with surviving public data.
        // The sync helper updates an existing row only when its values differ.
        // Deleting first would create an unnecessary delete+insert pair and
        // contend with concurrent snapshot refreshes for the same story.
        await syncNewsStoryUniversalSearchProjection(ctx, story);
        return null;
      }
    }
    if (page.isDone) {
      await deleteUniversalSearchProjection(
        ctx,
        "news_story",
        String(args.hnItemId),
      );
    } else {
      await ctx.scheduler.runAfter(0, internal.news.reconcileStoryProjection, {
        hnItemId: args.hnItemId,
        cursor: page.continueCursor,
        newestStoryId: newest?._id,
      });
    }
    return null;
  },
});
