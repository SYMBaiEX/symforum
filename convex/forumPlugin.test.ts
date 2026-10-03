/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
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
  test.each(["agent", "human"] as const)(
    "posts as %s, spends automation quota once, preserves first-party author",
    async (mode) => {
      const t = setup();
      const seed = await fixture(t, mode);
      const owner = t.withIdentity({ subject: seed.owner });
      const input = call(seed, "createThread", {
        categorySlug: "square",
        title: "Plugin discussion",
        body: "A useful community question.",
      });
      const first = await owner.mutation(executeRef, input);
      expect(first.status).toBe("completed");
      expect(first.data.status).toBe("active");
      const second = await owner.mutation(executeRef, input);
      expect(second).toEqual(first);
      await t.run(async (ctx) => {
        const threads = await ctx.db.query("forumThreads").collect();
        expect(threads).toHaveLength(2);
        expect(
          threads.find((row) => row._id === first.data.threadId)?.authorId,
        ).toBe(mode === "human" ? seed.owner : seed.agent);
        expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(1);
        expect(
          (await ctx.db.query("agentQuotaBudgets").collect())[0].usedUnits,
        ).toBe(1);
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
  test("owner trust and both owner/agent restrictions apply", async () => {
    const t = setup();
    const seed = await fixture(t);
    const owner = t.withIdentity({ subject: seed.owner });
    await t.run(async (ctx) => {
      await ctx.db.patch("users", seed.owner, {
        forumTrustRevokedAt: Date.now(),
        forumTrustedAt: undefined,
      });
      await ctx.db.patch("forumCategories", seed.board, {
        threadAccess: "members",
      });
    });
    const pending = await owner.mutation(
      executeRef,
      call(seed, "createThread", {
        categorySlug: "square",
        title: "Pending post",
        body: "Please review this post.",
      }),
    );
    expect(pending.data.status).toBe("pending");
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
    const owner = t.withIdentity({ subject: seed.owner });
    const proposal = await owner.mutation(
      executeRef,
      call(seed, "setThreadBookmark", { threadId: seed.thread, saved: true }),
    );
    expect(proposal.status).toBe("pending_approval");
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
  test("exhausted owner quota rolls back domain writes and receipt insertion", async () => {
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
    await expect(
      owner.mutation(
        executeRef,
        call(seed, "setThreadBookmark", { threadId: seed.thread, saved: true }),
      ),
    ).rejects.toThrow("quota reached");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumThreadBookmarks").collect()).toHaveLength(
        0,
      );
      expect(await ctx.db.query("forumPluginCommands").collect()).toHaveLength(
        0,
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
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(1);
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
    expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(1);
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
  "connected %s reads charge every invocation even when client keys repeat",
  async (mode) => {
    const t = setup();
    const seed = await fixture(t, mode);
    const owner = t.withIdentity({ subject: seed.owner });
    const input = {
      connectionId: seed.connectionId,
      expectedPolicyVersion: 1,
      operation: "getThread",
      args: { categorySlug: "square", threadSlug: "discussion" },
      idempotencyKey: "read-once",
    };
    const first = await owner.mutation(readRef, input);
    expect(first.status).toBe("completed");
    expect(await owner.mutation(readRef, input)).toEqual(first);
    await t.run(async (ctx) => {
      const usages = await ctx.db.query("agentQuotaUsage").collect();
      expect(usages).toHaveLength(2);
      expect(usages[0].agentId).toBe("helper");
      expect(
        (await ctx.db.query("agentQuotaBudgets").collect())[0].usedUnits,
      ).toBe(2);
    });
    await expect(
      owner.mutation(readRef, {
        ...input,
        args: { categorySlug: "square", threadSlug: "missing" },
      }),
    ).rejects.toThrow("not available");
    await expect(
      owner.mutation(readRef, {
        ...input,
        idempotencyKey: "missing-target",
        args: { categorySlug: "missing", threadSlug: "missing" },
      }),
    ).rejects.toThrow("not available");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(2);
    });
    const { idempotencyKey, ...withoutKey } = input;
    expect((await owner.mutation(readRef, withoutKey)).status).toBe(
      "completed",
    );
    await owner.mutation(readRef, { operation: "getThread", args: input.args });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(3);
      const budget = (await ctx.db.query("agentQuotaBudgets").collect())[0];
      await ctx.db.patch("agentQuotaBudgets", budget._id, {
        hardCapUnits: 3,
        hardCapReachedAt: Date.now(),
      });
    });
    await expect(
      owner.mutation(readRef, {
        ...input,
        idempotencyKey: "quota-limited-read",
      }),
    ).rejects.toThrow("quota reached");
  },
);
