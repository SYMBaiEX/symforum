/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const backfillRef = makeFunctionReference<"mutation", Record<string, never>>(
  "universalSearchProjection:backfill",
);

function setup() {
  return convexTest(schema, modules);
}

afterEach(() => vi.useRealTimers());

describe("news search projection refresh", () => {
  test("hides a removed story before cleanup while its snapshot remains complete", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.mutation(internal.news.storeSnapshot, {
      snapshotDate: "2026-09-22",
      startedAt: 1,
      stories: [
        {
          hnItemId: 42,
          snapshotDate: "2026-09-22",
          rank: 1,
          title: "Removed signal",
          fetchedAt: 2,
        },
      ],
    });
    await t.mutation(backfillRef, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.query(internal.universalSearch.searchPublic, {
        query: "Removed",
      }),
    ).toHaveLength(1);
    await t.mutation(internal.news.storeSnapshot, {
      snapshotDate: "2026-09-22",
      startedAt: 3,
      stories: [
        {
          hnItemId: 43,
          snapshotDate: "2026-09-22",
          rank: 1,
          title: "Replacement signal",
          fetchedAt: 4,
        },
      ],
    });
    expect(
      await t.query(internal.universalSearch.searchPublic, {
        query: "Removed",
      }),
    ).toEqual([]);
    expect(
      await t.query(internal.universalSearch.searchPublic, {
        query: "Replacement",
      }),
    ).toHaveLength(1);
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
  });
  test.each(["running", "failed"] as const)(
    "immediately hides a complete snapshot changed to %s and drains cleanup",
    async (status) => {
      vi.useFakeTimers();
      const t = setup();
      await t.mutation(internal.news.storeSnapshot, {
        snapshotDate: "2026-09-22",
        startedAt: 1,
        stories: Array.from({ length: 20 }, (_, index) => ({
          hnItemId: index + 1,
          snapshotDate: "2026-09-22",
          rank: index + 1,
          title: `Visibility signal ${index}`,
          fetchedAt: 2,
        })),
      });
      await t.mutation(backfillRef, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      if (status === "running") {
        await t.mutation(internal.news.markSnapshotStarted, {
          snapshotDate: "2026-09-22",
          startedAt: 3,
        });
      } else {
        await t.mutation(internal.news.markSnapshotFailed, {
          snapshotDate: "2026-09-22",
          startedAt: 3,
          errorMessage: "failed",
        });
      }
      const result = await t.query(internal.universalSearch.searchPublic, {
        query: "Visibility",
        limit: 10,
      });
      expect(result).toEqual([]);
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(
        await t.run((ctx) =>
          ctx.db.query("universalSearchProjections").collect(),
        ),
      ).toEqual([]);
    },
  );

  test("backfill ignores stories from noncomplete snapshots", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.run(async (ctx) => {
      for (const status of ["running", "failed"] as const) {
        await ctx.db.insert("newsSnapshots", {
          snapshotDate: status,
          status,
          startedAt: 1,
          storyCount: 1,
        });
        await ctx.db.insert("hnStories", {
          snapshotDate: status,
          hnItemId: status === "running" ? 1 : 2,
          rank: 1,
          title: "Hidden signal",
          fetchedAt: 2,
        });
      }
    });
    await t.mutation(backfillRef, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.run((ctx) =>
        ctx.db.query("universalSearchProjections").collect(),
      ),
    ).toEqual([]);
  });

  test("snapshot invalidation restores a surviving completed version", async () => {
    vi.useFakeTimers();
    const t = setup();
    for (const [snapshotDate, fetchedAt, title] of [
      ["2026-09-21", 2, "Surviving signal"],
      ["2026-09-22", 4, "Invalidated signal"],
    ] as const) {
      await t.mutation(internal.news.storeSnapshot, {
        snapshotDate,
        startedAt: fetchedAt - 1,
        stories: [{ hnItemId: 42, snapshotDate, rank: 1, title, fetchedAt }],
      });
    }
    await t.mutation(internal.news.markSnapshotStarted, {
      snapshotDate: "2026-09-22",
      startedAt: 5,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.run((ctx) =>
        ctx.db.query("universalSearchProjections").collect(),
      ),
    ).toMatchObject([
      { title: "Surviving signal", newsSnapshotDate: "2026-09-21" },
    ]);
  });

  test("removes a dropped item when no public snapshot still contains it", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.mutation(internal.news.storeSnapshot, {
      snapshotDate: "2026-09-22",
      startedAt: 1,
      stories: [
        {
          hnItemId: 42,
          snapshotDate: "2026-09-22",
          rank: 1,
          title: "Removed signal",
          fetchedAt: 2,
        },
      ],
    });
    // Failed snapshots are not public evidence, including beyond the first page.
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) {
        const snapshotDate = `failed-${i}`;
        await ctx.db.insert("newsSnapshots", {
          snapshotDate,
          status: "failed",
          startedAt: 1,
          storyCount: 1,
        });
        await ctx.db.insert("hnStories", {
          hnItemId: 42,
          snapshotDate,
          rank: 1,
          title: "Failed signal",
          fetchedAt: 1,
        });
      }
    });
    await t.mutation(internal.news.storeSnapshot, {
      snapshotDate: "2026-09-22",
      startedAt: 3,
      stories: [],
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(
      await t.run((ctx) =>
        ctx.db.query("universalSearchProjections").collect(),
      ),
    ).toEqual([]);
  });

  test("retains and refreshes an item from another complete snapshot", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.mutation(internal.news.storeSnapshot, {
      snapshotDate: "2026-09-21",
      startedAt: 1,
      stories: [
        {
          hnItemId: 42,
          snapshotDate: "2026-09-21",
          rank: 1,
          title: "Surviving signal",
          fetchedAt: 2,
        },
      ],
    });
    await t.mutation(internal.news.storeSnapshot, {
      snapshotDate: "2026-09-22",
      startedAt: 3,
      stories: [
        {
          hnItemId: 42,
          snapshotDate: "2026-09-22",
          rank: 1,
          title: "Removed version",
          fetchedAt: 4,
        },
      ],
    });
    await t.mutation(internal.news.storeSnapshot, {
      snapshotDate: "2026-09-22",
      startedAt: 5,
      stories: [],
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const rows = await t.run((ctx) =>
      ctx.db.query("universalSearchProjections").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "news_story",
      title: "Surviving signal",
    });
  });

  test("a continuation preserves a newly completed snapshot inserted before its cursor", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 20; i++) {
        const snapshotDate = `failed-${i}`;
        await ctx.db.insert("newsSnapshots", {
          snapshotDate,
          status: "failed",
          startedAt: 1,
          storyCount: 1,
        });
        await ctx.db.insert("hnStories", {
          hnItemId: 42,
          snapshotDate,
          rank: 1,
          title: "Failed signal",
          fetchedAt: 1,
        });
      }
    });
    await t.mutation(internal.news.reconcileStoryProjection, { hnItemId: 42 });
    await t.mutation(internal.news.storeSnapshot, {
      snapshotDate: "2026-09-22",
      startedAt: 3,
      stories: [
        {
          hnItemId: 42,
          snapshotDate: "2026-09-22",
          rank: 1,
          title: "Newly published signal",
          fetchedAt: 4,
        },
      ],
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const rows = await t.run((ctx) =>
      ctx.db.query("universalSearchProjections").collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Newly published signal");
  });
});

