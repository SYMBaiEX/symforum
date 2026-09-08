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
} as const;

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
});
