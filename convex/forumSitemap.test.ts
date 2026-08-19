/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

type SitemapCategory = { slug: string };

describe("forum sitemap records", () => {
  test("returns compact public records and excludes private boards", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const authorId = await ctx.db.insert("users", {
        name: "Author",
        username: "author",
        usernameNormalized: "author",
      });
      const publicCategoryId = await ctx.db.insert("forumCategories", {
        slug: "public-board",
        name: "Public board",
        description: "Public",
        kind: "board",
        status: "active",
        viewAccess: "public",
        position: 1,
        threadCount: 1,
        postCount: 1,
        createdAt: 1,
        updatedAt: 10,
      });
      const privateCategoryId = await ctx.db.insert("forumCategories", {
        slug: "staff-board",
        name: "Staff board",
        description: "Private",
        kind: "board",
        status: "active",
        viewAccess: "staff",
        position: 2,
        threadCount: 1,
        postCount: 1,
        createdAt: 1,
        updatedAt: 10,
      });
      await ctx.db.insert("forumCategories", {
        slug: "public-child-of-staff",
        name: "Nested private board",
        description: "Directly public but hidden by its parent",
        kind: "board",
        parentCategoryId: privateCategoryId,
        status: "active",
        viewAccess: "public",
        position: 3,
        threadCount: 0,
        postCount: 0,
        createdAt: 1,
        updatedAt: 10,
      });
      for (const [categoryId, categorySlug, slug] of [
        [publicCategoryId, "public-board", "public-thread"],
        [privateCategoryId, "staff-board", "private-thread"],
      ] as const) {
        const threadId = await ctx.db.insert("forumThreads", {
          categoryId,
          categorySlug,
          slug,
          title: slug,
          body: "Full body must not be returned",
          authorId,
          status: "active",
          pinned: false,
          replyCount: 0,
          viewCount: 0,
          lastPostAt: 10,
          lastPostUserId: authorId,
          searchText: slug,
          createdAt: 1,
          updatedAt: 10,
        });
        await ctx.db.insert("forumThreadEditorialDigests", {
          threadId,
          categoryId,
          categorySlug,
          slug,
          title: slug,
          authorId,
          status: "active",
          replyCount: 0,
          viewCount: 0,
          lastPostAt: 10,
          createdAt: 1,
          updatedAt: 10,
        });
      }
    });

    const result = await t.query(api.forum.listPublicSitemapRecords, {
      month: "2026-08",
      limit: 100,
    });
    expect(result.categories.map((row: SitemapCategory) => row.slug)).toEqual(["public-board"]);
    expect(result.threads).toEqual([
      {
        categorySlug: "public-board",
        slug: "public-thread",
        lastModified: 10,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("Full body");
    expect(JSON.stringify(result)).not.toContain("private-thread");
  });
});
