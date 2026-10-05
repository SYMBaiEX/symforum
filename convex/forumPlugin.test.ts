/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import aggregateTest from "@convex-dev/aggregate/test";
import agentTest from "@convex-dev/agent/test";
import presenceTest from "@convex-dev/presence/test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import {
  WORKOS_PLUGIN_GRANT_CLAIM,
  WORKOS_PLUGIN_RESOURCE_CLAIM,
  WORKOS_PLUGIN_KIND_CLAIM,
} from "../lib/workos-config";
import schema from "./schema";
import { api } from "./_generated/api";
import { FORUM_USAGE_POLICY } from "../lib/forum-usage-policy";
import type { Id } from "./_generated/dataModel";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const executeRef = makeFunctionReference<"mutation">("forumPlugin:execute");
const readRef = makeFunctionReference<"mutation">("forumPlugin:read");
const approveRef = makeFunctionReference<"mutation">(
  "forumPlugin:approveCommand",
);
const rejectRef = makeFunctionReference<"mutation">(
  "forumPlugin:rejectCommand",
);
const listRef = makeFunctionReference<"query">("forumPlugin:listCommands");
const pendingContentRef = makeFunctionReference<"query">(
  "forumPlugin:listMyPendingContent",
);
const uploadRef = makeFunctionReference<"mutation">(
  "forumPlugin:claimPluginAttachmentUpload",
);
function setup() {
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  agentTest.register(t);
  presenceTest.register(t);
  return t;
}
async function exhaustEvidenceBudget(
  t: ReturnType<typeof setup>,
  owner: Id<"users">,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    const monthKey = new Date(now).toISOString().slice(0, 7);
    await ctx.db.insert("agentQuotaBudgets", {
      ownerUserId: owner,
      monthKey,
      freeAllowanceUnits: 100,
      hardCapUnits: 1000,
      usedUnits: 1000,
      hardCapMetadataJson: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("agentQuotaUsageCounters", {
      ownerUserId: owner,
      agentId: "helper",
      monthKey,
      usedUnits: 250,
      updatedAt: now,
    });
  });
}
async function fixture(
  t: ReturnType<typeof setup>,
  mode: "human" | "agent" = "agent",
  review = false,
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const owner = await ctx.db.insert("users", {
      username: "owner",
      usernameNormalized: "owner",
      forumTrustedAt: now,
    });
    const stranger = await ctx.db.insert("users", {
      username: "stranger",
      usernameNormalized: "stranger",
      forumTrustedAt: now,
    });
    const agent = await ctx.db.insert("users", {
      username: "helper",
      usernameNormalized: "helper",
      role: "reader",
      isAgent: true,
      agentSlug: "helper",
      agentStatus: "active",
      agentScopes: ["forum"],
      agentKeyVersion: 1,
    });
    const credential = await ctx.db.insert("agentIdentities", {
      agentId: "helper",
      userId: agent,
      ownerUserId: owner,
      credentialKind: "oauth",
      scopes: ["forum"],
      status: "active",
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const connectionId = await ctx.db.insert("forumPluginConnections", {
      ownerUserId: owner,
      credentialAgentIdentityId: credential,
      actorUserId: mode === "human" ? owner : agent,
      actorMode: mode,
      transport: "browser",
      kind: "forum-plugin",
      resource: "https://www.symbaiex.com/api/plugin/mcp",
      issuer: "https://convex.test",
      keyVersion: 1,
      capabilities: [
        "read",
        "participate",
        "personal",
        "feedback",
        "attachments",
        "messages",
        "moderate",
        "administer",
        "accounts",
      ],
      capabilityCeiling: [
        "read",
        "participate",
        "personal",
        "feedback",
        "attachments",
        "messages",
        "moderate",
        "administer",
        "accounts",
      ],
      executionMode: review ? "review" : "direct",
      policyVersion: 1,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const board = await ctx.db.insert("forumCategories", {
      slug: "square",
      name: "Square",
      description: "Forum board",
      kind: "board",
      status: "active",
      viewAccess: "public",
      threadAccess: "trusted",
      replyAccess: "trusted",
      pollAccess: "trusted",
      position: 1,
      threadCount: 1,
      postCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    const thread = await ctx.db.insert("forumThreads", {
      categoryId: board,
      categorySlug: "square",
      slug: "discussion",
      title: "Discussion",
      body: "Discussion body",
      authorId: stranger,
      status: "active",
      pinned: false,
      replyCount: 0,
      viewCount: 0,
      lastPostAt: now,
      lastPostUserId: stranger,
      searchText: "Discussion",
      createdAt: now,
      updatedAt: now,
    });
    const poll = await ctx.db.insert("forumPolls", {
      threadId: thread,
      categoryId: board,
      question: "Choose?",
      status: "open",
      optionCount: 2,
      totalVotes: 0,
      createdAt: now,
      updatedAt: now,
    });
    const option = await ctx.db.insert("forumPollOptions", {
      pollId: poll,
      threadId: thread,
      label: "One",
      position: 1,
      voteCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    const otherOption = await ctx.db.insert("forumPollOptions", {
      pollId: poll,
      threadId: thread,
      label: "Two",
      position: 2,
      voteCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    return {
      owner,
      agent,
      stranger,
      credential,
      connectionId,
      board,
      thread,
      poll,
      option,
      otherOption,
    };
  });
}
function call(
  seed: Awaited<ReturnType<typeof fixture>>,
  operation: string,
  args: Record<string, unknown>,
  idempotencyKey = "one",
) {
  return {
    connectionId: seed.connectionId,
    expectedPolicyVersion: 1,
    operation,
    args,
    idempotencyKey,
  };
}

describe("forum plugin domain transactions", () => {
  test("reply publication receipts retain the canonical post target after editing", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    const reply = await owner.mutation(
      executeRef,
      call(
        seed,
        "createReply",
        {
          threadId: seed.thread,
          body: "A published reply.",
        },
        "reply-first",
      ),
    );
    expect(reply.publicationStatus).toBe("published");
    expect(reply.url).toBe(
      `https://forum.symbaiex.com/square/discussion#post-${reply.data.postNumber}`,
    );
    const edited = await owner.mutation(
      executeRef,
      call(
        seed,
        "updatePostContent",
        {
          postId: reply.data.postId,
          body: "A revised published reply.",
        },
        "reply-edit",
      ),
    );
    expect(edited.publicationStatus).toBe("published");
    expect(edited.url).toBe(reply.url);
  });
  test.each(["agent", "human"] as const)(
    "posts as %s without monthly charges, preserves first-party author",
    async (mode) => {
      const t = setup();
      const seed = await fixture(t, mode);
      await exhaustEvidenceBudget(t, seed.owner);
      const owner = t.withIdentity({ subject: seed.owner });
      const input = call(seed, "createThread", {
        categorySlug: "square",
        title: "Plugin discussion",
        body: "A useful community question.",
      });
      const first = await owner.mutation(executeRef, input);
      expect(first.status).toBe("completed");
      expect(first.data.status).toBe("active");
      expect(first.publicationStatus).toBe("published");
      expect(first.message).toBe("Published in the forum.");
      expect(first.url).toBe(
        "https://forum.symbaiex.com/square/plugin-discussion",
      );
      const second = await owner.mutation(executeRef, input);
      expect(second).toEqual(first);
      await t.run(async (ctx) => {
        const threads = await ctx.db.query("forumThreads").collect();
        expect(threads).toHaveLength(2);
        expect(
          threads.find((row) => row._id === first.data.threadId)?.authorId,
        ).toBe(mode === "human" ? seed.owner : seed.agent);
        expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
        expect(
          (await ctx.db.query("agentQuotaBudgets").unique())?.usedUnits,
        ).toBe(1000);
        expect(
          (await ctx.db.query("agentQuotaUsageCounters").unique())?.usedUnits,
        ).toBe(250);
        expect((await ctx.db.get("users", seed.agent))?.role).toBe("reader");
      });
      await expect(
        owner.mutation(executeRef, {
          ...input,
          args: { ...input.args, title: "Changed payload" },
        }),
      ).rejects.toThrow("different command");
    },
  );
  test("invalid arguments, forged identity, cross-table IDs and failed writes leave no receipts or quota", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    await expect(
      owner.mutation(
        executeRef,
        call(seed, "setThreadBookmark", {
          threadId: seed.thread,
          saved: true,
          userId: seed.stranger,
        }),
      ),
    ).rejects.toThrow("not allowed");
    await expect(
      owner.mutation(
        executeRef,
        call(seed, "setThreadBookmark", { threadId: seed.board, saved: true }),
      ),
    ).rejects.toThrow("Invalid forumThreads");
    await expect(
      owner.mutation(
        executeRef,
        call(seed, "createReply", { threadId: seed.thread, body: "" }),
      ),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumPluginCommands").collect()).toHaveLength(
        0,
      );
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
      expect(await ctx.db.query("agentQuotaBudgets").collect()).toHaveLength(0);
    });
    await expect(
      t.withIdentity({ subject: seed.stranger }).mutation(
        executeRef,
        call(seed, "setThreadBookmark", {
          threadId: seed.thread,
          saved: true,
        }),
      ),
    ).rejects.toThrow("Connect an active");
  });
  test.each(["human", "agent"] as const)(
    "owner trust and both owner/agent restrictions apply in %s mode",
    async (mode) => {
      const t = setup();
      const seed = await fixture(t, mode);
      const owner = t.withIdentity({ subject: seed.owner });
      const trustedStatus = await owner.mutation(readRef, {
        connectionId: seed.connectionId,
        operation: "status",
        args: {},
      });
      expect(trustedStatus.data).toMatchObject({
        postingTrust: "trusted",
        ownerProfile: { userId: seed.owner, username: "owner" },
      });
      await t.run(async (ctx) => {
        await ctx.db.patch("users", seed.owner, {
          forumTrustRevokedAt: Date.now(),
          forumTrustedAt: undefined,
        });
        await ctx.db.patch("forumCategories", seed.board, {
          threadAccess: "members",
        });
      });
      const moderatedStatus = await owner.mutation(readRef, {
        connectionId: seed.connectionId,
        operation: "status",
        args: {},
      });
      expect(moderatedStatus.data.postingTrust).toBe("moderated");
      expect(moderatedStatus.data.postingNotice).toContain(
        "even in Direct execution",
      );
      const pending = await owner.mutation(
        executeRef,
        call(seed, "createThread", {
          categorySlug: "square",
          title: "Pending post",
          body: "Please review this post.",
        }),
      );
      expect(pending.data.status).toBe("pending");
      expect(pending).toMatchObject({
        status: "completed",
        publicationStatus: "pending_moderation",
        pendingContentUrl:
          "https://forum.symbaiex.com/control-panel/agent-access#moderation-queue",
        moderationUrl: "https://forum.symbaiex.com/moderation",
      });
      expect(pending.message).toContain("not published yet");
      await t.run(async (ctx) =>
        ctx.db.patch("users", seed.agent, { forumBannedAt: Date.now() }),
      );
      await expect(
        owner.mutation(
          executeRef,
          call(
            seed,
            "setThreadBookmark",
            { threadId: seed.thread, saved: true },
            "restricted",
          ),
        ),
      ).rejects.toThrow("restricted");
    },
  );
  test("human owners find moderated content from owned profiles without gaining staff authority", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    await t.run(async (ctx) => {
      const now = Date.now();
      const restrictedBoard = await ctx.db.insert("forumCategories", {
        slug: "staff-only",
        name: "Staff",
        description: "Restricted",
        kind: "board",
        status: "active",
        viewAccess: "staff",
        position: 2,
        threadCount: 0,
        postCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      for (const [authorId, categoryId, slug] of [
        [seed.owner, seed.board, "human-pending"],
        [seed.agent, seed.board, "agent-pending"],
        [seed.stranger, seed.board, "stranger-pending"],
        [seed.agent, restrictedBoard, "hidden-agent-pending"],
      ] as const) {
        await ctx.db.insert("forumThreads", {
          authorId,
          categoryId,
          categorySlug: categoryId === seed.board ? "square" : "staff-only",
          slug,
          title: slug,
          body: "Sample pending content ".repeat(40),
          searchText: slug,
          status: "pending",
          pinned: false,
          replyCount: 0,
          viewCount: 0,
          lastPostAt: now,
          lastPostUserId: authorId,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.insert("forumPosts", {
        authorId: seed.agent,
        categoryId: seed.board,
        threadId: seed.thread,
        body: "Pending agent reply",
        postNumber: 2,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("forumPosts", {
        authorId: seed.owner,
        categoryId: seed.board,
        threadId: seed.thread,
        body: "Pending owner reply",
        postNumber: 3,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });
      // Historic submissions remain inspectable even after disconnecting an agent.
      await ctx.db.patch("agentIdentities", seed.credential, {
        status: "revoked",
      });
    });
    const result = await owner.query(pendingContentRef, {});
    expect(result.items).toHaveLength(4);
    expect(result.items.map((item: { title: string }) => item.title)).toEqual(
      expect.arrayContaining(["human-pending", "agent-pending", "Discussion"]),
    );
    expect(
      result.items.every((item: { body: string }) => item.body.length <= 500),
    ).toBe(true);
    expect(
      result.items.filter(
        (item: { actingAs: { isAgent: boolean } }) => item.actingAs.isAgent,
      ),
    ).toHaveLength(2);
    expect(
      result.items.every(
        (item: { categoryName: string }) => item.categoryName === "Square",
      ),
    ).toBe(true);
    await expect(t.query(pendingContentRef, {})).rejects.toThrow(
      "human account",
    );
    await expect(
      t.withIdentity({ subject: seed.agent }).query(pendingContentRef, {}),
    ).rejects.toThrow("human account");
    expect(
      (
        await t
          .withIdentity({ subject: seed.stranger })
          .query(pendingContentRef, {})
      ).items,
    ).toHaveLength(1);
    for (const status of ["hidden", "deleted", "pending"] as const) {
      await t.run(async (ctx) => {
        await ctx.db.patch("forumThreads", seed.thread, { status });
      });
      const withoutUnavailableParents = await owner.query(
        pendingContentRef,
        {},
      );
      expect(withoutUnavailableParents.items).toHaveLength(2);
      expect(
        withoutUnavailableParents.items.every(
          (item: { kind: string }) => item.kind === "thread",
        ),
      ).toBe(true);
      expect(
        withoutUnavailableParents.items.some(
          (item: { title: string }) => item.title === "Discussion",
        ),
      ).toBe(false);
    }
    await t.run(async (ctx) => {
      await ctx.db.patch("forumThreads", seed.thread, { status: "active" });
    });
    const hiddenParent = await t.run(
      async (ctx) =>
        (await ctx.db
          .query("forumCategories")
          .withIndex("by_slug", (q) => q.eq("slug", "staff-only"))
          .unique())!._id,
    );
    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", seed.board, {
        parentCategoryId: hiddenParent,
      });
    });
    expect((await owner.query(pendingContentRef, {})).items).toHaveLength(0);
    await t.run(async (ctx) => {
      await ctx.db.patch("forumCategories", seed.board, {
        parentCategoryId: undefined,
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("users", seed.agent, { forumBannedAt: Date.now() });
    });
    expect((await owner.query(pendingContentRef, {})).items).toHaveLength(2);
    await t.run(async (ctx) => {
      await ctx.db.patch("users", seed.owner, {
        forumSuspendedUntil: Date.now() + 60_000,
      });
    });
    expect(await owner.query(pendingContentRef, {})).toEqual({
      items: [],
      limited: false,
      restricted: true,
    });
  });
  test("owner pending content inspection reports a bounded scan instead of claiming a complete queue", async () => {
    const t = setup();
    const seed = await fixture(t, "human");
    await t.run(async (ctx) => {
      for (let index = 0; index < 25; index++) {
        const now = Date.now() + index;
        await ctx.db.insert("forumPosts", {
          authorId: seed.owner,
          categoryId: seed.board,
          threadId: seed.thread,
          body: `Pending ${index}`,
          postNumber: index + 2,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const result = await t
      .withIdentity({ subject: seed.owner })
      .query(pendingContentRef, {});
    expect(result.items).toHaveLength(12);
    expect(result.limited).toBe(true);
    expect(result.items[0].body).toBe("Pending 24");
  });
  test("owner queue bounds full-size thread and reply reads before returning excerpts", async () => {
    const t = setup();
    const seed = await fixture(t, "human");
    await t.run(async (ctx) => {
      const body = "\u0800".repeat(64_000);
      for (let index = 0; index < 20; index++) {
        const now = Date.now() + index;
        const common = {
          authorId: seed.owner,
          categoryId: seed.board,
          categorySlug: "square",
          body,
          searchText: body,
          pinned: false,
          replyCount: 0,
          viewCount: 0,
          lastPostAt: now,
          lastPostUserId: seed.owner,
          createdAt: now,
          updatedAt: now,
        };
        await ctx.db.insert("forumThreads", {
          ...common,
          slug: `large-pending-${index}`,
          title: "Large pending thread",
          status: "pending",
        });
        const parent = await ctx.db.insert("forumThreads", {
          ...common,
          authorId: seed.stranger,
          slug: `large-parent-${index}`,
          title: "Large reply parent",
          status: "active",
        });
        await ctx.db.insert("forumPosts", {
          authorId: seed.owner,
          categoryId: seed.board,
          threadId: parent,
          body: body.slice(0, 32_000),
          postNumber: 2,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const result = await t
      .withIdentity({ subject: seed.owner })
      .query(pendingContentRef, {});
    expect(result.items).toHaveLength(24);
    expect(
      result.items.filter((item: { kind: string }) => item.kind === "thread"),
    ).toHaveLength(12);
    expect(
      result.items.filter((item: { kind: string }) => item.kind === "reply"),
    ).toHaveLength(12);
    expect(
      result.items.every((item: { body: string }) => item.body.length === 500),
    ).toBe(true);
    expect(result.limited).toBe(true);
  });
  test("multiple selected agents share one owner vote and cannot rate sibling content", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    await owner.mutation(
      executeRef,
      call(
        seed,
        "votePoll",
        { pollId: seed.poll, optionId: seed.option },
        "vote",
      ),
    );
    await t.run(async (ctx) => {
      const votes = await ctx.db.query("forumPollVotes").collect();
      expect(votes).toHaveLength(1);
      expect(votes[0].userId).toBe(seed.owner);
    });
    await expect(
      owner.mutation(
        executeRef,
        call(
          seed,
          "votePoll",
          { pollId: seed.poll, optionId: seed.otherOption },
          "other-vote",
        ),
      ),
    ).rejects.toThrow("already voted");
    await t.run(async (ctx) =>
      ctx.db.patch("forumThreads", seed.thread, { authorId: seed.agent }),
    );
    await expect(
      owner.mutation(
        executeRef,
        call(seed, "rateThread", { threadId: seed.thread, score: 5 }, "rating"),
      ),
    ).rejects.toThrow("own thread");
  });
  test("staff delegation uses current owner and board assignments without agent roles", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    await expect(
      owner.mutation(readRef, {
        idempotencyKey: "test-read",
        connectionId: seed.connectionId,
        operation: "listForumReports",
        args: {},
      }),
    ).rejects.toThrow("permit moderate");
    await t.run(async (ctx) =>
      ctx.db.insert("forumCategoryModerators", {
        userId: seed.owner,
        categoryId: seed.board,
        assignedBy: seed.stranger,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    const reports = await owner.mutation(readRef, {
      idempotencyKey: "test-read",
      connectionId: seed.connectionId,
      operation: "listForumReports",
      args: {},
    });
    expect(reports.status).toBe("completed");
    await expect(
      owner.mutation(readRef, {
        idempotencyKey: "test-read",
        connectionId: seed.connectionId,
        operation: "listUsers",
        args: {},
      }),
    ).rejects.toThrow("permit accounts");
  });
  test("review queues immutable proposals, approves once, and detects changed policy/targets", async () => {
    const t = setup();
    const seed = await fixture(t, "agent", true);
    await exhaustEvidenceBudget(t, seed.owner);
    const owner = t.withIdentity({ subject: seed.owner });
    const proposal = await owner.mutation(
      executeRef,
      call(seed, "setThreadBookmark", { threadId: seed.thread, saved: true }),
    );
    expect(proposal.status).toBe("pending_approval");
    expect(proposal.approvalUrl).toBe(
      `https://forum.symbaiex.com/control-panel/agent-access?commandId=${proposal.commandId}#review-queue`,
    );
    expect(proposal.message).toContain("has not executed");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumThreadBookmarks").collect()).toHaveLength(
        0,
      );
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
    const approved = await owner.mutation(approveRef, {
      commandId: proposal.commandId,
    });
    expect(approved.status).toBe("completed");
    expect(
      await owner.mutation(approveRef, { commandId: proposal.commandId }),
    ).toEqual(approved);
    const stale = await owner.mutation(
      executeRef,
      call(
        seed,
        "setThreadSubscription",
        { threadId: seed.thread, subscribed: true },
        "stale",
      ),
    );
    await t.run(async (ctx) =>
      ctx.db.patch("forumThreads", seed.thread, {
        title: "Updated by another member",
      }),
    );
    expect(
      (await owner.mutation(approveRef, { commandId: stale.commandId })).data
        .state,
    ).toBe("invalidated");
    const policy = await owner.mutation(
      executeRef,
      call(
        seed,
        "setThreadBookmark",
        { threadId: seed.thread, saved: false },
        "policy",
      ),
    );
    await t.run(async (ctx) =>
      ctx.db.patch("forumPluginConnections", seed.connectionId, {
        policyVersion: 2,
        executionMode: "direct",
      }),
    );
    expect(
      (await owner.query(listRef, {})).find(
        (row: Record<string, unknown>) => row._id === policy.commandId,
      ).status,
    ).toBe("invalidated");
    expect(
      (await owner.mutation(approveRef, { commandId: policy.commandId })).data
        .state,
    ).toBe("invalidated");
    await expect(
      owner.mutation(executeRef, {
        ...call(
          seed,
          "setThreadBookmark",
          { threadId: seed.thread, saved: false },
          "old-registry",
        ),
        expectedPolicyVersion: 1,
      }),
    ).rejects.toThrow("policy changed");
    await expect(
      t
        .withIdentity({ subject: seed.agent })
        .mutation(approveRef, { commandId: policy.commandId }),
    ).rejects.toThrow("human account");
  });
  test("private messages use actor inbox and recipient blocks apply to sibling credentials", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    const sent = await owner.mutation(
      executeRef,
      call(seed, "sendPrivateMessage", {
        recipientUsername: "stranger",
        subject: "Hello",
        body: "A private note.",
      }),
    );
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.get("forumPrivateMessages", sent.data.messageId))
          ?.senderUserId,
      ).toBe(seed.agent);
    });
    await t.run(async (ctx) =>
      ctx.db.insert("forumUserRelationships", {
        userId: seed.stranger,
        targetUserId: seed.owner,
        kind: "ignore",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    );
    await expect(
      owner.mutation(
        executeRef,
        call(
          seed,
          "sendPrivateMessage",
          {
            recipientUsername: "stranger",
            subject: "Other",
            body: "Blocked note.",
          },
          "blocked",
        ),
      ),
    ).rejects.toThrow("not accepting");
  });
  test("upload relay staging respects review and replays retain original blob; public storage claims denied", async () => {
    const t = setup();
    const seed = await fixture(t, "agent", true);
    await exhaustEvidenceBudget(t, seed.owner);
    const owner = t.withIdentity({ subject: seed.owner });
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["hello"], { type: "text/plain" })),
    );
    const input = {
      verifiedResource: "https://www.symbaiex.com/api/plugin/mcp",
      connectionId: seed.connectionId,
      storageId,
      filename: "hello.txt",
      contentType: "text/plain",
      idempotencyKey: "upload",
      contentHash: "a".repeat(64),
    };
    const pending = await owner.mutation(uploadRef, input);
    expect(pending.status).toBe("pending_approval");
    expect(pending.retainedStorageId).toBe(storageId);
    const other = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["hello"], { type: "text/plain" })),
    );
    expect(
      (await owner.mutation(uploadRef, { ...input, storageId: other }))
        .retainedStorageId,
    ).toBe(storageId);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumPendingUploads").collect()).toHaveLength(
        0,
      );
    });
    const result = await owner.mutation(approveRef, {
      commandId: pending.commandId,
    });
    expect(result.status).toBe("completed");
    await t.run(async (ctx) => {
      expect(
        (await ctx.db.query("forumPendingUploads").collect())[0].userId,
      ).toBe(seed.agent);
    });
    await expect(
      owner.mutation(
        executeRef,
        call(
          seed,
          "claimStoredForumAttachmentUpload",
          {
            storageId: other,
            filename: "hello.txt",
            contentType: "text/plain",
          },
          "forged-upload",
        ),
      ),
    ).rejects.toThrow("not available");
  });
  test("expiry and rejection never execute a staged command", async () => {
    const t = setup();
    const seed = await fixture(t, "human", true);
    const owner = t.withIdentity({ subject: seed.owner });
    const proposal = await owner.mutation(
      executeRef,
      call(seed, "setThreadBookmark", { threadId: seed.thread, saved: true }),
    );
    await owner.mutation(rejectRef, { commandId: proposal.commandId });
    await expect(
      owner.mutation(approveRef, { commandId: proposal.commandId }),
    ).rejects.toThrow("rejected");
    const expired = await owner.mutation(
      executeRef,
      call(
        seed,
        "setThreadBookmark",
        { threadId: seed.thread, saved: true },
        "expiry",
      ),
    );
    await t.run(async (ctx) =>
      ctx.db.patch(
        "forumPluginCommands",
        expired.commandId as Id<"forumPluginCommands">,
        { expiresAt: Date.now() - 1 },
      ),
    );
    expect(
      (await owner.mutation(approveRef, { commandId: expired.commandId })).data
        .state,
    ).toBe("expired");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumThreadBookmarks").collect()).toHaveLength(
        0,
      );
    });
  });
});

describe("forum plugin failure integrity", () => {
  test("exhausted evidence budget does not block forum writes", async () => {
    const t = setup();
    const seed = await fixture(t, "human");
    const owner = t.withIdentity({ subject: seed.owner });
    await t.run(async (ctx) => {
      const now = Date.now();
      const monthKey = new Date(now).toISOString().slice(0, 7);
      await ctx.db.insert("agentQuotaBudgets", {
        ownerUserId: seed.owner,
        monthKey,
        freeAllowanceUnits: 0,
        hardCapUnits: 0,
        usedUnits: 0,
        hardCapMetadataJson: "{}",
        createdAt: now,
        updatedAt: now,
      });
    });
    expect(
      (
        await owner.mutation(
          executeRef,
          call(seed, "setThreadBookmark", {
            threadId: seed.thread,
            saved: true,
          }),
        )
      ).status,
    ).toBe("completed");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumThreadBookmarks").collect()).toHaveLength(
        1,
      );
      expect(await ctx.db.query("forumPluginCommands").collect()).toHaveLength(
        1,
      );
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
  });
  test("owner PM sending ceiling holds across selected human and agent profiles", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    await owner.mutation(
      executeRef,
      call(seed, "sendPrivateMessage", {
        recipientUsername: "stranger",
        subject: "First",
        body: "First message",
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.patch("forumPluginConnections", seed.connectionId, {
        actorMode: "human",
        actorUserId: seed.owner,
        policyVersion: 2,
      }),
    );
    await expect(
      owner.mutation(executeRef, {
        ...call(
          seed,
          "sendPrivateMessage",
          {
            recipientUsername: "stranger",
            subject: "Second",
            body: "Second profile message",
          },
          "second",
        ),
        expectedPolicyVersion: 2,
      }),
    ).rejects.toThrow("owner's inbox");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumPrivateMessages").collect()).toHaveLength(
        1,
      );
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    });
  });
  test("review attachments are actor-owned and staging is removed after rejection", async () => {
    const t = setup();
    const seed = await fixture(t, "agent", true);
    const owner = t.withIdentity({ subject: seed.owner });
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["staged"], { type: "text/plain" })),
    );
    const proposal = await owner.mutation(uploadRef, {
      verifiedResource: "https://www.symbaiex.com/api/plugin/mcp",
      connectionId: seed.connectionId,
      storageId,
      filename: "staged.txt",
      contentType: "text/plain",
      idempotencyKey: "stage",
      contentHash: "b".repeat(64),
    });
    await owner.mutation(rejectRef, { commandId: proposal.commandId });
    await t.mutation(
      makeFunctionReference<"mutation">(
        "forumPlugin:cleanupStagedPluginUpload",
      ),
      { commandId: proposal.commandId },
    );
    await t.run(async (ctx) => {
      expect(await ctx.storage.get(storageId)).toBe(null);
    });
    const foreign = await t.run(async (ctx) => {
      const id = await ctx.storage.store(
        new Blob(["foreign"], { type: "text/plain" }),
      );
      await ctx.db.insert("forumPendingUploads", {
        userId: seed.stranger,
        storageId: id,
        filename: "foreign.txt",
        contentType: "text/plain",
        size: 7,
        status: "pending",
        expiresAt: Date.now() + 3600000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return id;
    });
    await expect(
      owner.mutation(
        executeRef,
        call(
          seed,
          "createThread",
          {
            categorySlug: "square",
            title: "Foreign file",
            body: "This should be denied.",
            attachments: [{ storageId: foreign, filename: "foreign.txt" }],
          },
          "foreign",
        ),
      ),
    ).rejects.toThrow("owned by the acting profile");
  });
  test("unrelated board counters do not invalidate a reviewed post", async () => {
    const t = setup();
    const seed = await fixture(t, "human", true);
    const owner = t.withIdentity({ subject: seed.owner });
    const proposal = await owner.mutation(
      executeRef,
      call(seed, "createThread", {
        categorySlug: "square",
        title: "Reviewed discussion",
        body: "A discussion worth reviewing.",
      }),
    );
    await t.run(async (ctx) =>
      ctx.db.patch("forumCategories", seed.board, {
        threadCount: 12,
        postCount: 20,
        updatedAt: Date.now() + 1,
      }),
    );
    expect(
      (await owner.mutation(approveRef, { commandId: proposal.commandId }))
        .status,
    ).toBe("completed");
  });
});

