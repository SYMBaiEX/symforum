/// <reference types="vite/client" />
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { forumOperations } from "./forum";
import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const setup = () => {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  aggregateTest.register(t, "interactionScores");
  aggregateTest.register(t, "interactionSaves");
  aggregateTest.register(t, "commentCounts");
  return t;
};
type Backend = ReturnType<typeof setup>;
type SeedContext = Parameters<Parameters<Backend["run"]>[0]>[0];
async function board(
  ctx: SeedContext,
  slug: string,
  overrides: {
    parentCategoryId?: Id<"forumCategories">;
    viewAccess?: "public" | "trusted";
    status?: "active" | "archived";
  } = {},
) {
  return ctx.db.insert("forumCategories", {
    slug,
    name: slug,
    description: "",
    kind: "board",
    status: "active",
    viewAccess: "public",
    threadAccess: "members",
    replyAccess: "members",
    pollAccess: "members",
    position: 0,
    threadCount: 0,
    postCount: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  });
}
async function thread(
  ctx: SeedContext,
  categoryId: Id<"forumCategories">,
  authorId: Id<"users">,
  n: number,
  overrides: {
    status?: "active" | "locked" | "pending" | "hidden" | "deleted";
    body?: string;
    searchText?: string;
    categorySlug?: string;
    lastPostAt?: number;
  } = {},
) {
  return ctx.db.insert("forumThreads", {
    categoryId,
    categorySlug: "general",
    slug: `thread-${n}`,
    title: `Thread ${n}`,
    body: "[b]Real[/b] preview &amp; discussion",
    authorId,
    status: "active",
    pinned: false,
    replyCount: 0,
    viewCount: 0,
    lastPostAt: n,
    lastPostUserId: authorId,
    searchText: "",
    createdAt: n,
    updatedAt: n,
    ...overrides,
  });
}
async function fixture(t: Backend) {
  return t.run(async (ctx) => {
    const author = await ctx.db.insert("users", {
      username: "reader",
      usernameNormalized: "reader",
      name: "Reader",
      forumTrustedAt: 1,
    });
    const category = await board(ctx, "general");
    await ctx.db.insert("forumUserProfiles", {
      userId: author,
      avatarUrl: "https://example.com/reader.png",
      threadCount: 0,
      postCount: 0,
      showSignatures: true,
      createdAt: 1,
      updatedAt: 1,
    });
    return { author, category };
  });
}
const page = { numItems: 12, cursor: null };

