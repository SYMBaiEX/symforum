/// <reference types="vite/client" />

import aggregateTest from "@convex-dev/aggregate/test";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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
  return t;
}

describe("content aggregates", () => {
  test("backfills without a partial-count window and stays write-through", async () => {
    const t = setup();
    const seeded = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        name: "Reader",
        username: "reader",
        usernameNormalized: "reader",
        role: "reader",
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
  });
});