test("public browser reads never inherit first-party identity or personal state", async () => {
  const t = setup();
  const seed = await fixture(t);
  const owner = t.withIdentity({ subject: seed.owner });
  await owner.mutation(
    executeRef,
    call(seed, "setThreadBookmark", { threadId: seed.thread, saved: true }),
  );
  const anonymous = await owner.mutation(readRef, {
    idempotencyKey: "test-read",
    operation: "getThread",
    args: { categorySlug: "square", threadSlug: "discussion" },
  });
  expect(anonymous.actingAs).toBe(null);
  expect(
    anonymous.data.viewer?.isBookmarked ?? anonymous.data.isBookmarked ?? false,
  ).toBe(false);
  await t.run(async (ctx) =>
    ctx.db.patch("forumCategories", seed.board, { viewAccess: "trusted" }),
  );
  await expect(
    owner.mutation(readRef, {
      idempotencyKey: "test-read",
      operation: "getThread",
      args: { categorySlug: "square", threadSlug: "discussion" },
    }),
  ).rejects.toThrow("not available");
  await expect(
    owner.query(makeFunctionReference<"query">("forumPlugin:publicRead"), {
      operation: "getThread",
      args: { categorySlug: "square", threadSlug: "discussion" },
    }),
  ).rejects.toThrow("not available");
});
test("connection status is available through the shared WebMCP read dispatcher", async () => {
  const t = setup();
  const seed = await fixture(t);
  const owner = t.withIdentity({ subject: seed.owner });
  const result = await owner.mutation(readRef, {
    idempotencyKey: "test-read",
    connectionId: seed.connectionId,
    operation: "status",
    args: {},
    expectedPolicyVersion: 1,
  });
  expect(result.data.connectionId).toBe(seed.connectionId);
  expect(result.data.policyVersion).toBe(1);
  expect(result.actingAs.userId).toBe(seed.agent);
  await expect(
    owner.mutation(readRef, {
      idempotencyKey: "test-read",
      connectionId: seed.connectionId,
      operation: "status",
      args: {},
      expectedPolicyVersion: 0,
    }),
  ).rejects.toThrow("policy changed");
});
test("proposal admission is bounded and duplicate retries do not consume admission capacity", async () => {
  const t = setup();
  const seed = await fixture(t, "human", true);
  const owner = t.withIdentity({ subject: seed.owner });
  const input = call(seed, "setThreadBookmark", {
    threadId: seed.thread,
    saved: true,
  });
  const first = await owner.mutation(executeRef, input);
  for (let i = 0; i < 12; i++)
    expect((await owner.mutation(executeRef, input)).commandId).toBe(
      first.commandId,
    );
  for (let i = 1; i < 10; i++)
    await owner.mutation(executeRef, {
      ...input,
      idempotencyKey: `proposal-${i}`,
    });
  await expect(
    owner.mutation(executeRef, { ...input, idempotencyKey: "limited" }),
  ).rejects.toThrow("rate limited");
  await t.run(async (ctx) => {
    expect(await ctx.db.query("forumPluginCommands").collect()).toHaveLength(
      10,
    );
    expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    for (let i = 0; i < 10; i++)
      await ctx.db.insert("forumPluginCommands", {
        connectionId: seed.connectionId,
        ownerUserId: seed.owner,
        actorUserId: seed.owner,
        operation: "setThreadBookmark",
        idempotencyKey: `seed-${i}`,
        fingerprint: "seed",
        argsJson: "{}",
        policyVersion: 1,
        status: "pending",
        createdAt: Date.now(),
        expiresAt: Date.now() + 86400000,
      });
  });
  await expect(
    owner.mutation(executeRef, { ...input, idempotencyKey: "count-limited" }),
  ).rejects.toThrow("20 per connection");
});
test("ignore on a recipient sibling profile blocks messages to the whole recipient owner group", async () => {
  const t = setup();
  const seed = await fixture(t);
  const owner = t.withIdentity({ subject: seed.owner });
  await t.run(async (ctx) => {
    const now = Date.now();
    const recipientAgent = await ctx.db.insert("users", {
      username: "recipient-helper",
      usernameNormalized: "recipient-helper",
      isAgent: true,
      agentStatus: "active",
      agentKeyVersion: 1,
      agentScopes: ["forum"],
    });
    await ctx.db.insert("agentIdentities", {
      agentId: "recipient-helper",
      userId: recipientAgent,
      ownerUserId: seed.stranger,
      credentialKind: "oauth",
      scopes: ["forum"],
      status: "active",
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("forumUserRelationships", {
      userId: recipientAgent,
      targetUserId: seed.agent,
      kind: "ignore",
      createdAt: now,
      updatedAt: now,
    });
  });
  await expect(
    owner.mutation(
      executeRef,
      call(seed, "sendPrivateMessage", {
        recipientUsername: "stranger",
        subject: "Cannot bypass",
        body: "Blocked group.",
      }),
    ),
  ).rejects.toThrow("not accepting");
  await t.run(async (ctx) => {
    expect(await ctx.db.query("forumPrivateMessages").collect()).toHaveLength(
      0,
    );
    expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
  });
});

test("OAuth principals cannot invoke public browser entrypoints and internal execution requires transport proof", async () => {
  vi.stubEnv("WORKOS_CONNECT_ENABLED", "true");
  vi.stubEnv("WORKOS_AUTHKIT_ISSUER", "https://runtime-plugin.authkit.app");
  vi.stubEnv("WORKOS_API_KEY", "test-only");
  const t = setup();
  const seed = await fixture(t);
  await t.run(async (ctx) =>
    ctx.db.patch("forumPluginConnections", seed.connectionId, {
      transport: "oauth",
      issuer: "https://runtime-plugin.authkit.app",
      subject: seed.owner,
    }),
  );
  const resource = "https://www.symbaiex.com/api/plugin/mcp";
  const oauth = t.withIdentity({
    issuer: "https://runtime-plugin.authkit.app",
    subject: seed.owner,
    [WORKOS_PLUGIN_GRANT_CLAIM]: seed.connectionId,
    [WORKOS_PLUGIN_RESOURCE_CLAIM]: resource,
    [WORKOS_PLUGIN_KIND_CLAIM]: "forum-plugin",
  });
  const input = call(seed, "setThreadBookmark", {
    threadId: seed.thread,
    saved: true,
  });
  await expect(oauth.mutation(executeRef, input)).rejects.toThrow(
    "human account",
  );
  await expect(
    oauth.mutation(readRef, {
      idempotencyKey: "test-read",
      connectionId: seed.connectionId,
      operation: "getMyForumProfile",
      args: {},
    }),
  ).rejects.toThrow("human account");
  const remote = makeFunctionReference<"mutation">("forumPlugin:remoteExecute");
  await expect(oauth.mutation(remote, input)).rejects.toThrow(
    "verifiedResource",
  );
  await expect(
    oauth.mutation(remote, { ...input, verifiedResource: resource }),
  ).rejects.toThrow("Connect an active");
  const result = await t.mutation(remote, {
    ...input,
    verifiedResource: resource,
    verifiedOAuthPrincipal: {
      issuer: "https://runtime-plugin.authkit.app",
      subject: seed.owner,
      grantId: seed.connectionId,
    },
  });
  expect(result.status).toBe("completed");
});

test("board staff writes use owner assignment and deny a different board atomically", async () => {
  const t = setup();
  const seed = await fixture(t);
  const owner = t.withIdentity({ subject: seed.owner });
  const otherThread = await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("forumCategoryModerators", {
      userId: seed.owner,
      categoryId: seed.board,
      assignedBy: seed.stranger,
      createdAt: now,
      updatedAt: now,
    });
    const board = await ctx.db.get("forumCategories", seed.board);
    const { _id, _creationTime, ...fields } = board!;
    const otherBoard = await ctx.db.insert("forumCategories", {
      ...fields,
      slug: "other-square",
      name: "Other Square",
    });
    const thread = await ctx.db.get("forumThreads", seed.thread);
    const { _id: threadId, _creationTime: created, ...record } = thread!;
    return ctx.db.insert("forumThreads", {
      ...record,
      categoryId: otherBoard,
      categorySlug: "other-square",
    });
  });
  await owner.mutation(
    executeRef,
    call(
      seed,
      "updateForumThreadModeration",
      { threadId: seed.thread, status: "locked" },
      "authorized-lock",
    ),
  );
  await expect(
    owner.mutation(
      executeRef,
      call(
        seed,
        "updateForumThreadModeration",
        { threadId: otherThread, status: "locked" },
        "forbidden-lock",
      ),
    ),
  ).rejects.toThrow("moderator access for this board");
  await t.run(async (ctx) => {
    expect((await ctx.db.get("forumThreads", seed.thread))?.status).toBe(
      "locked",
    );
    expect((await ctx.db.get("forumThreads", otherThread))?.status).toBe(
      "active",
    );
    expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    expect((await ctx.db.get("users", seed.agent))?.forumRole).toBeUndefined();
  });
});

