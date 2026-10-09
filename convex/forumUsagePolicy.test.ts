/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import agentTest from "@convex-dev/agent/test";
import presenceTest from "@convex-dev/presence/test";
import { makeFunctionReference } from "convex/server";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { FORUM_USAGE_POLICY } from "../lib/forum-usage-policy";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const execute = makeFunctionReference<"mutation">("forumPlugin:execute");
const read = makeFunctionReference<"mutation">("forumPlugin:read");
const evidenceQuota = makeFunctionReference<"mutation">(
  "agentQuota:consumeAgentQuota",
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
  mode: "human" | "agent" = "human",
) {
  const now = Date.now();
  return t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", {
      username: "policy-owner",
      usernameNormalized: "policy-owner",
      forumTrustedAt: 1,
    });
    const agent = await ctx.db.insert("users", {
      username: "policy-agent",
      usernameNormalized: "policy-agent",
      isAgent: true,
      agentSlug: "policy-agent",
      agentStatus: "active",
      agentScopes: ["forum", "evidence"],
      agentKeyVersion: 1,
    });
    const credential = await ctx.db.insert("agentIdentities", {
      agentId: "policy-agent",
      userId: agent,
      ownerUserId: owner,
      credentialKind: "oauth",
      scopes: ["forum", "evidence"],
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
      capabilities: ["read", "personal"],
      capabilityCeiling: ["read", "personal"],
      executionMode: "direct",
      policyVersion: 1,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const category = await ctx.db.insert("forumCategories", {
      slug: "general",
      name: "General",
      description: "",
      kind: "board",
      status: "active",
      viewAccess: "public",
      threadAccess: "members",
      replyAccess: "members",
      position: 0,
      threadCount: 1,
      postCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    const thread = await ctx.db.insert("forumThreads", {
      categoryId: category,
      categorySlug: "general",
      slug: "discussion",
      title: "Discussion",
      body: "Body",
      authorId: owner,
      status: "active",
      pinned: false,
      replyCount: 0,
      viewCount: 0,
      lastPostAt: now,
      lastPostUserId: owner,
      searchText: "Discussion",
      createdAt: now,
      updatedAt: now,
    });
    const monthKey = new Date(now).toISOString().slice(0, 7);
    await ctx.db.insert("agentQuotaBudgets", {
      ownerUserId: owner,
      monthKey,
      freeAllowanceUnits: 100,
      hardCapUnits: 1000,
      usedUnits: 1000,
      hardCapReachedAt: now,
      hardCapMetadataJson: "{}",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("agentQuotaUsageCounters", {
      ownerUserId: owner,
      agentId: "policy-agent",
      monthKey,
      usedUnits: 250,
      updatedAt: now,
    });
    return { owner, agent, credential, connectionId, thread };
  });
}

test.each(["human", "agent"] as const)(
  "%s forum writes bypass monthly evidence budgets while exact retries preserve rate capacity",
  async (mode) => {
    const t = setup();
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const seed = await fixture(t, mode);
      const owner = t.withIdentity({ subject: seed.owner });
      const status = await owner.mutation(read, {
        connectionId: seed.connectionId,
        operation: "status",
        args: {},
      });
      expect(status.data.usagePolicy).toEqual(FORUM_USAGE_POLICY);
      expect(status.data).not.toHaveProperty("quota");
      const input = {
        connectionId: seed.connectionId,
        expectedPolicyVersion: 1,
        operation: "setThreadBookmark",
        args: { threadId: seed.thread, saved: true },
        idempotencyKey: "first-write",
      };
      const first = await owner.mutation(execute, input);
      expect(first.status).toBe("completed");
      for (let i = 0; i < 80; i++)
        expect(await owner.mutation(execute, input)).toEqual(first);
      for (let i = 1; i < 40; i++)
        await owner.mutation(execute, {
          ...input,
          idempotencyKey: `write-${i}`,
        });
      await expect(
        owner.mutation(execute, { ...input, idempotencyKey: "write-over-cap" }),
      ).rejects.toThrow("FORUM_RATE_LIMITED");
      expect(
        await t.mutation(evidenceQuota, {
          agentId: "policy-agent",
          units: 1,
          idempotencyKey: "evidence-one",
          operation: "evidence.search",
        }),
      ).toMatchObject({ accepted: false, reason: "hard-cap" });
      await t.run(async (ctx) => {
        expect(
          (await ctx.db.query("agentQuotaBudgets").unique())?.usedUnits,
        ).toBe(1000);
        expect(
          (await ctx.db.query("agentQuotaUsageCounters").unique())?.usedUnits,
        ).toBe(250);
        expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
        expect(
          await ctx.db.query("forumPluginCommands").collect(),
        ).toHaveLength(40);
        expect(
          await ctx.db.query("forumThreadBookmarks").collect(),
        ).toHaveLength(1);
      });
    } finally {
      clock.mockRestore();
    }
  },
);

test("native agent writes and distinct plugin credentials share the owner's admission burst", async () => {
  const t = setup();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  try {
    const seed = await fixture(t);
    const native = await t.run(async (ctx) => {
      const agent = await ctx.db.insert("users", {
        username: "native-other",
        isAgent: true,
        agentSlug: "native-other",
        agentStatus: "active",
        agentScopes: ["forum"],
        agentKeyVersion: 1,
      });
      await ctx.db.insert("agentIdentities", {
        agentId: "native-other",
        userId: agent,
        ownerUserId: seed.owner,
        credentialKind: "oauth",
        scopes: ["forum"],
        status: "active",
        keyVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      return agent;
    });
    expect(
      (
        await t
          .withIdentity({ subject: native })
          .mutation(api.forum.sendChatMessage, { body: "Native participation" })
      ).publicationStatus,
    ).toBe("published");
    const owner = t.withIdentity({ subject: seed.owner });
    const input = {
      connectionId: seed.connectionId,
      expectedPolicyVersion: 1,
      operation: "setThreadBookmark",
      args: { threadId: seed.thread, saved: true },
    };
    for (let i = 0; i < 39; i++)
      await owner.mutation(execute, { ...input, idempotencyKey: `mixed-${i}` });
    await expect(
      owner.mutation(execute, { ...input, idempotencyKey: "mixed-over-cap" }),
    ).rejects.toThrow("FORUM_RATE_LIMITED");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumChatMessages").collect()).toHaveLength(1);
      expect(await ctx.db.query("forumPluginCommands").collect()).toHaveLength(
        39,
      );
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
      expect(
        (await ctx.db.query("agentQuotaBudgets").unique())?.usedUnits,
      ).toBe(1000);
    });
  } finally {
    clock.mockRestore();
  }
});

test.each(["revoked", "scope", "key"] as const)(
  "native forum admission preserves %s credential checks",
  async (failure) => {
    const t = setup();
    const seed = await fixture(t, "agent");
    await t.run(async (ctx) => {
      if (failure === "revoked")
        await ctx.db.patch("agentIdentities", seed.credential, {
          status: "revoked",
        });
      else if (failure === "scope")
        await ctx.db.patch("agentIdentities", seed.credential, {
          scopes: ["evidence"],
        });
      else
        await ctx.db.patch("agentIdentities", seed.credential, {
          keyVersion: 2,
        });
    });
    await expect(
      t
        .withIdentity({ subject: seed.agent })
        .mutation(api.forum.sendChatMessage, { body: "Must be denied" }),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("forumChatMessages").collect()).toHaveLength(0);
      expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
      expect(
        (await ctx.db.query("agentQuotaBudgets").unique())?.usedUnits,
      ).toBe(1000);
    });
  },
);

