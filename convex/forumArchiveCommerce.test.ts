/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import {
  publicCommerceThread,
  promotableCommerceThread,
} from "./forumCommerceAccess";
const modules = import.meta.glob("./**/*.ts");

test("archive permits historical token reads but never sells new promotion inventory", async () => {
  const t = convexTest(schema, modules);
  const threadId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { name: "Fixture" });
    const fields = {
      status: "active" as const,
      viewAccess: "public" as const,
      description: "Fixture",
      position: 1,
      threadCount: 0,
      postCount: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const parentCategoryId = await ctx.db.insert("forumCategories", {
      ...fields,
      slug: "archive",
      name: "Archive",
      kind: "section",
      readOnlyArchive: true,
    });
    const categoryId = await ctx.db.insert("forumCategories", {
      ...fields,
      slug: "research",
      name: "Research",
      kind: "board",
      parentCategoryId,
    });
    return ctx.db.insert("forumThreads", {
      categoryId,
      categorySlug: "research",
      slug: "fixture",
      title: "Fixture",
      body: "Fixture",
      authorId: userId,
      status: "active",
      pinned: false,
      replyCount: 0,
      viewCount: 0,
      lastPostAt: 1,
      lastPostUserId: userId,
      searchText: "fixture",
      createdAt: 1,
      updatedAt: 1,
    });
  });
  expect(
    await t.run((ctx) => publicCommerceThread(ctx, threadId)),
  ).not.toBeNull();
  expect(
    await t.run((ctx) => promotableCommerceThread(ctx, threadId)),
  ).toBeNull();
});
