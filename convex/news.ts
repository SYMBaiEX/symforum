import { v } from "convex/values";
import { action, internalMutation, query } from "./_generated/server";
import { makeFunctionReference } from "convex/server";

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

function snapshotDate(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function hostname(url: string | undefined) {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export const latest = query({
  args: {},
  handler: async (ctx) => {
    const snapshots = await ctx.db
      .query("newsSnapshots")
      .withIndex("by_snapshotDate")
      .order("desc")
      .take(1);
    const snapshot = snapshots[0] ?? null;
    if (snapshot === null) {
      return { snapshot: null, stories: [] };
    }
    const stories = await ctx.db
      .query("hnStories")
      .withIndex("by_snapshotDate_and_rank", (q) =>
        q.eq("snapshotDate", snapshot.snapshotDate),
      )
      .order("asc")
      .take(30);
    return { snapshot, stories };
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
      .collect();
    if (rows.length === 0) {
      return null;
    }
    return rows.sort((left, right) => right.fetchedAt - left.fetchedAt)[0];
  },
});

export const refreshTopStories = action({
  args: {},
  handler: async (ctx) => {
    const date = snapshotDate();
    const startedAt = Date.now();
    const topResponse = await fetch(HN_TOP_STORIES_URL);
    if (!topResponse.ok) {
      throw new Error(`HN topstories failed: ${topResponse.status}`);
    }
    const ids = (await topResponse.json()) as number[];
    const topIds = ids.slice(0, 30);
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
        return {
          hnItemId: item.id,
          snapshotDate: date,
          rank: index + 1,
          title: item.title,
          url: item.url,
          host: hostname(item.url),
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
    const existingSnapshot = await ctx.db
      .query("newsSnapshots")
      .withIndex("by_snapshotDate", (q) =>
        q.eq("snapshotDate", args.snapshotDate),
      )
      .unique();

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