test("a second owned agent shares the owner civic vote and sibling ratings are denied", async () => {
  const t = setup();
  const seed = await fixture(t);
  const owner = t.withIdentity({ subject: seed.owner });
  await owner.mutation(
    executeRef,
    call(
      seed,
      "votePoll",
      { pollId: seed.poll, optionId: seed.option },
      "first-vote",
    ),
  );
  const sibling = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      username: "sibling",
      usernameNormalized: "sibling",
      isAgent: true,
      agentSlug: "sibling",
      agentStatus: "active",
      agentKeyVersion: 1,
      agentScopes: ["forum"],
    });
    const identity = await ctx.db.insert("agentIdentities", {
      agentId: "sibling",
      userId,
      ownerUserId: seed.owner,
      credentialKind: "oauth",
      scopes: ["forum"],
      status: "active",
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    const connection = await ctx.db.get(
      "forumPluginConnections",
      seed.connectionId,
    );
    const { _id, _creationTime, ...record } = connection!;
    const connectionId = await ctx.db.insert("forumPluginConnections", {
      ...record,
      credentialAgentIdentityId: identity,
      actorUserId: userId,
    });
    return { connectionId, userId };
  });
  const repeat = await owner.mutation(executeRef, {
    ...call(
      seed,
      "votePoll",
      { pollId: seed.poll, optionId: seed.option },
      "second-agent-vote",
    ),
    connectionId: sibling.connectionId,
  });
  expect(repeat.data.voted).toBe(false);
  await t.run(async (ctx) => {
    const votes = await ctx.db.query("forumPollVotes").collect();
    expect(votes).toHaveLength(1);
    expect(votes[0].userId).toBe(seed.owner);
    await ctx.db.patch("forumThreads", seed.thread, {
      authorId: sibling.userId,
    });
  });
  await expect(
    owner.mutation(
      executeRef,
      call(
        seed,
        "rateThread",
        { threadId: seed.thread, score: 5 },
        "sibling-rating",
      ),
    ),
  ).rejects.toThrow("own thread");
});

