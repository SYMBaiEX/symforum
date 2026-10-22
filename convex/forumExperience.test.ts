/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import agentTest from "@convex-dev/agent/test";
import presenceTest from "@convex-dev/presence/test";
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  agentTest.register(t);
  presenceTest.register(t);
  return t;
}
async function fixture(t: ReturnType<typeof setup>) {
  return t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      username: "owner",
      usernameNormalized: "owner",
      name: "Friendly Owner",
      forumTrustedAt: 1,
    });
    const other = await ctx.db.insert("users", {
      username: "other",
      usernameNormalized: "other",
      name: "Friendly Other",
      forumTrustedAt: 1,
    });
    const agent = await ctx.db.insert("users", {
      username: "helper",
      name: "Helpful Agent",
      isAgent: true,
      agentSlug: "helper",
      agentStatus: "active",
      agentScopes: ["forum"],
      agentKeyVersion: 1,
    });
    await ctx.db.insert("agentIdentities", {
      agentId: "helper",
      userId: agent,
      ownerUserId: owner,
      credentialKind: "oauth",
      scopes: ["forum"],
      status: "active",
      keyVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    });
    const base = {
      name: "General",
      description: "",
      kind: "board" as const,
      status: "active" as const,
      viewAccess: "public" as const,
      threadAccess: "members" as const,
      replyAccess: "members" as const,
      pollAccess: "members" as const,
      position: 0,
      threadCount: 3,
      postCount: 4,
      createdAt: 1,
      updatedAt: 1,
    };
    const board = await ctx.db.insert("forumCategories", {
      ...base,
      slug: "general",
    });
    const review = await ctx.db.insert("forumCategories", {
      ...base,
      slug: "plugin-review",
    });
    const create = (
      authorId: typeof owner,
      categoryId = board,
      categorySlug = "general",
      kind: "discussion" | "question" = "discussion",
      n = 1,
    ) =>
      ctx.db.insert("forumThreads", {
        categoryId,
        categorySlug,
        authorId,
        slug: `topic-${n}`,
        title: `Topic ${n}`,
        body: "A concrete discussion with context.",
        kind,
        status: "active",
        pinned: false,
        replyCount: 0,
        viewCount: 0,
        lastPostAt: n,
        lastPostUserId: authorId,
        searchText: "",
        createdAt: n,
        updatedAt: n,
      });
    const question = await create(owner, board, "general", "question", 1);
    const human = await create(other, board, "general", "discussion", 2);
    const ai = await create(agent, board, "general", "discussion", 3);
    const rehearsal = await create(
      other,
      review,
      "plugin-review",
      "discussion",
      4,
    );
    const answer = await ctx.db.insert("forumPosts", {
      threadId: question,
      categoryId: board,
      authorId: other,
      body: "Useful answer",
      postNumber: 2,
      status: "active",
      createdAt: 5,
      updatedAt: 5,
    });
    return {
      owner,
      other,
      agent,
      board,
      review,
      question,
      human,
      ai,
      rehearsal,
      answer,
    };
  });
}
const page = { numItems: 24, cursor: null };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("shared forum experience", () => {
  test("discovery removes reviewer fixtures while direct board access remains", async () => {
    const t = setup(),
      s = await fixture(t);
    const feed = await t.query(api.forum.listFeedThreads, {
      sort: "new",
      paginationOpts: page,
    });
    expect(feed.page.map((p) => p._id)).not.toContain(s.rehearsal);
    expect(
      (
        await t.query(api.forum.listThreads, { categorySlug: "plugin-review" })
      ).threads.map((p) => p._id),
    ).toContain(s.rehearsal);
  });
  test("following requires identity and checks exact memberships and ignores", async () => {
    const t = setup(),
      s = await fixture(t),
      owner = t.withIdentity({ subject: s.owner });
    await expect(
      t.query(api.forum.listFeedThreads, {
        scope: "following",
        paginationOpts: page,
      }),
    ).rejects.toThrow("Sign in");
    expect(
      (
        await owner.query(api.forum.listFeedThreads, {
          scope: "following",
          paginationOpts: page,
        })
      ).page,
    ).toEqual([]);
    await owner.mutation(api.forum.setCategorySubscription, {
      categorySlug: "general",
      subscribed: true,
    });
    await owner.mutation(api.forum.updateForumRelationship, {
      username: "other",
      kind: "ignore",
      enabled: true,
    });
    const feed = await owner.query(api.forum.listFeedThreads, {
      scope: "following",
      paginationOpts: page,
    });
    expect(feed.page.map((p) => p._id)).toEqual(
      expect.arrayContaining([s.question, s.ai]),
    );
    expect(feed.page.map((p) => p._id)).not.toContain(s.human);
  });
  test("human/agent filters and unanswered preserve raw pagination", async () => {
    const t = setup(),
      s = await fixture(t);
    const humans = await t.query(api.forum.listFeedThreads, {
      authorFilter: "humans",
      paginationOpts: page,
    });
    expect(humans.page.map((p) => p._id)).not.toContain(s.ai);
    const agents = await t.query(api.forum.listFeedThreads, {
      authorFilter: "agents",
      paginationOpts: page,
    });
    expect(agents.page.map((p) => p._id)).toEqual([s.ai]);
    expect(agents.isDone).toBe(true);
    const unanswered = await t.query(api.forum.listFeedThreads, {
      sort: "unanswered",
      paginationOpts: page,
    });
    expect(unanswered.page.map((p) => p._id)).toEqual([s.question]);
  });
  test.each([false, true])("signed-in members without current trust can load feed preferences (revoked=%s)", async (revoked) => {
    const t = setup();
    const s = await fixture(t);
    const userId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("users", {
        name: "New Reader",
        ...(revoked ? { forumTrustedAt: 1, forumTrustRevokedAt: 2 } : {}),
      });
      await ctx.db.insert("forumUserRelationships", {
        userId: id,
        targetUserId: s.other,
        kind: "buddy",
        createdAt: 1,
        updatedAt: 1,
      });
      return id;
    });
    const viewer = t.withIdentity({ subject: userId });
    expect(await viewer.query(api.forum.getMyForumExperience, {})).toMatchObject({
      defaultFeed: "discover",
      authorFilter: "all",
      mutedWords: [],
      onboardingCompleted: false,
      followingBoards: [],
      followingMembers: [],
    });
    await expect(viewer.query(api.forum.listMyForumRelationships, {}))
      .rejects.toThrow("approve your forum access");
    await expect(t.query(api.forum.getMyForumExperience, {}))
      .rejects.toThrow("Sign in to personalize your forum");
  });

  test("mute expiry and preferences are private to the acting user", async () => {
    const t = setup(),
      s = await fixture(t),
      owner = t.withIdentity({ subject: s.owner });
    const until = Date.now() + 86_400_000;
    await owner.mutation(api.forum.updateMyForumExperience, {
      mutedWords: [" TOPIC 2 ", "topic 2"],
      mutedUntil: until,
      defaultFeed: "following",
      authorFilter: "humans",
    });
    expect(await owner.query(api.forum.getMyForumExperience, {})).toMatchObject(
      { mutedWords: ["topic 2"], defaultFeed: "following" },
    );
    expect(
      (
        await t
          .withIdentity({ subject: s.other })
          .query(api.forum.getMyForumExperience, {})
      ).mutedWords,
    ).toEqual([]);
    expect(
      (
        await owner.query(api.forum.listFeedThreads, {
          authorFilter: "all",
          now: until - 1,
          paginationOpts: page,
        })
      ).page.map((p) => p._id),
    ).not.toContain(s.human);
    expect(
      (
        await owner.query(api.forum.listFeedThreads, {
          authorFilter: "all",
          now: until + 1,
          paginationOpts: page,
        })
      ).page.map((p) => p._id),
    ).toContain(s.human);
    await expect(
      owner.mutation(api.forum.updateMyForumExperience, {
        mutedWords: Array(21).fill("word"),
      }),
    ).rejects.toThrow("20");
  });
  test("accepted answers require author authority and a published same-thread reply", async () => {
    const t = setup(),
      s = await fixture(t),
      owner = t.withIdentity({ subject: s.owner });
    await expect(
      t
        .withIdentity({ subject: s.other })
        .mutation(api.forum.setAcceptedAnswer, {
          threadId: s.question,
          postId: s.answer,
        }),
    ).rejects.toThrow("Only the question author");
    await expect(
      owner.mutation(api.forum.setAcceptedAnswer, {
        threadId: s.human,
        postId: s.answer,
      }),
    ).rejects.toThrow("question");
    await owner.mutation(api.forum.setAcceptedAnswer, {
      threadId: s.question,
      postId: s.answer,
    });
    const detail = await owner.query(api.forum.getThread, {
      categorySlug: "general",
      threadSlug: "topic-1",
    });
    expect(detail.acceptedAnswer).toMatchObject({
      _id: s.answer,
      author: "Friendly Other",
    });
    expect(detail.thread).toMatchObject({
      authorDisplayName: "Friendly Owner",
      authorUsername: "owner",
      viewerCanAcceptAnswer: true,
    });
    await t.run((ctx) =>
      ctx.db.patch("forumPosts", s.answer, { status: "hidden" }),
    );
    expect(
      (
        await owner.query(api.forum.getThread, {
          categorySlug: "general",
          threadSlug: "topic-1",
        })
      ).acceptedAnswer,
    ).toBeNull();
    await expect(
      owner.mutation(api.forum.setAcceptedAnswer, {
        threadId: s.question,
        postId: s.answer,
      }),
    ).rejects.toThrow("published");
    await owner.mutation(api.forum.setAcceptedAnswer, {
      threadId: s.question,
      postId: null,
    });
  });
  test("contextual replies reject hidden and foreign parents without creating a post", async () => {
    const t = setup(),
      s = await fixture(t),
      owner = t.withIdentity({ subject: s.owner });
    await expect(
      owner.mutation(api.forum.createReply, {
        threadId: s.human,
        parentPostId: s.answer,
        body: "A misplaced reply",
      }),
    ).rejects.toThrow();
    await t.run((ctx) =>
      ctx.db.patch("forumPosts", s.answer, { status: "hidden" }),
    );
    await expect(
      owner.mutation(api.forum.createReply, {
        threadId: s.question,
        parentPostId: s.answer,
        body: "A hidden parent",
      }),
    ).rejects.toThrow();
    await t.run((ctx) =>
      ctx.db.patch("forumPosts", s.answer, { status: "active" }),
    );
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", s.question, {
        replyCount: 1,
        lastAssignedPostNumber: 2,
      }),
    );
    const receipt = await owner.mutation(api.forum.createReply, {
      threadId: s.question,
      parentPostId: s.answer,
      body: "A reply with context",
    });
    const detail = await owner.query(api.forum.getThread, {
      categorySlug: "general",
      threadSlug: "topic-1",
    });
    expect(
      detail.replies.page.find((p) => p._id === receipt.postId),
    ).toMatchObject({
      parentPostId: s.answer,
      replyContext: { author: "Friendly Other", postNumber: 2 },
    });
    await t.run((ctx) =>
      ctx.db.patch("forumPosts", s.answer, { status: "deleted" }),
    );
    expect(
      (
        await owner.query(api.forum.getThread, {
          categorySlug: "general",
          threadSlug: "topic-1",
        })
      ).replies.page.find((p) => p._id === receipt.postId)?.replyContext,
    ).toBeNull();
  });
  test("news discussion creation is atomic across retries and preserves source", async () => {
    const t = setup(),
      s = await fixture(t),
      owner = t.withIdentity({ subject: s.owner });
    await t.run((ctx) =>
      ctx.db.insert("hnStories", {
        hnItemId: 123,
        snapshotDate: "2026-10-03",
        rank: 1,
        title: "An indexed source story",
        url: "https://example.com/article",
        fetchedAt: 1,
      }),
    );
    const args = {
      hnItemId: 123,
      categorySlug: "general",
      body: "Let's compare what this source tells us.",
    };
    const [a, b] = await Promise.all([
      owner.mutation(api.forum.createNewsDiscussion, args),
      owner.mutation(api.forum.createNewsDiscussion, args),
    ]);
    expect(a.threadId).toBe(b.threadId);
    expect([a.existing, b.existing].sort()).toEqual([false, true]);
    expect(
      (await t.query(api.forum.getNewsDiscussion, { hnItemId: 123 })).discussion
        ?.threadId,
    ).toBe(a.threadId);
    await t.run(async (ctx) => {
      expect((await ctx.db.get("forumThreads", a.threadId))?.sourceUrl).toBe(
        "https://example.com/article",
      );
      expect(await ctx.db.query("forumNewsDiscussions").collect()).toHaveLength(
        1,
      );
    });
  });
  test("news discussion publishes immediately and private boards remain protected", async () => {
    const t = setup(),
      s = await fixture(t),
      owner = t.withIdentity({ subject: s.owner });
    await t.run(async (ctx) => {
      await ctx.db.insert("hnStories", {
        hnItemId: 124,
        snapshotDate: "2026-10-03",
        rank: 1,
        title: "Source story",
        fetchedAt: 1,
      });
      await ctx.db.patch("forumCategories", s.board, { viewAccess: "trusted" });
    });
    await expect(
      owner.mutation(api.forum.createNewsDiscussion, {
        hnItemId: 124,
        categorySlug: "general",
        body: "An opening discussion",
      }),
    ).rejects.toThrow("public board");
    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", s.board, { viewAccess: "public" });
      await ctx.db.patch("users", s.owner, { forumTrustRevokedAt: Date.now() });
    });
    const receipt = await owner.mutation(api.forum.createNewsDiscussion, {
      hnItemId: 124,
      categorySlug: "general",
      body: "An opening discussion",
    });
    expect(receipt.status).toBe("active");
    expect(
      (await t.query(api.forum.getNewsDiscussion, { hnItemId: 124 }))
        .discussion?.status,
    ).toBe("active");
    expect(
      (await owner.query(api.forum.getNewsDiscussion, { hnItemId: 124 }))
        .discussion?.status,
    ).toBe("active");
    expect(
      (await owner.query(api.forum.listMyForumCatchUp, {})).summary.pending,
    ).toBe(0);
  });
  test("Lounge context and read markers respect profile and moderation", async () => {
    const t = setup(),
      s = await fixture(t),
      owner = t.withIdentity({ subject: s.owner }),
      other = t.withIdentity({ subject: s.other });
    const first = await other.mutation(api.forum.sendChatMessage, {
      body: "Hello @owner",
    });
    const second = await owner.mutation(api.forum.sendChatMessage, {
      body: "Hello back",
      replyToId: first.messageId,
    });
    let data = await owner.query(api.forum.listChatMessages, {
      paginationOpts: page,
    });
    expect(
      data.page.find((m) => m._id === second.messageId)?.replyTo,
    ).toMatchObject({ _id: first.messageId });
    expect(data.mentionCount).toBe(1);
    await owner.mutation(api.forum.markChatRead, {
      messageId: first.messageId,
    });
    expect(
      (await owner.query(api.forum.listChatMessages, { paginationOpts: page }))
        .unreadCount,
    ).toBe(0);
    expect(
      (await other.query(api.forum.listChatMessages, { paginationOpts: page }))
        .unreadCount,
    ).toBe(1);
    await t.run((ctx) =>
      ctx.db.patch("forumChatMessages", first.messageId, { status: "hidden" }),
    );
    data = await owner.query(api.forum.listChatMessages, {
      paginationOpts: page,
    });
    expect(
      data.page.find((m) => m._id === second.messageId)?.replyTo,
    ).toBeNull();
    await expect(
      owner.mutation(api.forum.sendChatMessage, {
        body: "Not visible",
        replyToId: first.messageId,
      }),
    ).rejects.toThrow("published");
  });
  test("promoting chat preserves speakers and rejects unpublished selections", async () => {
    const t = setup(),
      s = await fixture(t),
      owner = t.withIdentity({ subject: s.owner });
    const message = await t
      .withIdentity({ subject: s.other })
      .mutation(api.forum.sendChatMessage, { body: "A useful exchange" });
    const result = await owner.mutation(api.forum.createThreadFromChat, {
      title: "Keep this useful exchange",
      categorySlug: "general",
      messageIds: [message.messageId],
    });
    await t.run(async (ctx) => {
      const thread = await ctx.db.get("forumThreads", result.threadId);
      expect(thread?.body).toContain("Friendly Other");
      expect(thread?.body).toContain("> A useful exchange");
    });
    await t.run((ctx) =>
      ctx.db.patch("forumChatMessages", message.messageId, {
        status: "hidden",
      }),
    );
    await expect(
      owner.mutation(api.forum.createThreadFromChat, {
        title: "Another exchange",
        categorySlug: "general",
        messageIds: [message.messageId],
      }),
    ).rejects.toThrow("published");
  });
});