test("native enrolled agents can create topics and replies at exhausted monthly API budgets", async () => {
  const t = setup();
  const seed = await fixture(t, "agent");
  const agent = t.withIdentity({ subject: seed.agent });
  const topic = await agent.mutation(api.forum.createThread, {
    categorySlug: "general",
    title: "Native topic",
    body: "Native enrollment stays usable.",
  });
  const reply = await agent.mutation(api.forum.createReply, {
    threadId: seed.thread,
    body: "Native reply remains available.",
  });
  // Monthly exemption preserves native topic/reply access without delaying publication.
  expect(topic.status).toBe("active");
  expect(reply.status).toBe("active");
  await t.run(async (ctx) => {
    expect((await ctx.db.get("forumThreads", topic.threadId))?.authorId).toBe(
      seed.agent,
    );
    expect((await ctx.db.get("forumPosts", reply.postId))?.authorId).toBe(
      seed.agent,
    );
    expect(await ctx.db.query("agentQuotaUsage").collect()).toHaveLength(0);
    expect((await ctx.db.query("agentQuotaBudgets").unique())?.usedUnits).toBe(
      1000,
    );
    expect(
      (await ctx.db.query("agentQuotaUsageCounters").unique())?.usedUnits,
    ).toBe(250);
  });
  await expect(
    agent.mutation(api.forum.createThread, {
      categorySlug: "general",
      title: "Too fast",
      body: "Existing topic cooldown still applies.",
    }),
  ).rejects.toThrow("Give the board a breath");
  await expect(
    agent.mutation(api.forum.createReply, {
      threadId: seed.thread,
      body: "Too fast reply",
    }),
  ).rejects.toThrow("Give the thread a breath");
});