test.each(["human", "agent"] as const)(
  "connected %s navigation and posting ignore evidence budgets while accepted reads remain rate bounded",
  async (mode) => {
    const t = setup();
    const seed = await fixture(t, mode);
    const owner = t.withIdentity({ subject: seed.owner });
    const now = Date.now();
    const monthKey = new Date(now).toISOString().slice(0, 7);
    await t.run(async (ctx) => {
      await ctx.db.insert("agentQuotaBudgets", {
        ownerUserId: seed.owner,
        monthKey,
        freeAllowanceUnits: 100,
        hardCapUnits: 1000,
        usedUnits: 1000,
        hardCapMetadataJson: '{"secret":true}',
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("agentQuotaUsageCounters", {
        ownerUserId: seed.owner,
        agentId: "helper",
        monthKey,
        usedUnits: 250,
        updatedAt: now,
      });
    });
    const input = {
      connectionId: seed.connectionId,
      expectedPolicyVersion: 1,
      operation: "getThread",
      args: { categorySlug: "square", threadSlug: "discussion" },
      idempotencyKey: "same-read-key",
    };
    for (let i = 0; i < 20; i++)
      expect((await owner.mutation(readRef, input)).status).toBe("completed");
    expect(
      (
        await owner.mutation(
          executeRef,
          call(seed, "createReply", {
            threadId: seed.thread,
            body: "Forum posting remains available",
          }),
        )
      ).publicationStatus,
    ).toBe("published");
    // A second owner connection shares the same short-term owner limit.
    const second = await t.run(async (ctx) => {
      const c = await ctx.db.get("forumPluginConnections", seed.connectionId);
      const { _id, _creationTime, ...copy } = c!;
      void _id;
      void _creationTime;
      return ctx.db.insert("forumPluginConnections", copy);
    });
    let rejected = false;
    for (let i = 0; i < 150; i++) {
      try {
        await owner.mutation(readRef, {
          ...input,
          connectionId: i % 2 ? second : seed.connectionId,
        });
      } catch (error) {
        expect(String(error)).toContain("read rate limit");
        rejected = true;
        break;
      }
    }
    expect(rejected).toBe(true);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
      expect(
        (await ctx.db.query("agentQuotaBudgets").unique())?.usedUnits,
      ).toBe(1000);
      expect(
        (await ctx.db.query("agentQuotaUsageCounters").unique())?.usedUnits,
      ).toBe(250);
      expect(await ctx.db.query("forumPluginCommands").collect()).toHaveLength(
        1,
      );
    });
  },
);

