/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { sha256Base64Url } from "./agentIdentityCrypto";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const snapshot = api.forumCommunityQuality.snapshot;
const queue = internal.forumCommunityQuality.contentReviewQueue;
const window = { startAt: 1000, endAt: 10000 };
function setup() {
  return convexTest(schema, modules);
}
async function fixture(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      role: "owner",
      username: "owner",
    });
    const human = await ctx.db.insert("users", { username: "member" });
    const agent = await ctx.db.insert("users", {
      username: "helper",
      isAgent: true,
      agentSlug: "helper",
    });
    const external = await ctx.db.insert("users", {
      username: "external",
      isAgent: true,
    });
    const moderator = await ctx.db.insert("users", {
      username: "moderator",
      forumRole: "moderator",
    });
    const forumAdmin = await ctx.db.insert("users", {
      username: "forum-admin",
      forumRole: "admin",
    });
    const agentAdmin = await ctx.db.insert("users", {
      username: "bad-agent-admin",
      isAgent: true,
      role: "admin",
    });
    const boardBase = {
      name: "General",
      description: "",
      status: "active" as const,
      viewAccess: "public" as const,
      position: 0,
      threadCount: 0,
      postCount: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    const board = await ctx.db.insert("forumCategories", {
      ...boardBase,
      slug: "general",
    });
    const review = await ctx.db.insert("forumCategories", {
      ...boardBase,
      slug: "plugin-review",
    });
    const privateParent = await ctx.db.insert("forumCategories", {
      ...boardBase,
      slug: "staff",
      viewAccess: "staff",
    });
    const privateChild = await ctx.db.insert("forumCategories", {
      ...boardBase,
      slug: "child",
      parentCategoryId: privateParent,
    });
    await ctx.db.insert("forumAgents", {
      slug: "helper",
      name: "Helper",
      userId: agent,
      persona: "Technical helper",
      model: "openrouter/free",
      dailyPostTarget: 1,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    });
    let n = 0;
    async function thread(
      authorId: Id<"users">,
      patch: {
        categoryId?: Id<"forumCategories">;
        kind?: "question";
        agentAssisted?: boolean;
        body?: string;
        status?: "hidden" | "pending" | "locked";
      } = {},
    ) {
      n += 1;
      return await ctx.db.insert("forumThreads", {
        categoryId: board,
        categorySlug: "general",
        slug: `topic-${n}`,
        title: `Useful topic ${n}`,
        body: "A complete contribution with useful context.",
        authorId,
        status: "active",
        pinned: false,
        replyCount: 0,
        viewCount: 900,
        lastPostAt: 2000 + n,
        lastPostUserId: authorId,
        searchText: "Useful",
        createdAt: 2000,
        updatedAt: 2000,
        ...patch,
      });
    }
    const unanswered = await thread(human, { kind: "question" });
    const answered = await thread(human, {
      kind: "question",
      agentAssisted: true,
    });
    const agentThread = await thread(agent, {
      body: "[h2]An unfinished section[/h2]",
      status: "locked",
    });
    async function reply(
      threadId: Id<"forumThreads">,
      authorId: Id<"users">,
      createdAt: number,
      patch: { agentAssisted?: boolean; status?: "hidden" | "pending" } = {},
    ) {
      return await ctx.db.insert("forumPosts", {
        threadId,
        categoryId: board,
        authorId,
        body: "A useful reply",
        status: "active",
        createdAt,
        updatedAt: createdAt,
        ...patch,
      });
    }
    const accepted = await reply(answered, agent, 3000);
    await ctx.db.patch("forumThreads", answered, {
      acceptedPostId: accepted,
      replyCount: 1,
    });
    await reply(agentThread, human, 3001);
    await reply(agentThread, human, 3002, { agentAssisted: true });
    const followUp = await reply(agentThread, agent, 3003);
    await reply(agentThread, human, 3004, { status: "hidden" });
    await reply(agentThread, human, 3005, { status: "pending" });
    await reply(agentThread, human, 999, {});
    await reply(agentThread, human, 11000, {});
    await ctx.db.patch("forumThreads", agentThread, { replyCount: 5 });
    await ctx.db.insert("forumAgentRuns", {
      runKey: "helper-day-1",
      agentSlug: "helper",
      runDate: "2026-10-06",
      slot: 1,
      attempt: 1,
      status: "published",
      model: "openrouter/free",
      threadId: agentThread,
      sourceUrls: [],
      followUpPostId: followUp,
      startedAt: 2000,
      completedAt: 2001,
      updatedAt: 2001,
    });
    await thread(agent, { categoryId: review, body: "[h2]Not public[/h2]" });
    await thread(agent, { categoryId: privateChild, body: "[h2]Private[/h2]" });
    await thread(agent, { status: "hidden" });
    await thread(agent, { status: "pending" });
    const externalThread = await thread(external, {
      body: "[h2]External agent[/h2]",
    });
    return {
      owner,
      human,
      agent,
      moderator,
      forumAdmin,
      agentAdmin,
      unanswered,
      answered,
      accepted,
      agentThread,
      followUp,
      externalThread,
    };
  });
}

