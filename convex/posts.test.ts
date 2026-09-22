/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const posts = {
  listPublishedSummaries: makeFunctionReference<"query", any, any>(
    "posts:listPublishedSummaries",
  ),
  featured: makeFunctionReference<"query", any, any>("posts:featured"),
} as const;
const backfillPostDigests = makeFunctionReference<"mutation", any, any>(
  "postDigests:backfillPostDigests",
);

describe("published post summaries", () => {
  test("returns public listing metadata without article bodies", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("posts", {
        slug: "published",
        title: "Published post",
        excerpt: "A compact archive entry.",
        body: "This full article must stay on the detail path.",
        tags: ["research"],
        status: "published",
        publishedAt: 2,
        readingMinutes: 3,
        featured: false,
      });
      await ctx.db.insert("posts", {
        slug: "draft",
        title: "Draft post",
        excerpt: "Not public.",
        body: "Private draft body.",
        tags: [],
        status: "draft",
        publishedAt: 3,
        readingMinutes: 1,
        featured: false,
      });
    });

    await expect(t.query(posts.listPublishedSummaries, {})).resolves.toEqual([
      expect.objectContaining({ slug: "published", title: "Published post" }),
    ]);
    const [summary] = await t.query(posts.listPublishedSummaries, {});
    expect(summary).not.toHaveProperty("body");
  });

  test("switches to compact digests after the resumable backfill", async () => {
    const t = convexTest(schema, modules);
    const postId = await t.run(
      async (ctx) =>
        await ctx.db.insert("posts", {
          slug: "projected",
          title: "Projected post",
          excerpt: "A compact projection.",
          body: "x".repeat(100_000),
          tags: ["data"],
          status: "published",
          publishedAt: 10,
          readingMinutes: 4,
          featured: true,
        }),
    );

    await expect(
      t.mutation(backfillPostDigests, { limit: 100 }),
    ).resolves.toMatchObject({ processed: 1, done: true });
    const [summary] = await t.query(posts.listPublishedSummaries, {});
    expect(summary).toEqual(
      expect.objectContaining({
        _id: postId,
        slug: "projected",
        title: "Projected post",
        featured: true,
      }),
    );
    expect(summary).not.toHaveProperty("body");
    await expect(
      t.run(
        async (ctx) =>
          await ctx.db
            .query("postDigests")
            .withIndex("by_postId", (q) => q.eq("postId", postId))
            .unique(),
      ),
    ).resolves.toMatchObject({ postId, excerpt: "A compact projection." });
  });

  test("preserves the featured lookup boundary after projection", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("posts", {
        slug: "older-featured",
        title: "Older featured",
        excerpt: "Outside the current archive window.",
        body: "Older body",
        tags: [],
        status: "published",
        publishedAt: 1,
        readingMinutes: 1,
        featured: true,
      });
      for (let index = 0; index < 50; index += 1) {
        await ctx.db.insert("posts", {
          slug: `newer-${index}`,
          title: `Newer ${index}`,
          excerpt: "Inside the current archive window.",
          body: "Newer body",
          tags: [],
          status: "published",
          publishedAt: index + 2,
          readingMinutes: 1,
          featured: false,
        });
      }
    });
    await t.mutation(backfillPostDigests, { limit: 100 });

    await expect(t.query(posts.featured, {})).resolves.toBeNull();
  });

  test("persisted digest progress wins over a stale continuation cursor", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < 3; index += 1) {
        await ctx.db.insert("posts", {
          slug: `cursor-${index}`,
          title: `Cursor ${index}`,
          excerpt: "Cursor safety.",
          body: "Body",
          tags: [],
          status: "published",
          publishedAt: index,
          readingMinutes: 1,
          featured: false,
        });
      }
    });
    const first = await t.mutation(backfillPostDigests, { limit: 1 });
    const second = await t.mutation(backfillPostDigests, {
      cursor: first.cursor ?? undefined,
      limit: 1,
    });
    expect(second).toMatchObject({ processed: 1, done: false });
    await expect(
      t.mutation(backfillPostDigests, {
        cursor: first.cursor ?? undefined,
        limit: 1,
      }),
    ).resolves.toMatchObject({ processed: 1, done: true });
    await expect(
      t.run(async (ctx) => await ctx.db.query("postDigests").take(10)),
    ).resolves.toHaveLength(3);
  });
});