test.each(["human", "agent"] as const)(
  "%s connection status reports forum policy independently of exhausted evidence budgets",
  async (mode) => {
    const t = setup();
    const seed = await fixture(t, mode);
    const owner = t.withIdentity({ subject: seed.owner });
    const frozen = Date.UTC(2026, 11, 31, 23, 59, 59);
    const clock = vi.spyOn(Date, "now").mockReturnValue(frozen);
    try {
      const input = {
        connectionId: seed.connectionId,
        operation: "status",
        args: {},
      };
      const initial = await owner.mutation(readRef, input);
      expect(initial.data.usagePolicy).toEqual(FORUM_USAGE_POLICY);
      expect(initial.data).not.toHaveProperty("quota");
      await t.run(async (ctx) => {
        expect(await ctx.db.query("agentQuotaBudgets").collect()).toHaveLength(
          0,
        );
        expect(
          await ctx.db.query("agentQuotaUsageCounters").collect(),
        ).toHaveLength(0);
        await ctx.db.insert("agentQuotaBudgets", {
          ownerUserId: seed.owner,
          monthKey: "2026-12",
          freeAllowanceUnits: 100,
          hardCapUnits: 1000,
          usedUnits: 1000,
          hardCapMetadataJson: "private metadata",
          createdAt: frozen,
          updatedAt: frozen,
        });
        await ctx.db.insert("agentQuotaUsageCounters", {
          ownerUserId: seed.owner,
          agentId: "helper",
          monthKey: "2026-12",
          usedUnits: 250,
          updatedAt: frozen,
        });
      });
      const exhausted = await owner.mutation(readRef, input);
      expect(exhausted.data.usagePolicy).toEqual(FORUM_USAGE_POLICY);
      expect(exhausted.data).not.toHaveProperty("quota");
      expect(JSON.stringify(exhausted)).not.toContain("private metadata");
      await t.run(async (ctx) => {
        expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
        expect(
          (await ctx.db.query("agentQuotaBudgets").unique())?.usedUnits,
        ).toBe(1000);
        expect(
          (await ctx.db.query("agentQuotaUsageCounters").unique())?.usedUnits,
        ).toBe(250);
      });
    } finally {
      clock.mockRestore();
    }
  },
);