describe("global forum feed", () => {
  test("migrates previews without body reads, preserves old cursors, and automatically updates edited/deleted threads", async () => {
    const t = setup();
    const seed = await fixture(t);
    const ids = await t.run(async (ctx) => {
      const one = await thread(ctx, seed.category, seed.author, 1, {
        body: "Preview one. " + "界".repeat(63_900),
      });
      const two = await thread(ctx, seed.category, seed.author, 2, {
        lastPostAt: 1,
        body: "Escaped &lt;script&gt; is literal text.",
      });
      const parent = await board(ctx, "private-parent", {
        viewAccess: "trusted",
      });
      const child = await board(ctx, "public-child", {
        parentCategoryId: parent,
      });
      const hidden = await thread(ctx, child, seed.author, 3, {
        body: "DO NOT EXPOSE PRIVATE BODY",
      });
      return { one, two, hidden };
    });
    const first = await t.query(api.forum.listFeedThreads, {
      sort: "new",
      paginationOpts: { numItems: 1, cursor: null },
    });
    const activeBefore = await t.query(api.forum.listFeedThreads, {
      paginationOpts: page,
    });
    await t.mutation(internal.forumThreadDigestBackfill.run, {
      feed: true,
      dryRun: true,
    });
    expect(
      await t.query(internal.forumThreadDigestBackfill.status, { feed: true }),
    ).toMatchObject({ complete: false });
    expect(
      await t.run((ctx) =>
        ctx.db.query("forumThreadEditorialDigests").collect(),
      ),
    ).toEqual([]);
    vi.useFakeTimers();
    try {
      await t.mutation(internal.forumThreadDigestBackfill.run, { feed: true });
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
    expect(
      await t.query(internal.forumThreadDigestBackfill.status, { feed: true }),
    ).toMatchObject({ complete: true });
    const activeAfter = await t.query(api.forum.listFeedThreads, {
      paginationOpts: page,
    });
    expect(activeAfter.page.map((row) => row._id)).toEqual(
      activeBefore.page.map((row) => row._id),
    );
    const measured = await t.run(async (ctx) => {
      const canonical = new Set(Object.values(ids));
      const db = new Proxy(ctx.db, {
        get(target, property, receiver) {
          if (property === "get")
            return (...args: unknown[]) => {
              if (args.some((arg) => canonical.has(arg as Id<"forumThreads">)))
                throw new Error("Feed read a full body");
              return Reflect.apply(target.get, target, args);
            };
          if (property === "query")
            return (table: Parameters<typeof ctx.db.query>[0]) => {
              if (table === "forumThreads")
                throw new Error("Feed scanned full bodies");
              return target.query(table);
            };
          return Reflect.get(target, property, receiver);
        },
      });
      return forumOperations.listFeedThreads.definition.handler(
        { ...ctx, db } as unknown as QueryCtx,
        { sort: "new", paginationOpts: page },
      );
    });
    expect(measured.page.map((row) => row._id)).toEqual([ids.two, ids.one]);
    expect(measured.page[1].excerpt).toHaveLength(280);
    expect(measured.page[0].excerpt).toBe("Escaped <script> is literal text.");
    expect(JSON.stringify(measured)).not.toContain("PRIVATE BODY");
    expect(measured.continueCursor).toContain('"source":"digest"');
    const legacy = await t.query(api.forum.listFeedThreads, {
      sort: "new",
      paginationOpts: { numItems: 1, cursor: first.continueCursor },
    });
    expect(legacy.page.map((row) => row._id)).toEqual([ids.two]);
    expect(legacy.continueCursor).toContain('"source":"canonical"');
    const signed = t.withIdentity({ subject: seed.author });
    await signed.mutation(api.forum.updateThreadContent, {
      threadId: ids.one,
      title: "An edited title",
      body: "An edited preview without the old body.",
    });
    const updated = await t.query(api.forum.listFeedThreads, {
      paginationOpts: page,
    });
    expect(updated.page.find((row) => row._id === ids.one)).toMatchObject({
      title: "An edited title",
      excerpt: "An edited preview without the old body.",
    });
    await signed.mutation(api.forum.deleteThread, { threadId: ids.one });
    expect(
      (
        await t.query(api.forum.listFeedThreads, { paginationOpts: page })
      ).page.map((row) => row._id),
    ).toEqual([ids.two]);
  });

  test("feed previews hydrate only active root attachments on currently visible discussions", async () => {
    const t = setup();
    const seed = await fixture(t);
    const ids = await t.run(async (ctx) => {
      const visible = await thread(ctx, seed.category, seed.author, 1);
      const hidden = await thread(ctx, seed.category, seed.author, 2, {
        status: "hidden",
      });
      const privateBoard = await board(ctx, "private", {
        viewAccess: "trusted",
      });
      const restricted = await thread(ctx, privateBoard, seed.author, 3);
      const reply = await ctx.db.insert("forumPosts", {
        threadId: visible,
        categoryId: seed.category,
        authorId: seed.author,
        body: "Reply",
        status: "active",
        postNumber: 2,
        createdAt: 1,
        updatedAt: 1,
      });
      const storageId = await ctx.storage.store(new Blob(["image"]));
      const insert = (
        threadId: Id<"forumThreads">,
        filename: string,
        extra = {},
      ) =>
        ctx.db.insert("forumAttachments", {
          threadId,
          categoryId: seed.category,
          authorId: seed.author,
          storageId,
          filename,
          contentType: "image/png",
          size: 5,
          status: "active",
          createdAt: 1,
          updatedAt: 1,
          ...extra,
        });
      const root = await insert(visible, "visible.png");
      await insert(visible, "deleted.png", { status: "deleted" });
      await insert(visible, "reply.png", { postId: reply });
      await insert(hidden, "hidden.png");
      await insert(restricted, "restricted.png");
      const missing = await ctx.storage.store(new Blob(["deleted storage"]));
      await ctx.storage.delete(missing);
      await insert(visible, "missing.png", { storageId: missing });
      return { root, visible };
    });
    const result = await t.query(api.forum.listFeedThreads, {
      paginationOpts: page,
    });
    expect(result.page.map((row) => row._id)).toEqual([ids.visible]);
    expect(result.page[0].attachments.map((file) => file._id)).toEqual([
      ids.root,
    ]);
    expect(result.page[0].attachments[0]).toMatchObject({
      filename: "visible.png",
      contentType: "image/png",
      url: expect.stringMatching(/^https:/),
    });
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", ids.visible, { status: "hidden" }),
    );
    expect(
      (await t.query(api.forum.listFeedThreads, { paginationOpts: page })).page,
    ).toEqual([]);
  });

  test("native fingerprint isolates viewer identity, trust, role, restrictions and visible board permissions without reading content", async () => {
    const t = setup();
    const seed = await fixture(t);
    const signed = t.withIdentity({ subject: seed.author });
    const fingerprint = () =>
      signed.query(api.forum.feedAuthorizationFingerprint, {});
    const guest = await t.query(api.forum.feedAuthorizationFingerprint, {});
    const initial = await fingerprint();
    expect(initial.fingerprint).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(initial).not.toEqual(guest);
    expect(await fingerprint()).toEqual(initial);
    await t.run((ctx) => thread(ctx, seed.category, seed.author, 1));
    expect(await fingerprint()).toEqual(initial);
    await t.run((ctx) =>
      ctx.db.patch("users", seed.author, { forumTrustRevokedAt: 2 }),
    );
    const revoked = await fingerprint();
    expect(revoked).not.toEqual(initial);
    await t.run((ctx) =>
      ctx.db.patch("users", seed.author, { forumRole: "moderator" }),
    );
    const moderator = await fingerprint();
    expect(moderator).not.toEqual(revoked);
    await t.run((ctx) =>
      ctx.db.patch("users", seed.author, { forumBannedAt: 2 }),
    );
    const banned = await fingerprint();
    expect(banned).not.toEqual(moderator);
    await t.run((ctx) =>
      ctx.db.patch("users", seed.author, { forumBannedAt: undefined }),
    );
    await t.run((ctx) =>
      ctx.db.patch("forumCategories", seed.category, {
        threadAccess: "closed",
      }),
    );
    expect(await fingerprint()).not.toEqual(moderator);
    const other = await t.run((ctx) =>
      ctx.db.insert("users", { username: "other" }),
    );
    expect(
      await t
        .withIdentity({ subject: other })
        .query(api.forum.feedAuthorizationFingerprint, {}),
    ).not.toEqual(await fingerprint());
    // A forum OAuth/resource token is never interpreted as native user identity.
    expect(
      await t
        .withIdentity({
          subject: seed.author,
          issuer: "https://external-connect.example",
        })
        .query(api.forum.feedAuthorizationFingerprint, {}),
    ).toEqual(await t.query(api.forum.feedAuthorizationFingerprint, {}));
  });
  test("fingerprint changes for parent visibility and own moderator assignment but never exposes hidden-board changes", async () => {
    const t = setup();
    const seed = await fixture(t);
    const hidden = await t.run((ctx) =>
      board(ctx, "private", { viewAccess: "trusted" }),
    );
    const guest = await t.query(api.forum.feedAuthorizationFingerprint, {});
    await t.run((ctx) =>
      ctx.db.patch("forumCategories", hidden, {
        name: "Hidden private name",
        threadAccess: "closed",
      }),
    );
    expect(await t.query(api.forum.feedAuthorizationFingerprint, {})).toEqual(
      guest,
    );
    const viewer = await t.run((ctx) =>
      ctx.db.insert("users", { username: "boardmoderator" }),
    );
    const signed = t.withIdentity({ subject: viewer });
    const before = await signed.query(
      api.forum.feedAuthorizationFingerprint,
      {},
    );
    const assignment = await t.run((ctx) =>
      ctx.db.insert("forumCategoryModerators", {
        categoryId: hidden,
        userId: viewer,
        assignedBy: seed.author,
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const after = await signed.query(
      api.forum.feedAuthorizationFingerprint,
      {},
    );
    expect(after).not.toEqual(before);
    await t.run((ctx) => ctx.db.delete("forumCategoryModerators", assignment));
    expect(
      await signed.query(api.forum.feedAuthorizationFingerprint, {}),
    ).toEqual(before);
    const parent = await t.run((ctx) => board(ctx, "parent"));
    await t.run((ctx) =>
      ctx.db.patch("forumCategories", seed.category, {
        parentCategoryId: parent,
      }),
    );
    const visibleParent = await t.query(
      api.forum.feedAuthorizationFingerprint,
      {},
    );
    await t.run((ctx) =>
      ctx.db.patch("forumCategories", parent, { viewAccess: "trusted" }),
    );
    expect(
      await t.query(api.forum.feedAuthorizationFingerprint, {}),
    ).not.toEqual(visibleParent);
    const output = JSON.stringify(
      await t.query(api.forum.feedAuthorizationFingerprint, {}),
    );
    expect(output).not.toContain("private");
    expect(output).not.toContain("boardmoderator");
  });
  test("fingerprint fails closed when bounded category state cannot represent the forum", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let n = 0; n <= 200; n++) await board(ctx, `board-${n}`);
    });
    await expect(
      t.query(api.forum.feedAuthorizationFingerprint, {}),
    ).rejects.toThrow("safe limit");
  });
  test("returns compact real previews and public author fields without raw bodies", async () => {
    const t = setup();
    const seed = await fixture(t);
    await t.run((ctx) => thread(ctx, seed.category, seed.author, 1));
    const result = await t.query(api.forum.listFeedThreads, {
      paginationOpts: page,
    });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]).toMatchObject({
      excerpt: "Real preview & discussion",
      categoryName: "general",
      source: "community",
      authorIdentity: {
        username: "reader",
        name: "Reader",
        avatarUrl: "https://example.com/reader.png",
        isAgent: false,
      },
    });
    expect(result.page[0]).not.toHaveProperty("body");
    expect(result.page[0]).not.toHaveProperty("searchText");
    expect(JSON.stringify(result.page[0])).not.toContain("forumTrustedAt");
  });
  test("paginates beyond the initial window with one native cursor and stable ordering", async () => {
    const t = setup();
    const seed = await fixture(t);
    await t.run(async (ctx) => {
      for (let n = 1; n <= 31; n++)
        await thread(ctx, seed.category, seed.author, n);
    });
    const first = await t.query(api.forum.listFeedThreads, {
      paginationOpts: page,
    });
    const second = await t.query(api.forum.listFeedThreads, {
      paginationOpts: { ...page, cursor: first.continueCursor },
    });
    const third = await t.query(api.forum.listFeedThreads, {
      paginationOpts: { ...page, cursor: second.continueCursor },
    });
    expect(first.isDone).toBe(false);
    expect(second.isDone).toBe(false);
    expect(third.isDone).toBe(true);
    expect([...first.page, ...second.page, ...third.page]).toHaveLength(31);
    expect(
      new Set(
        [...first.page, ...second.page, ...third.page].map((row) => row._id),
      ).size,
    ).toBe(31);
    expect(first.page[0].title).toBe("Thread 31");
  });
  test("new ordering stays global for signed-in viewers while existing recent new remains unread-only", async () => {
    const t = setup();
    const seed = await fixture(t);
    const ids = await t.run(async (ctx) => {
      const one = await thread(ctx, seed.category, seed.author, 1, {
        lastPostAt: 99,
      });
      const two = await thread(ctx, seed.category, seed.author, 2, {
        lastPostAt: 2,
      });
      await ctx.db.insert("forumThreadReads", {
        userId: seed.author,
        categoryId: seed.category,
        threadId: two,
        lastReadAt: 20,
        lastPostAt: 2,
        createdAt: 20,
        updatedAt: 20,
      });
      return { one, two };
    });
    const signed = t.withIdentity({ subject: seed.author });
    const active = await signed.query(api.forum.listFeedThreads, {
      paginationOpts: page,
    });
    const newest = await signed.query(api.forum.listFeedThreads, {
      paginationOpts: page,
      sort: "new",
    });
    expect(active.page.map((row) => row._id)).toEqual([ids.one, ids.two]);
    expect(newest.page.map((row) => row._id)).toEqual([ids.two, ids.one]);
    expect(newest.page[0].viewerHasRead).toBe(true);
    const recent = await signed.query(api.forum.listRecentThreads, {
      mode: "new",
      now: 100,
    });
    expect(recent.threads.map((row) => row._id)).toEqual([ids.one]);
  });
  test("filters pending/hidden/deleted threads and every restricted ancestor before exposing previews", async () => {
    const t = setup();
    const seed = await fixture(t);
    await t.run(async (ctx) => {
      await thread(ctx, seed.category, seed.author, 1);
      await thread(ctx, seed.category, seed.author, 2, { status: "locked" });
      for (const [n, status] of [
        [3, "pending"],
        [4, "hidden"],
        [5, "deleted"],
      ] as const)
        await thread(ctx, seed.category, seed.author, n, { status });
      const parent = await board(ctx, "trusted-parent", {
        viewAccess: "trusted",
      });
      const child = await board(ctx, "public-child", {
        parentCategoryId: parent,
      });
      await thread(ctx, child, seed.author, 6, { body: "SECRET PREVIEW" });
      const archived = await board(ctx, "archived-parent", {
        status: "archived",
      });
      const orphan = await board(ctx, "archived-child", {
        parentCategoryId: archived,
      });
      await thread(ctx, orphan, seed.author, 7);
    });
    const publicResult = await t.query(api.forum.listFeedThreads, {
      paginationOpts: page,
    });
    expect(publicResult.page.map((row) => row.title)).toEqual([
      "Thread 2",
      "Thread 1",
    ]);
    expect(JSON.stringify(publicResult)).not.toContain("SECRET");
    const trusted = await t
      .withIdentity({ subject: seed.author })
      .query(api.forum.listFeedThreads, { paginationOpts: page });
    expect(trusted.page.map((row) => row.title)).toEqual([
      "Thread 6",
      "Thread 2",
      "Thread 1",
    ]);
    await t.run((ctx) =>
      ctx.db.patch("users", seed.author, { forumBannedAt: 1 }),
    );
    expect(
      (
        await t
          .withIdentity({ subject: seed.author })
          .query(api.forum.listFeedThreads, { paginationOpts: page })
      ).page,
    ).toEqual([]);
  });
  test("community excludes known editorial desks and news boards, retaining other agents", async () => {
    const t = setup();
    const seed = await fixture(t);
    await t.run(async (ctx) => {
      const editor = await ctx.db.insert("users", {
        username: "belle",
        isAgent: true,
        agentSlug: "belle",
      });
      const personalAgent = await ctx.db.insert("users", {
        username: "helper",
        isAgent: true,
        agentSlug: "reader-helper",
      });
      await thread(ctx, seed.category, editor, 1);
      await thread(ctx, seed.category, personalAgent, 2);
      const news = await board(ctx, "forum-news");
      await thread(ctx, news, seed.author, 3, { categorySlug: "forum-news" });
    });
    const community = await t.query(api.forum.listFeedThreads, {
      paginationOpts: page,
      communityOnly: true,
    });
    expect(community.page.map((row) => row.title)).toEqual(["Thread 2"]);
    expect(community.page[0].authorIdentity.isAgent).toBe(true);
    const all = await t.query(api.forum.listFeedThreads, {
      paginationOpts: page,
    });
    expect(all.page.map((row) => row.source)).toEqual([
      "editorial",
      "community",
      "editorial",
    ]);
  });
  test("hidden pages retain forward progress and shared public plugin reads enforce the same visibility", async () => {
    const t = setup();
    const seed = await fixture(t);
    await t.run(async (ctx) => {
      await thread(ctx, seed.category, seed.author, 1);
      for (let n = 2; n <= 13; n++)
        await thread(ctx, seed.category, seed.author, n, { status: "hidden" });
    });
    const hidden = await t.query(api.forum.listFeedThreads, {
      paginationOpts: page,
    });
    expect(hidden.page).toEqual([]);
    expect(hidden.isDone).toBe(false);
    const visible = await t.query(api.forum.listFeedThreads, {
      paginationOpts: { ...page, cursor: hidden.continueCursor },
    });
    expect(visible.page.map((row) => row.title)).toEqual(["Thread 1"]);
    const plugin = await t.query(internal.forumPlugin.publicRead, {
      operation: "listFeedThreads",
      args: { paginationOpts: { ...page, cursor: hidden.continueCursor } },
    });
    expect(plugin.data).toEqual(visible);
  });
  test("rejects page expansion and preserves one pagination call under maximum legitimate bodies", async () => {
    const t = setup();
    const seed = await fixture(t);
    await t.run(async (ctx) => {
      for (let n = 1; n <= 24; n++)
        await thread(ctx, seed.category, seed.author, n, {
          body: "界".repeat(64_000),
          searchText: "界".repeat(64_000),
        });
    });
    await expect(
      t.query(api.forum.listFeedThreads, {
        paginationOpts: { numItems: 25, cursor: null },
      }),
    ).rejects.toThrow("1–24");
    await expect(
      t.query(api.forum.listFeedThreads, {
        paginationOpts: { numItems: 12, cursor: null, endCursor: "forged" },
      }),
    ).rejects.toThrow("1–24");
    const measured = await t.run(async (ctx) => {
      let calls = 0;
      let threadReads = 0;
      let threadBytesRead = 0;
      const db = new Proxy(ctx.db, {
        get(target, property, receiver) {
          if (property !== "query")
            return Reflect.get(target, property, receiver);
          return (table: Parameters<typeof ctx.db.query>[0]) => {
            const wrap = (builder: object): object =>
              new Proxy(builder, {
                get(queryTarget, key) {
                  const member = Reflect.get(queryTarget, key);
                  if (typeof member !== "function") return member;
                  return (...args: unknown[]) => {
                    if (key === "paginate") {
                      calls++;
                      if (calls > 1) throw new Error("Multiple paginations");
                      return (
                        Reflect.apply(member, queryTarget, args) as Promise<{
                          page: unknown[];
                        }>
                      ).then((result) => {
                        if (table === "forumThreads") {
                          threadReads += result.page.length;
                          threadBytesRead += new TextEncoder().encode(
                            JSON.stringify(result.page),
                          ).byteLength;
                        }
                        return result;
                      });
                    }
                    const value = Reflect.apply(member, queryTarget, args);
                    return key === "withIndex" || key === "order"
                      ? wrap(value as object)
                      : value;
                  };
                },
              });
            return wrap(target.query(table));
          };
        },
      });
      const result = await forumOperations.listFeedThreads.definition.handler(
        { ...ctx, db } as unknown as QueryCtx,
        { paginationOpts: { numItems: 24, cursor: null } },
      );
      return { calls, threadReads, threadBytesRead, result };
    });
    expect(measured.calls).toBe(1);
    expect(measured.threadReads).toBeGreaterThan(0);
    expect(measured.threadReads).toBeLessThanOrEqual(2);
    expect(measured.threadBytesRead).toBeLessThan(800_000);
    expect(measured.result.page.length).toBe(measured.threadReads);
    expect(measured.result.isDone).toBe(false);
    expect(JSON.stringify(measured.result).length).toBeLessThan(40_000);
  });
});