describe("latest news snapshot selection", () => {
  test("returns the newest populated completed snapshot", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: "2026-09-21",
        status: "complete",
        startedAt: 1,
        completedAt: 2,
        storyCount: 1,
      });
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: "2026-09-22",
        status: "complete",
        startedAt: 3,
        completedAt: 4,
        storyCount: 1,
      });
      await ctx.db.insert("hnStories", {
        hnItemId: 42,
        snapshotDate: "2026-09-22",
        rank: 1,
        title: "Current signal",
        fetchedAt: 4,
      });
    });

    const result = await t.query(api.news.latest, {});
    expect(result.snapshot?.snapshotDate).toBe("2026-09-22");
    expect(result.stories.map((story) => story.hnItemId)).toEqual([42]);
  });

  test("falls back to the last populated snapshot during a failed refresh", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: "2026-09-21",
        status: "complete",
        startedAt: 1,
        completedAt: 2,
        storyCount: 1,
      });
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: "2026-09-22",
        status: "failed",
        startedAt: 3,
        completedAt: 4,
        storyCount: 0,
        errorMessage: "upstream unavailable",
      });
      await ctx.db.insert("hnStories", {
        hnItemId: 41,
        snapshotDate: "2026-09-21",
        rank: 1,
        title: "Last known good signal",
        fetchedAt: 2,
      });
    });

    const result = await t.query(api.news.latest, {});
    expect(result.snapshot?.snapshotDate).toBe("2026-09-21");
    expect(result.stories.map((story) => story.hnItemId)).toEqual([41]);
  });
});