describe("forum community experience through delegated tools", () => {
  test("reviewed accepted answers execute once and invalidate changed targets", async () => {
    const t = setup(), seed = await fixture(t, "human", true);
    const postId = await t.run(async ctx => {
      await ctx.db.patch("forumThreads", seed.thread, { authorId: seed.owner, kind: "question" });
      return ctx.db.insert("forumPosts", { threadId: seed.thread, categoryId: seed.board, authorId: seed.stranger, body: "A useful answer", status: "active", postNumber: 2, createdAt: Date.now(), updatedAt: Date.now() });
    });
    const owner = t.withIdentity({ subject: seed.owner });
    const queued = await owner.mutation(executeRef, call(seed, "setAcceptedAnswer", { threadId: seed.thread, postId }, "accept-answer"));
    expect(queued.status).toBe("pending_approval");
    const approved = await owner.mutation(approveRef, { commandId: queued.commandId });
    expect(approved.status).toBe("completed");
    expect(await owner.mutation(approveRef, { commandId: queued.commandId })).toEqual(approved);
    await t.run(async ctx => {
      expect((await ctx.db.get("forumThreads", seed.thread))?.acceptedPostId).toBe(postId);
      const counters = await ctx.db.query("forumExperienceDailyCounters").collect();
      expect(counters.find(row => row.event === "answer_selected")).toMatchObject({ count: 1, actorKind: "assisted" });
    });
    const clear = await owner.mutation(executeRef, call(seed, "setAcceptedAnswer", { threadId: seed.thread, postId: null }, "clear-answer"));
    await t.run(ctx => ctx.db.patch("forumThreads", seed.thread, { status: "hidden" }));
    expect((await owner.mutation(approveRef, { commandId: clear.commandId })).data.state).toBe("invalidated");
  });
  test("human and owned-agent preferences remain separate and duplicate receipts do not recount events", async () => {
    const t = setup(), seed = await fixture(t, "agent");
    const owner = t.withIdentity({ subject: seed.owner });
    const command = call(seed, "updateMyForumExperience", { defaultFeed: "following", authorFilter: "humans" }, "agent-preferences");
    await owner.mutation(executeRef, command);
    await t.run(async ctx => {
      expect(await ctx.db.query("forumExperienceSettings").collect()).toMatchObject([{ userId: seed.agent, defaultFeed: "following" }]);
      await ctx.db.patch("forumPluginConnections", seed.connectionId, { actorUserId: seed.owner, actorMode: "human", policyVersion: 2 });
    });
    const prefs = await owner.mutation(readRef, { connectionId: seed.connectionId, operation: "getMyForumExperience", args: {} });
    expect(prefs.data.defaultFeed).toBe("discover");
    const event = { ...call(seed, "recordForumExperienceEvent", { event: "feed_open" }, "one-feed-visit"), expectedPolicyVersion: 2 };
    const result = await owner.mutation(executeRef, event);
    expect(await owner.mutation(executeRef, event)).toEqual(result);
    await t.run(async ctx => { expect(await ctx.db.query("forumExperienceDailyCounters").collect()).toMatchObject([{ event: "feed_open", count: 1, actorKind: "assisted" }]); });
  });
});

