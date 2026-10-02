/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { selectCurrentPublicMemoryEntries } from "./forumAgentMemory";
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
      t.query(internal.forumAgentEditorialData.readThreadsForMemory, {
        threadIds: [
          ids.public,
          ids.members,
          ids.trusted,
          ids.staff,
          ids.nestedPublicThreadId,
        ],
      }),
    ).resolves.toEqual([
      expect.objectContaining({ title: "public thread" }),
      null,
      null,
      null,
      null,
    ]);
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

describe("forum agent memory retrieval", () => {
  test("validates candidates in bounded batches and stops after enough public threads", async () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      entryId: `entry-${index}`,
      metadata: { threadId: `thread-${index}` },
    }));
    const visibleThreadId = entries[8]!.metadata.threadId as Id<"forumThreads">;
    const readThreads = vi.fn(
      async (threadIds: readonly Id<"forumThreads">[]) =>
        threadIds.map((threadId) =>
          threadId === visibleThreadId
            ? {
                threadId,
                categorySlug: "public",
                agentSlug: "suki",
                title: "Current public thread",
                body: "Current public body",
              }
            : null,
        ),
    );

    await expect(
      selectCurrentPublicMemoryEntries(
        entries,
        new Map([[entries[8]!.entryId, 0.8]]),
        readThreads,
        1,
      ),
    ).resolves.toEqual([
      {
        threadId: visibleThreadId,
        categorySlug: "public",
        agentSlug: "suki",
        title: "Current public thread",
        text: "Current public body",
        score: 0.8,
      },
    ]);
    expect(readThreads).toHaveBeenCalledTimes(2);
    expect(
      readThreads.mock.calls.map(([threadIds]) => threadIds.length),
    ).toEqual([8, 4]);
  });

  test("fails closed when an already-indexed thread becomes private, inactive, or inherits a private ancestor", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const authorId = await ctx.db.insert("users", {
        name: "Author",
        username: "retrieval-author",
        usernameNormalized: "retrieval-author",
      });
      const parentCategoryId = await ctx.db.insert("forumCategories", {
        slug: "retrieval-parent",
        name: "Retrieval parent",
        description: "Public before moderation",
        kind: "board",
        status: "active",
        viewAccess: "public",
        position: 1,
        threadCount: 0,
        postCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      const categoryId = await ctx.db.insert("forumCategories", {
        slug: "retrieval-public",
        name: "Retrieval public",
        description: "Public before moderation",
        kind: "board",
        parentCategoryId,
        status: "active",
        viewAccess: "public",
        position: 2,
        threadCount: 1,
        postCount: 0,
        createdAt: 1,
        updatedAt: 1,
      });
      const threadId = await ctx.db.insert("forumThreads", {
        categoryId,
        categorySlug: "retrieval-public",
        slug: "retrieval-thread",
        title: "Indexed when public",
        body: "This must disappear if moderation changes visibility.",
        authorId,
        status: "active",
        pinned: false,
        replyCount: 0,
        viewCount: 0,
        lastPostAt: 1,
        lastPostUserId: authorId,
        searchText: "Indexed when public",
        createdAt: 1,
        updatedAt: 1,
      });
      return { parentCategoryId, categoryId, threadId };
    });
    const candidate = {
      entryId: "indexed-entry",
      title: "Stale embedding title",
      text: "Stale embedding body",
      metadata: { threadId: ids.threadId },
    };
    const resolveCurrentThreads = async (
      threadIds: readonly Id<"forumThreads">[],
    ) =>
      await Promise.all(
        threadIds.map(
          async (threadId) =>
            await t.query(
              internal.forumAgentEditorialData.readThreadForMemory,
              {
                threadId,
              },
            ),
        ),
      );
    const searchCurrent = async () =>
      await selectCurrentPublicMemoryEntries(
        [candidate],
        new Map([[candidate.entryId, 0.9]]),
        resolveCurrentThreads,
      );

    await expect(searchCurrent()).resolves.toMatchObject([
      {
        threadId: ids.threadId,
        title: "Indexed when public",
        text: "This must disappear if moderation changes visibility.",
      },
    ]);

    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", ids.categoryId, {
        viewAccess: "members",
      });
    });
    await expect(searchCurrent()).resolves.toEqual([]);

    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", ids.categoryId, {
        viewAccess: "public",
      });
      await ctx.db.patch("forumThreads", ids.threadId, { status: "hidden" });
    });
    await expect(searchCurrent()).resolves.toEqual([]);

    await t.run(async (ctx) => {
      await ctx.db.patch("forumThreads", ids.threadId, { status: "active" });
      await ctx.db.patch("forumCategories", ids.parentCategoryId, {
        viewAccess: "staff",
      });
    });
    await expect(searchCurrent()).resolves.toEqual([]);
  });
});