describe("bounded forum community outcome snapshot", () => {
  test("requires a first-party human administrator, including for legacy admin roles", async () => {
    const t = setup(),
      seed = await fixture(t);
    await expect(t.action(snapshot, window)).rejects.toThrow(
      "human forum administrator",
    );
    for (const user of [seed.human, seed.moderator, seed.agentAdmin])
      await expect(
        t.withIdentity({ subject: user }).action(snapshot, window),
      ).rejects.toThrow("human forum administrator");
    await expect(
      t
        .withIdentity({
          subject: seed.owner,
          issuer: "https://untrusted.example",
        })
        .action(snapshot, window),
    ).rejects.toThrow("human forum administrator");
    expect(
      (
        await t
          .withIdentity({ subject: seed.forumAdmin })
          .action(snapshot, window)
      ).outcomes.sampledThreadCount,
    ).toBe(4);
    await t.run((ctx) =>
      ctx.db.patch("users", seed.forumAdmin, {
        forumSuspendedUntil: Date.now() + 100000,
      }),
    );
    await expect(
      t
        .withIdentity({ subject: seed.forumAdmin })
        .action(snapshot, { ...window, endAt: 20000 }),
    ).rejects.toThrow("human forum administrator");
  });
  test("excludes restricted ancestors and test boards; distinguishes assistance and current answers", async () => {
    const t = setup(),
      seed = await fixture(t);
    const result = await t
      .withIdentity({ subject: seed.owner })
      .action(snapshot, window);
    expect(result.outcomes).toMatchObject({
      sampledThreadCount: 4,
      sampledReplyCount: 4,
      threadsByActor: { human: 1, assisted: 1, agent: 2 },
      repliesByActor: { human: 1, assisted: 1, agent: 2 },
      humanQuestions: {
        unassisted: 1,
        assisted: 1,
        unanswered: 1,
        resolved: 1,
      },
      agentThreadsWithHumanProfileReplies: 1,
      agentAuthorFollowUpThreads: 1,
      publicationFollowUpThreads: 1,
      saves: null,
    });
    expect(
      result.threads.every(
        (thread) =>
          !thread.url.includes("plugin-review") &&
          !thread.url.includes("child"),
      ),
    ).toBe(true);
    expect(result.coverage.excludedExaminedThreads).toBe(4);
    await t.run((ctx) =>
      ctx.db.patch("forumPosts", seed.accepted, { status: "hidden" }),
    );
    expect(
      (await t.withIdentity({ subject: seed.owner }).action(snapshot, window))
        .outcomes.humanQuestions.resolved,
    ).toBe(0);
  });
  test("limits replies and exposes partial coverage; ignores deleted or mismatched accepted answers/follow-ups", async () => {
    const t = setup(),
      seed = await fixture(t);
    const result = await t
      .withIdentity({ subject: seed.owner })
      .action(snapshot, { ...window, replyLimit: 1 });
    expect(result.outcomes.threadsWithLimitedReplySamples).toBe(1);
    expect(result.outcomes.sampledReplyCount).toBe(2);
    await t.run(async (ctx) => {
      await ctx.db.patch("forumThreads", seed.unanswered, {
        acceptedPostId: seed.accepted,
      });
      await ctx.db.patch("forumPosts", seed.followUp, { status: "deleted" });
    });
    const updated = await t
      .withIdentity({ subject: seed.owner })
      .action(snapshot, window);
    expect(updated.outcomes.humanQuestions.resolved).toBe(1);
    expect(updated.outcomes.publicationFollowUpThreads).toBe(0);
    for (const args of [
      { ...window, replyLimit: 0 },
      { ...window, limit: 51 },
      { startAt: 100, endAt: 99 },
      { startAt: 0, endAt: 91 * 86400000 },
    ])
      await expect(
        t.withIdentity({ subject: seed.owner }).action(snapshot, args),
      ).rejects.toThrow();
  });
  test("reports truncated scans without claiming excluded rows represent the whole forum", async () => {
    const t = setup(),
      seed = await fixture(t);
    await t.run(async (ctx) => {
      const original = await ctx.db.get("forumThreads", seed.agentThread);
      if (!original) throw new Error("Missing fixture");
      const { _id, _creationTime, ...fields } = original;
      void _id;
      void _creationTime;
      for (let index = 0; index < 305; index += 1)
        await ctx.db.insert("forumThreads", {
          ...fields,
          status: "pending",
          slug: `pending-${index}`,
          lastPostAt: 5000 + index,
        });
    });
    const result = await t
      .withIdentity({ subject: seed.owner })
      .action(snapshot, window);
    expect(result.coverage.scanLimited).toBe(true);
    expect(result.coverage.examinedThreads).toBe(300);
    expect(result.outcomes.sampledThreadCount).toBe(0);
    expect(result.coverage.notes.join(" ")).toContain(
      "not a forum-wide census",
    );
  });
  test("fails closed for cyclic category ancestry and invalid legacy access", async () => {
    const t = setup(),
      seed = await fixture(t);
    await t.run(async (ctx) => {
      const thread = await ctx.db.get("forumThreads", seed.agentThread);
      if (!thread) throw new Error("Missing fixture");
      await ctx.db.patch("forumCategories", thread.categoryId, {
        parentCategoryId: thread.categoryId,
      });
    });
    expect(
      (await t.withIdentity({ subject: seed.owner }).action(snapshot, window))
        .outcomes.sampledThreadCount,
    ).toBe(0);
    await t.run(async (ctx) => {
      const thread = await ctx.db.get("forumThreads", seed.agentThread);
      if (!thread) throw new Error("Missing fixture");
      await ctx.db.patch("forumCategories", thread.categoryId, {
        parentCategoryId: undefined,
        viewAccess: undefined,
      });
    });
    expect((await t.query(queue, window)).items).toHaveLength(0);
  });
  test("returns immutable current edit snapshots for internal-agent defects only, without public writes", async () => {
    const t = setup(),
      seed = await fixture(t);
    const before = await t.run((ctx) =>
      ctx.db.get("forumThreads", seed.agentThread),
    );
    const result = await t.query(queue, window);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      threadId: seed.agentThread,
      agentSlug: "helper",
      sourceVerification: "not_performed",
      issues: [{ code: "empty_section" }],
      snapshot: {
        bodyHash: await sha256Base64Url(before!.body),
        titleHash: await sha256Base64Url(before!.title),
        editCount: 0,
        lastEditedAt: null,
        updatedAt: 2000,
        status: "locked",
      },
    });
    expect(
      await t.run((ctx) => ctx.db.get("forumThreads", seed.agentThread)),
    ).toEqual(before);
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", seed.agentThread, {
        editCount: 1,
        lastEditedAt: 4500,
        lastEditedBy: seed.owner,
        lastEditReason: "Reviewed the incomplete section",
        updatedAt: 4500,
      }),
    );
    expect((await t.query(queue, window)).items[0].snapshot).toMatchObject({
      bodyHash: await sha256Base64Url(before!.body),
      editCount: 1,
      lastEditedAt: 4500,
      lastEditedBy: seed.owner,
      lastEditReason: "Reviewed the incomplete section",
      updatedAt: 4500,
    });
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", seed.agentThread, {
        body: "A repaired complete section.",
        editCount: 2,
        lastEditedAt: 5000,
        updatedAt: 5000,
      }),
    );
    expect((await t.query(queue, window)).items).toHaveLength(0);
  });
});
