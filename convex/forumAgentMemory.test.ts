/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";

import { internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

describe("forum agent memory backfill", () => {
  test("only exposes explicitly public category threads to shared editorial memory", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const authorId = await ctx.db.insert("users", {
        name: "Author",
        username: "memory-author",
        usernameNormalized: "memory-author",
      });
      const categories = await Promise.all(
        (["public", "members", "trusted", "staff"] as const).map(
          async (viewAccess, index) => {
            const categoryId = await ctx.db.insert("forumCategories", {
              slug: `${viewAccess}-memory`,
              name: `${viewAccess} memory`,
              description: "Memory visibility fixture",
              kind: "board",
              status: "active",
              viewAccess,
              position: index,
              threadCount: 1,
              postCount: 0,
              createdAt: 1,
              updatedAt: 1,
            });
            const threadId = await ctx.db.insert("forumThreads", {
              categoryId,
              categorySlug: `${viewAccess}-memory`,
              slug: `${viewAccess}-thread`,
              title: `${viewAccess} thread`,
              body: `${viewAccess} body`,
              authorId,
              status: "active",
              pinned: false,
              replyCount: 0,
              viewCount: 0,
              lastPostAt: index + 1,
              lastPostUserId: authorId,
              searchText: `${viewAccess} thread`,
              createdAt: 1,
              updatedAt: 1,
            });
            return { viewAccess, categoryId, threadId };
          },
        ),
      );
      const threadIds = {
        public: categories.find((category) => category.viewAccess === "public")!
          .threadId,
        members: categories.find(
          (category) => category.viewAccess === "members",
        )!.threadId,
        trusted: categories.find(
          (category) => category.viewAccess === "trusted",
        )!.threadId,
        staff: categories.find((category) => category.viewAccess === "staff")!
          .threadId,
      };
      const staffCategoryId = categories.find(
        (category) => category.viewAccess === "staff",
      )!.categoryId;
      const nestedCategoryId = await ctx.db.insert("forumCategories", {
        slug: "nested-public-memory",
        name: "Nested public memory",
        description: "Effectively private through its parent",
        kind: "board",
        parentCategoryId: staffCategoryId,
        status: "active",
        viewAccess: "public",
        position: 5,
        threadCount: 1,
        postCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      const nestedPublicThreadId = await ctx.db.insert("forumThreads", {
        categoryId: nestedCategoryId,
        categorySlug: "nested-public-memory",
        slug: "nested-public-thread",
        title: "nested public thread",
        body: "private through parent",
        authorId,
        status: "active",
        pinned: false,
        replyCount: 0,
        viewCount: 0,
        lastPostAt: 5,
        lastPostUserId: authorId,
        searchText: "nested public thread",
        createdAt: 1,
        updatedAt: 1,
      });
      return { ...threadIds, nestedPublicThreadId };
    });

    await expect(
      t.query(internal.forumAgentEditorialData.readThreadForMemory, {
        threadId: ids.public,
      }),
    ).resolves.toMatchObject({ title: "public thread" });
    for (const access of ["members", "trusted", "staff"] as const) {
      await expect(
        t.query(internal.forumAgentEditorialData.readThreadForMemory, {
          threadId: ids[access],
        }),
      ).resolves.toBeNull();
    }
    await expect(
      t.query(internal.forumAgentEditorialData.readThreadForMemory, {
        threadId: ids.nestedPublicThreadId,
      }),
    ).resolves.toBeNull();
    await expect(
      t.query(internal.forumAgentEditorialData.readForumThreadsForBackfill, {}),
    ).resolves.toMatchObject({ threadIds: [ids.public] });
  });

  test("does not re-index completed backfills invoked by the daily cron", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("forumAgentMaintenanceState", {
        key: "forum-agent-memory-backfill",
        completedAt: 1_800_000_000_000,
        updatedAt: 1_800_000_000_000,
      });
    });

    await expect(
      t.action(internal.forumAgentMemory.backfillForumMemory, {}),
    ).resolves.toEqual({ indexed: 0, done: true });
  });
});
