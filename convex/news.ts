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
  const entityId = String(hnItemId);
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
      q.eq("entityType", "hnStory").eq("entityId", entityId),
    )
    .take(1000);
  const interactions = await ctx.db
    .query("interactions")
    .withIndex("by_entityType_and_entityId", (q) =>
      q.eq("entityType", "hnStory").eq("entityId", entityId),
    )
    .take(1000);

  return {
    comments: comments.filter(
      (comment) => (comment.status ?? "active") === "active",
    ).length,
    score: interactions.reduce((total, row) => total + row.vote, 0),
    saves: interactions.filter((row) => row.saved).length,
  };
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
  const snapshots = await recentSnapshots(ctx);
  return (
    snapshots.find(
      (snapshot) => snapshot.status === "complete" && snapshot.storyCount > 0,
    ) ??
    snapshots[0] ??
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

export const getStory = query({
  args: {
    hnItemId: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("hnStories")
      .withIndex("by_hnItemId", (q) => q.eq("hnItemId", args.hnItemId))
      .take(50);
    if (rows.length === 0) {
      return null;
    }
    const story = rows.sort(
      (left, right) => right.fetchedAt - left.fetchedAt,
    )[0];
    return await withPlatformStats(ctx, story);
  },
});

export const refreshTopStories = internalAction({
  args: {
    limit: v.optional(v.number()),
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

    await ctx.db.patch(existingSnapshot._id, {
      status: "running",
      startedAt: args.startedAt,
      errorMessage: undefined,
    });
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

    await ctx.db.patch(existingSnapshot._id, {
      status: "failed",
      startedAt: args.startedAt,
      completedAt: Date.now(),
      errorMessage,
    });
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
      await ctx.db.patch(existingSnapshot._id, {
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
      await ctx.db.delete(story._id);
    }
    for (const story of args.stories) {
      await ctx.db.insert("hnStories", story);
    }
  },
});
