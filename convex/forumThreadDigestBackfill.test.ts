/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};

test("backfill creates compact thread digests and does not rescan after completion", async () => {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const authorId = await ctx.db.insert("users", {
      name: "Forum Author",
      username: "forum-author",
      usernameNormalized: "forum-author",
    });
    const categoryId = await ctx.db.insert("forumCategories", {
      slug: "research",
      name: "Research",
      description: "Research discussions",
      kind: "board",
      status: "active",
      viewAccess: "public",
      threadAccess: "trusted",
      position: 1,
      threadCount: 1,
      postCount: 1,
      createdAt: 100,
      updatedAt: 100,
    });
    const threadId = await ctx.db.insert("forumThreads", {
      categoryId,
      categorySlug: "research",
      slug: "compact-digest-test",
      title: "Compact digest test",
      body: "Large canonical thread body is not copied into the digest.",
      authorId,
      status: "active",
      pinned: false,
      replyCount: 1,
      viewCount: 0,
      lastPostAt: 100,
      lastPostUserId: authorId,
      searchText: "Compact digest test Large canonical thread body",
      createdAt: 100,
      updatedAt: 100,
    });
    return { authorId, categoryId, threadId };
  });

  await expect(
    t.query(internal.forumThreadDigestBackfill.status, {}),
  ).resolves.toEqual({ complete: false, completedAt: null });
  await expect(
    t.mutation(internal.forumThreadDigestBackfill.run, {}),
  ).resolves.toMatchObject({ processed: 1, done: true });
  await expect(
    t.query(internal.forumThreadDigestBackfill.status, {}),
  ).resolves.toMatchObject({ complete: true });

  const digest = await t.run((ctx) =>
    ctx.db
      .query("forumThreadEditorialDigests")
      .withIndex("by_threadId", (q) => q.eq("threadId", ids.threadId))
      .unique(),
  );
  expect(digest).toMatchObject({
    threadId: ids.threadId,
    categoryId: ids.categoryId,
    authorId: ids.authorId,
    title: "Compact digest test",
    status: "active",
  });
  expect(digest).not.toHaveProperty("body");
  expect(digest).not.toHaveProperty("searchText");

  await expect(
    t.mutation(internal.forumThreadDigestBackfill.run, {}),
  ).resolves.toEqual({ processed: 0, done: true });
  await expect(
    t.run((ctx) => ctx.db.query("forumThreadEditorialDigests").collect()),
  ).resolves.toHaveLength(1);
});