async function newsFixture(t:ReturnType<typeof setup>) {
 for(const component of ['interactionScores','interactionSaves','commentCounts'])aggregateTest.register(t,component);
 await t.run(async ctx=>{await ctx.db.insert('newsSnapshots',{snapshotDate:'2026-10-02',status:'complete',startedAt:1000,completedAt:2000,storyCount:1});await ctx.db.insert('hnStories',{hnItemId:41,snapshotDate:'2026-10-02',rank:1,title:'Shared voting identity',fetchedAt:2000});});
}
describe('native forum news tools',()=>{
 test('delegated news votes share the owner identity while saved state belongs to each actor',async()=>{
  const t=setup();const first=await fixture(t);const sibling=await fixture(t);await newsFixture(t);
  await t.run(async ctx=>{await ctx.db.patch('users',first.owner,{emailVerificationTime:Date.now()});await ctx.db.patch('agentIdentities',sibling.credential,{ownerUserId:first.owner});await ctx.db.patch('forumPluginConnections',sibling.connectionId,{ownerUserId:first.owner});});
  const owner=t.withIdentity({subject:first.owner});
  const input=call(first,'setNewsInteraction',{hnItemId:41,vote:1,saved:true},'news-save');
  const result=await owner.mutation(executeRef,input);expect(result.status).toBe('completed');expect(await owner.mutation(executeRef,input)).toEqual(result);
  await owner.mutation(executeRef,call(sibling,'setNewsInteraction',{hnItemId:41,vote:1,saved:false},'sibling-vote'));
  const rows=await t.run(ctx=>ctx.db.query('interactions').collect());
  expect(rows.filter(row=>row.vote===1)).toHaveLength(1);expect(rows.find(row=>row.vote===1)?.userId).toBe(first.owner);
  expect(rows.find(row=>row.userId===first.agent)?.saved).toBe(true);expect(rows.find(row=>row.userId===sibling.agent)?.saved??false).toBe(false);
  const state=await owner.mutation(readRef,{connectionId:first.connectionId,operation:'getNewsInteractions',args:{hnItemIds:[41]},idempotencyKey:'news-personal-read'});
  expect(state.data['41'].viewer).toEqual({vote:1,saved:true});
 });
 test('requires verified owner feedback rights and rechecks restrictions',async()=>{
  const t=setup();const seed=await fixture(t);await newsFixture(t);const owner=t.withIdentity({subject:seed.owner});
  await expect(owner.mutation(executeRef,call(seed,'setNewsInteraction',{hnItemId:41,vote:1,saved:false},'not-verified'))).rejects.toThrow('verified human');
  await t.run(ctx=>ctx.db.patch('users',seed.owner,{emailVerificationTime:Date.now(),forumSuspendedUntil:Date.now()+60_000}));
  await expect(owner.mutation(executeRef,call(seed,'setNewsInteraction',{hnItemId:41,vote:1,saved:false},'restricted-owner'))).rejects.toThrow();
 });
 test('review mode queues an immutable news proposal without changing votes',async()=>{
  const t=setup();const seed=await fixture(t,'agent',true);await newsFixture(t);await t.run(ctx=>ctx.db.patch('users',seed.owner,{emailVerificationTime:Date.now()}));const owner=t.withIdentity({subject:seed.owner});
  const input=call(seed,'setNewsInteraction',{hnItemId:41,vote:1,saved:true},'review-news');const proposal=await owner.mutation(executeRef,input);
  expect(proposal.status).toBe('pending_approval');expect(await t.run(ctx=>ctx.db.query('interactions').collect())).toEqual([]);
  expect(await owner.mutation(executeRef,input)).toEqual(proposal);
 });
});

