/// <reference types="vite/client" />

import aggregateTest from "@convex-dev/aggregate/test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import { contentSummaries, interactionSaveCounts } from "./contentAggregates";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

function setup() {
  const t = convexTest(schema, modules);
  aggregateTest.register(t, "interactionScores");
  aggregateTest.register(t, "interactionSaves");
  aggregateTest.register(t, "commentCounts");
  registerRateLimiter(t);
  return t;
}

describe("content aggregates", () => {
  test("uses the save aggregate after backfill and preserves the bounded fallback", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Reader",
        username: "reader",
        usernameNormalized: "reader",
        role: "reader",
      });
      for (const [entityId, saved] of [
        ["123", true],
        ["123", false],
        ["456", true],
      ] as const) {
        await ctx.db.insert("interactions", {
          userId,
          entityType: "hnStory",
          entityId,
          vote: 0,
          saved,
          updatedAt: 1,
        });
      }
      await ctx.db.insert("comments", {
        userId,
        entityType: "hnStory",
        entityId: "123",
        body: "An active comment",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
    });

    const expected = [
      ["123", 1],
      ["456", 1],
      ["789", 0],
    ];
    const expectedSummaries = [
      ["123", { score: 0, saves: 1, comments: 1 }],
      ["456", { score: 0, saves: 1, comments: 0 }],
      ["789", { score: 0, saves: 0, comments: 0 }],
    ];
    await expect(
      t.run(async (ctx) =>
        Array.from(
          await contentSummaries(ctx, "hnStory", ["123", "456", "789", "123"]),
        ),
      ),
    ).resolves.toEqual(expectedSummaries);
    await expect(
      t.run(async (ctx) =>
        Array.from(
          await interactionSaveCounts(ctx, "hnStory", [
            "123",
            "456",
            "789",
            "123",
          ]),
        ),
      ),
    ).resolves.toEqual(expected);

    await t.mutation(internal.contentAggregates.backfillContentAggregates, {
      phase: "interactions",
    });
    await t.mutation(internal.contentAggregates.backfillContentAggregates, {
      phase: "comments",
    });
    await expect(
      t.run(async (ctx) =>
        Array.from(
          await interactionSaveCounts(ctx, "hnStory", [
            "123",
            "456",
            "789",
            "123",
          ]),
        ),
      ),
    ).resolves.toEqual(expected);
    await expect(
      t.run(async (ctx) =>
        Array.from(
          await contentSummaries(ctx, "hnStory", ["123", "456", "789", "123"]),
        ),
      ),
    ).resolves.toEqual(expectedSummaries);
  });

  test("checkpoints and schedules the next phase without replaying a cursor", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Reader",
        username: "reader",
        usernameNormalized: "reader",
        role: "reader",
        emailVerificationTime: 1_800_000_000_000,
      });
      for (let index = 0; index < 2; index += 1) {
        await ctx.db.insert("interactions", {
          userId,
          entityType: "post",
          entityId: `aggregate-${index}`,
          vote: 1,
          saved: false,
          updatedAt: index,
        });
      }
    });

    await expect(
      t.mutation(internal.contentAggregates.backfillContentAggregates, {
        phase: "interactions",
        limit: 1,
      }),
    ).resolves.toMatchObject({ phase: "interactions", done: false });
    await t.run(async (ctx) => {
      const state = await ctx.db
        .query("optimizationMigrations")
        .withIndex("by_key", (q) => q.eq("key", "interaction-aggregates-v1"))
        .unique();
      expect(state).toMatchObject({ status: "running", processed: 1 });
      expect(state?.cursor).toEqual(expect.any(String));
      expect(
        await ctx.db.system.query("_scheduled_functions").collect(),
      ).toHaveLength(1);
    });

    await expect(
      t.mutation(internal.contentAggregates.backfillContentAggregates, {
        phase: "interactions",
        limit: 1,
      }),
    ).resolves.toMatchObject({ phase: "interactions", done: true });
    await t.run(async (ctx) => {
      const state = await ctx.db
        .query("optimizationMigrations")
        .withIndex("by_key", (q) => q.eq("key", "interaction-aggregates-v1"))
        .unique();
      expect(state).toMatchObject({ status: "completed", processed: 2 });
      const jobs = await ctx.db.system.query("_scheduled_functions").collect();
      expect(
        jobs.filter(
          (job) => job.name === "contentAggregates:backfillContentAggregates",
        ),
      ).toHaveLength(2);
    });
  });

  test("backfills without a partial-count window and stays write-through", async () => {
    const t = setup();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Reader",
        username: "reader",
        usernameNormalized: "reader",
        role: "reader",
        emailVerificationTime: 1_800_000_000_000,
      });
      await ctx.db.insert("posts", {
        slug: "aggregate-test",
        title: "Aggregate test",
        excerpt: "A public post",
        body: "Body",
        tags: [],
        status: "published",
        publishedAt: 1,
        readingMinutes: 1,
        featured: false,
      });
      await ctx.db.insert("interactions", {
        userId,
        entityType: "post",
        entityId: "aggregate-test",
        vote: 1,
        saved: true,
        updatedAt: 1,
      });
      const commentId = await ctx.db.insert("comments", {
        userId,
        entityType: "post",
        entityId: "aggregate-test",
        body: "Useful comment",
        status: "active",
        createdAt: 1,
        updatedAt: 1,
      });
      return { userId, commentId };
    });

    expect(
      await t.query(api.interactions.summary, {
        entityType: "post",
        entityId: "aggregate-test",
      }),
    ).toMatchObject({ comments: 1, saves: 1, score: 1 });

    await t.mutation(internal.contentAggregates.backfillContentAggregates, {
      phase: "interactions",
    });
    await t.mutation(internal.contentAggregates.backfillContentAggregates, {
      phase: "comments",
    });

    const asReader = t.withIdentity({ subject: seeded.userId });
    await asReader.mutation(api.interactions.set, {
      entityType: "post",
      entityId: "aggregate-test",
      vote: -1,
      saved: false,
    });
    await asReader.mutation(api.comments.softDelete, {
      commentId: seeded.commentId,
    });

    expect(
      await asReader.query(api.interactions.summary, {
        entityType: "post",
        entityId: "aggregate-test",
      }),
    ).toMatchObject({ comments: 0, saves: 0, score: -1 });
    await expect(
      asReader.query(api.interactions.summaries, {
        entityType: "post",
        entityIds: ["aggregate-test", "aggregate-test"],
      }),
    ).resolves.toMatchObject({
      "aggregate-test": {
        comments: 0,
        saves: 0,
        score: -1,
        viewer: { vote: -1, saved: false },
      },
    });
  });
});