describe("stored forum news", () => {
  test("returns actual aggregate platform counts separately from external HN stats", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { name: "Reader" });
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: "2026-10-01",
        status: "complete",
        startedAt: 1,
        storyCount: 1,
      });
      await ctx.db.insert("hnStories", {
        hnItemId: 123,
        snapshotDate: "2026-10-01",
        title: "Real HN story",
        rank: 1,
        score: 99,
        descendants: 42,
        fetchedAt: 2,
      });
      await ctx.db.insert("interactions", {
        userId,
        entityType: "hnStory",
        entityId: "123",
        vote: 1,
        saved: true,
        updatedAt: 1,
      });
      await ctx.db.insert("comments", {
        userId,
        entityType: "hnStory",
        entityId: "123",
        body: "Local comment",
        status: "active",
        createdAt: 1,
      });
      await ctx.db.insert("comments", {
        userId,
        entityType: "hnStory",
        entityId: "123",
        body: "Hidden comment",
        status: "hidden",
        createdAt: 1,
      });
    });
    await t.mutation(internal.contentAggregates.backfillContentAggregates, {
      phase: "interactions",
    });
    await t.mutation(internal.contentAggregates.backfillContentAggregates, {
      phase: "comments",
    });
    const result = await t.query(api.forum.listNewsFeed, {});
    expect(result.stories[0]).toMatchObject({
      hnScore: 99,
      hnCommentCount: 42,
      platformStats: { score: 1, saves: 1, comments: 1 },
      platformStatsStatus: "available",
    });
  });
  test("bounds large HN bodies without returning text or scanning the whole snapshot", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: "2026-10-01",
        status: "complete",
        startedAt: 1,
        storyCount: 30,
      });
      for (let rank = 1; rank <= 30; rank++)
        await ctx.db.insert("hnStories", {
          hnItemId: rank,
          snapshotDate: "2026-10-01",
          title: `Story ${rank}`,
          rank,
          text: "x".repeat(600_000),
          fetchedAt: 2,
        });
    });
    const result = await t.query(api.forum.listNewsFeed, { limit: 30 });
    expect(result.stories).toHaveLength(2);
    expect(result.limited).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(2_000);
  });
  test("selects last completed snapshot, strips story bodies, and separates unavailable local stats from HN points", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: "2026-10-02",
        status: "failed",
        startedAt: 10,
        storyCount: 0,
        errorMessage: "private refresh diagnostics",
      });
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: "2026-10-01",
        status: "complete",
        startedAt: 1,
        completedAt: 2,
        storyCount: 1,
      });
      await ctx.db.insert("hnStories", {
        hnItemId: 123,
        snapshotDate: "2026-10-01",
        title: "Real HN story",
        text: "LONG BODY",
        url: "https://www.example.com/story",
        host: "forged-host",
        rank: 1,
        score: 99,
        descendants: 42,
        fetchedAt: 2,
      });
    });
    const result = await t.query(api.forum.listNewsFeed, {});
    expect(result.snapshot?.snapshotDate).toBe("2026-10-01");
    expect(result.stories[0]).toMatchObject({
      title: "Real HN story",
      hnScore: 99,
      hnCommentCount: 42,
      host: "example.com",
      discussionUrl: "https://news.ycombinator.com/item?id=123",
      platformStats: null,
      platformStatsStatus: "unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("LONG BODY");
    expect(JSON.stringify(result)).not.toContain("private refresh diagnostics");
    await expect(
      t.query(api.forum.listNewsFeed, { limit: 31 }),
    ).rejects.toThrow("1–30");
    await expect(
      t.query(api.forum.listNewsFeed, { snapshotDate: "2026<script>" }),
    ).rejects.toThrow("YYYY-MM-DD");
    expect(
      (await t.query(api.forum.listNewsFeed, { snapshotDate: "2026-10-02" }))
        .stories,
    ).toEqual([]);
    const plugin = await t.query(internal.forumPlugin.publicRead, {
      operation: "listNewsFeed",
      args: {},
    });
    expect(plugin.data).toEqual(result);
  });
  test("unknown or missing snapshots yield a genuine empty state and unsafe external links are omitted", async () => {
    const t = setup();
    expect(await t.query(api.forum.listNewsFeed, {})).toEqual({
      snapshots: [],
      snapshot: null,
      stories: [],
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("newsSnapshots", {
        snapshotDate: "2026-10-01",
        status: "complete",
        startedAt: 1,
        storyCount: 1,
      });
      await ctx.db.insert("hnStories", {
        hnItemId: 1,
        snapshotDate: "2026-10-01",
        title: "Unsafe URL",
        url: "javascript:alert(1)",
        rank: 1,
        fetchedAt: 2,
      });
    });
    const result = await t.query(api.forum.listNewsFeed, {});
    expect(result.stories[0].url).toBeUndefined();
    expect(result.stories[0].host).toBeUndefined();
    expect(
      (await t.query(api.forum.listNewsFeed, { snapshotDate: "1999-01-01" }))
        .stories,
    ).toEqual([]);
  });
});