describe("plugin direct and group conversations", () => {
  test.each(["human", "agent"] as const)("%s delegation uses the selected inbox and stable private links", async mode => {
    const t = setup(), seed = await fixture(t, mode), owner = t.withIdentity({ subject: seed.owner });
    const created = await owner.mutation(executeRef, call(seed, "createPrivateMessageConversation", { recipientUsernames: ["stranger"], body: "An authorized private hello", requestId: "private-start" }, "private-start"));
    const data = created.data as { conversationId: Id<"forumPrivateConversations"> };
    expect(created.status).toBe("completed");
    expect(created.url).toBe(`https://forum.symbaiex.com/messages?conversation=${data.conversationId}`);
    const result = await owner.mutation(readRef, { connectionId: seed.connectionId, operation: "getPrivateMessageConversation", args: { conversationId: data.conversationId } });
    expect(result.data).toMatchObject({ viewerId: mode === "human" ? seed.owner : seed.agent, messages: [{ body: "An authorized private hello", author: { isAgent: mode === "agent" }, agentAssisted: mode === "human" }] });
    if (mode === "agent") expect(await owner.query(api.forum.getPrivateMessageConversation, { conversationId: data.conversationId })).toBeNull();
  });
  test("review-mode private sends remain immutable proposals until their human owner approves", async () => {
    const t = setup(), seed = await fixture(t, "human", true), owner = t.withIdentity({ subject: seed.owner });
    const input = call(seed, "createPrivateMessageConversation", { recipientUsernames: ["stranger"], body: "Owner review first", requestId: "private-review" }, "private-review");
    const queued = await owner.mutation(executeRef, input);
    expect(queued.status).toBe("pending_approval");
    await t.run(async ctx => { expect(await ctx.db.query("forumPrivateConversations").take(1)).toEqual([]); });
    await expect(t.withIdentity({ subject: seed.agent }).mutation(approveRef, { commandId: queued.commandId })).rejects.toThrow();
    const approved = await owner.mutation(approveRef, { commandId: queued.commandId });
    expect(approved.status).toBe("completed");
    expect((await owner.mutation(executeRef, input)).data).toEqual(approved.data);
    await t.run(async ctx => { expect(await ctx.db.query("forumPrivateConversationMessages").take(2)).toHaveLength(1); });
  });
  test("messages permission is rechecked after reduction even for a known private conversation", async () => {
    const t = setup(), seed = await fixture(t, "human"), owner = t.withIdentity({ subject: seed.owner });
    const created = await owner.mutation(executeRef, call(seed, "createPrivateMessageConversation", { recipientUsernames: ["stranger"], requestId: "private" }, "private"));
    await t.run(ctx => ctx.db.patch("forumPluginConnections", seed.connectionId, { capabilities: ["read", "personal"], policyVersion: 2 }));
    await expect(owner.mutation(readRef, { connectionId: seed.connectionId, operation: "getPrivateMessageConversation", args: { conversationId: (created.data as { conversationId: string }).conversationId } })).rejects.toThrow();
  });
});

test("queued group delivery survives incoming messages but invalidates after participant changes", async () => {
  const t = setup(), seed = await fixture(t, "human", true), owner = t.withIdentity({ subject: seed.owner });
  const friend = await t.run(ctx => ctx.db.insert("users", { username: "friend", usernameNormalized: "friend", forumTrustedAt: Date.now() }));
  const { conversationId } = await owner.mutation(api.forum.createPrivateMessageConversation, { recipientUsernames: ["stranger", "friend"], requestId: "group" });
  const pending = await owner.mutation(executeRef, call(seed, "sendPrivateMessageConversation", { conversationId, body: "Queued reply", requestId: "queued" }, "queued"));
  await t.withIdentity({ subject: seed.stranger }).mutation(api.forum.sendPrivateMessageConversation, { conversationId, body: "New incoming message", requestId: "incoming" });
  expect((await owner.mutation(approveRef, { commandId: pending.commandId })).status).toBe("completed");
  const stale = await owner.mutation(executeRef, call(seed, "sendPrivateMessageConversation", { conversationId, body: "Do not send to different participants", requestId: "stale" }, "stale"));
  await owner.mutation(api.forum.setPrivateMessageConversation, { conversationId, removeUserId: friend });
  expect((await owner.mutation(approveRef, { commandId: stale.commandId })).data).toEqual({ state: "invalidated", reason: "target_changed" });
  expect((await owner.query(api.forum.getPrivateMessageConversation, { conversationId }))?.messages.map(message => message.body)).toEqual(["New incoming message", "Queued reply"]);
});
