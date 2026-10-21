/// <reference types="vite/client" />

import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { TokenSnapshot } from "../lib/token-alpha";
import { components, internal } from "./_generated/api";
import { STRUCTURED_CANARY_KEY } from "./aiRoutingControlData";
import schema from "./schema";

const modules = {
  ...import.meta.glob("./**/*.ts"),
  ...import.meta.glob("./**/*.tsx"),
};
const NOW = Date.parse("2026-10-21T19:20:00.000Z");
const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;
const MINT = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";

function setup() {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
  vi.stubEnv("FORUM_AGENT_DAILY_PUBLICATION_LIMIT", "18");
  const t = convexTest(schema, modules);
  registerRateLimiter(t);
  return t;
}

async function initialized(t: ReturnType<typeof setup>) {
  const infrastructure = await t.mutation(
    internal.tokenAlphaData.ensureInfrastructure,
    {},
  );
  await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true });
  await t.run(async (ctx) => {
    await ctx.db.insert("aiOperationalStates", {
      key: STRUCTURED_CANARY_KEY,
      healthy: true,
      checkedAt: NOW,
      pauseUntil: 0,
      updatedAt: NOW,
    });
  });
  return infrastructure;
}

function snapshot(overrides: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return {
    platform: "bags",
    mint: MINT,
    name: "SYMBaiEX",
    symbol: "SYMF",
    observedAt: NOW,
    metricsAsOf: NOW,
    priceUsd: 0.001,
    marketCapUsd: 1_000_000,
    holders: 123,
    volume1hUsd: 4_000,
    liquidityUsd: 50_000,
    priceChange1hPercent: 3,
    imageUrl: null,
    website: null,
    twitter: null,
    telegram: null,
    description: null,
    sourceUrl: `https://www.solanatracker.io/token/${MINT}`,
    sourceRank: 1,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("token alpha infrastructure and claims", () => {
  test("creates only two disabled reader identities and preserves collisions, pauses and other agents", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        username: "bags-scout",
        usernameNormalized: "bags-scout",
        role: "reader",
      });
      await ctx.db.insert("forumAgents", {
        slug: "suki",
        name: "Suki",
        userId,
        persona: "Original persona",
        model: "original-model",
        dailyPostTarget: 3,
        enabled: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const first = await t.mutation(
      internal.tokenAlphaData.ensureInfrastructure,
      {},
    );
    const second = await t.mutation(
      internal.tokenAlphaData.ensureInfrastructure,
      {},
    );
    expect(first.agents).toEqual(second.agents);
    const state = await t.run(async (ctx) => ({
      users: await ctx.db.query("users").take(10),
      agents: await ctx.db.query("forumAgents").take(10),
      profiles: await ctx.db.query("forumUserProfiles").take(10),
      usage: await ctx.db.query("tokenAlphaUsageDays").take(10),
    }));
    expect(state.users).toHaveLength(3);
    expect(state.profiles).toHaveLength(2);
    expect(
      state.users.find((user) => user.agentSlug === "bags-scout"),
    ).toMatchObject({
      username: "bags-scout-agent-1",
      role: "reader",
      isAgent: true,
    });
    expect(
      state.agents
        .filter((agent) => agent.slug !== "suki")
        .every((agent) => !agent.enabled && agent.dailyPostTarget === 24),
    ).toBe(true);
    expect(state.agents.find((agent) => agent.slug === "suki")).toMatchObject({
      enabled: true,
      model: "original-model",
      dailyPostTarget: 3,
    });
    expect(state.usage).toHaveLength(1);
    expect(state.usage[0].requests).toBe(12);

    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true });
    await t.run(async (ctx) => {
      await ctx.db.patch("forumAgents", first.agents[0].agentId, {
        enabled: false,
      });
      await ctx.db.patch("users", first.agents[0].userId, {
        forumBannedAt: NOW,
        forumTrustRevokedAt: NOW,
        agentStatus: "revoked",
      });
    });
    await t.mutation(internal.tokenAlphaData.ensureInfrastructure, {});
    const preserved = await t.run(async (ctx) => ({
      agent: await ctx.db.get("forumAgents", first.agents[0].agentId),
      user: await ctx.db.get("users", first.agents[0].userId),
    }));
    expect(preserved.agent?.enabled).toBe(false);
    expect(preserved.user).toMatchObject({
      forumBannedAt: NOW,
      forumTrustRevokedAt: NOW,
      agentStatus: "revoked",
    });
    await expect(
      t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true }),
    ).rejects.toThrow(/revoked/);
  });

  test("does not take over an existing non-agent slug", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { role: "reader", agentSlug: "bags-scout" });
    });
    await expect(
      t.mutation(internal.tokenAlphaData.ensureInfrastructure, {}),
    ).rejects.toThrow(/reserved/);
  });

  test("claims each platform/hour once and never reclaims failure or expiry", async () => {
    const t = setup();
    await initialized(t);
    const run = await t.mutation(internal.tokenAlphaData.claimRun, {
      platform: "bags",
      claimToken: "first",
    });
    expect(run).toMatchObject({
      runKey: "bags:2026-10-21T19",
      status: "running",
      expiresAt: NOW + HOUR / 2,
    });
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "second",
      }),
    ).toBeNull();
    await t.mutation(internal.tokenAlphaData.finishRun, {
      runKey: run!.runKey,
      claimToken: "first",
      status: "held",
      reason: "Unknown provider delivery",
    });
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "third",
      }),
    ).toBeNull();
    vi.mocked(Date.now).mockReturnValue(NOW + HOUR / 2 + 1);
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "fourth",
      }),
    ).toBeNull();
    vi.mocked(Date.now).mockReturnValue(NOW + HOUR);
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "next-hour",
      }),
    ).toMatchObject({ runKey: "bags:2026-10-21T20" });
    const forumRun = await t.run(
      async (ctx) =>
        await ctx.db
          .query("forumAgentRuns")
          .withIndex("by_runKey", (q) => q.eq("runKey", run!.runKey))
          .unique(),
    );
    expect(forumRun).toMatchObject({
      status: "failed",
      errorMessage: "Unknown provider delivery",
    });
  });

  test("honors canary freshness, identity pauses, and live runtime mode", async () => {
    const t = setup();
    const infra = await initialized(t);
    vi.stubEnv("ELIZA_RUNTIME_MODE", "off");
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "off",
      }),
    ).toBeNull();
    vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
    vi.mocked(Date.now).mockReturnValue(NOW + 2 * HOUR + 1);
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "stale",
      }),
    ).toBeNull();
    vi.mocked(Date.now).mockReturnValue(NOW);
    await t.run(
      async (ctx) =>
        await ctx.db.patch("forumAgents", infra.agents[0].agentId, {
          enabled: false,
        }),
    );
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "paused",
      }),
    ).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "pumpfun",
        claimToken: "other-platform",
      }),
    ).not.toBeNull();
  });

  test("preserves global publication cap even after many skipped rows", async () => {
    const t = setup();
    await initialized(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 60; index += 1) {
        await ctx.db.insert("forumAgentRuns", {
          runKey: `existing:${index}`,
          agentSlug: "suki",
          runDate: "2026-10-21",
          slot: index,
          attempt: 0,
          status: index < 42 ? "skipped" : "published",
          model: "openrouter/free",
          sourceUrls: [],
          startedAt: NOW,
          updatedAt: NOW,
        });
      }
    });
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "global-cap",
      }),
    ).toBeNull();
  });

  test("preserves the shared twelve-failure circuit", async () => {
    const t = setup();
    await initialized(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 12; index += 1) {
        await ctx.db.insert("forumAgentRuns", {
          runKey: `failed:${index}`,
          agentSlug: "suki",
          runDate: "2026-10-21",
          slot: index,
          attempt: 0,
          status: "failed",
          model: "openrouter/free",
          sourceUrls: [],
          startedAt: NOW,
          updatedAt: NOW,
        });
      }
    });
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "failure-circuit",
      }),
    ).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "pumpfun",
        claimToken: "failure-circuit",
      }),
    ).toBeNull();
  });

  test("admits exactly one explicit first-post attempt per lane without clearing the ordinary failure circuit", async () => {
    const t = setup();
    await initialized(t);
    await t.run(async (ctx) => {
      for (let index = 0; index < 12; index += 1) {
        await ctx.db.insert("forumAgentRuns", {
          runKey: `old-failure:${index}`,
          agentSlug: "suki",
          runDate: "2026-10-21",
          slot: index,
          attempt: 0,
          status: "failed",
          model: "openrouter/free",
          sourceUrls: [],
          startedAt: NOW,
          updatedAt: NOW,
        });
      }
    });
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "ordinary",
      }),
    ).toBeNull();
    const first = await t.mutation(internal.tokenAlphaData.claimRun, {
      platform: "bags",
      claimToken: "manual-first",
      operatorFirstPost: true,
    });
    expect(first).toMatchObject({ operatorFirstPost: true, status: "running" });
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "same-hour-repeat",
        operatorFirstPost: true,
      }),
    ).toBeNull();
    await t.mutation(internal.tokenAlphaData.finishRun, {
      runKey: first!.runKey,
      claimToken: "manual-first",
      status: "held",
      reason: "Unknown model outcome",
    });
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: false });
    await t.mutation(internal.tokenAlphaData.ensureInfrastructure, {});
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true });
    vi.mocked(Date.now).mockReturnValue(NOW + HOUR);
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "next-hour-repeat",
        operatorFirstPost: true,
      }),
    ).toBeNull();
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "pumpfun",
        claimToken: "ordinary-other",
      }),
    ).toBeNull();
    const other = await t.mutation(internal.tokenAlphaData.claimRun, {
      platform: "pumpfun",
      claimToken: "manual-other",
      operatorFirstPost: true,
    });
    expect(other).toMatchObject({ operatorFirstPost: true });
    await t.mutation(internal.tokenAlphaData.finishRun, {
      runKey: other!.runKey,
      claimToken: "manual-other",
      status: "failed",
      reason: "No automatic retry",
    });
    vi.mocked(Date.now).mockReturnValue(NOW + 2 * HOUR);
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "pumpfun",
        claimToken: "later-repeat",
        operatorFirstPost: true,
      }),
    ).toBeNull();
    const state = await t.run(async (ctx) => ({
      control: await ctx.db
        .query("tokenAlphaControl")
        .withIndex("by_key", (q) => q.eq("key", "pilot"))
        .unique(),
      oldFailures: await ctx.db
        .query("forumAgentRuns")
        .withIndex("by_agentSlug_and_status_and_startedAt", (q) =>
          q.eq("agentSlug", "suki").eq("status", "failed"),
        )
        .take(20),
    }));
    expect(state.control?.operatorFirstPostAttempts).toEqual([
      "bags",
      "pumpfun",
    ]);
    expect(state.oldFailures).toHaveLength(12);
    expect(
      await t.mutation(internal.tokenAlphaData.queueFirstPosts, {}),
    ).toEqual({ queued: 0 });
  });

  test("a first-post request cannot bypass unhealthy canaries or the daily publication cap, and denials do not spend the attempt", async () => {
    const t = setup();
    await initialized(t);
    const ids = await t.run(async (ctx) => {
      const canary = await ctx.db
        .query("aiOperationalStates")
        .withIndex("by_key", (q) => q.eq("key", STRUCTURED_CANARY_KEY))
        .unique();
      await ctx.db.patch("aiOperationalStates", canary!._id, {
        healthy: false,
      });
      const runs = [];
      for (let index = 0; index < 18; index += 1) {
        runs.push(
          await ctx.db.insert("forumAgentRuns", {
            runKey: `published:${index}`,
            agentSlug: "suki",
            runDate: "2026-10-21",
            slot: index,
            attempt: 0,
            status: "published",
            model: "openrouter/free",
            sourceUrls: [],
            startedAt: NOW,
            updatedAt: NOW,
          }),
        );
      }
      return { runs, canaryId: canary!._id };
    });
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "unhealthy",
        operatorFirstPost: true,
      }),
    ).toBeNull();
    await t.run(
      async (ctx) =>
        await ctx.db.patch("aiOperationalStates", ids.canaryId, {
          healthy: true,
        }),
    );
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "full-day",
        operatorFirstPost: true,
      }),
    ).toBeNull();
    const control = await t.run(
      async (ctx) =>
        await ctx.db
          .query("tokenAlphaControl")
          .withIndex("by_key", (q) => q.eq("key", "pilot"))
          .unique(),
    );
    expect(control?.operatorFirstPostAttempts).toBeUndefined();
    await t.run(async (ctx) => {
      for (const id of ids.runs)
        await ctx.db.patch("forumAgentRuns", id, { status: "skipped" });
    });
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "now-admitted",
        operatorFirstPost: true,
      }),
    ).not.toBeNull();
  });

  test("never grants the first-post exception to an agent that has already published", async () => {
    const t = setup();
    await initialized(t);
    await t.run(
      async (ctx) =>
        await ctx.db.insert("forumAgentRuns", {
          runKey: "old-bags-publication",
          agentSlug: "bags-scout",
          runDate: "2026-10-20",
          slot: 0,
          attempt: 0,
          status: "published",
          model: "openrouter/free",
          sourceUrls: [],
          startedAt: NOW - DAY,
          updatedAt: NOW - DAY,
        }),
    );
    expect(
      await t.mutation(internal.tokenAlphaData.claimRun, {
        platform: "bags",
        claimToken: "already-published",
        operatorFirstPost: true,
      }),
    ).toBeNull();
    const ordinary = await t.mutation(internal.tokenAlphaData.claimRun, {
      platform: "bags",
      claimToken: "ordinary-followup",
    });
    expect(ordinary).not.toBeNull();
    expect(ordinary?.operatorFirstPost).toBeUndefined();
  });
});

describe("token alpha canonical context and private drafts", () => {
  test("adopts an existing human token thread only on the exact active public board", async () => {
    const t = setup();
    const threadId = await t.run(async (ctx) => {
      const authorId = await ctx.db.insert("users", { role: "reader" });
      const categoryId = await ctx.db.insert("forumCategories", {
        slug: "crypto-bags",
        name: "Bags.App",
        description: "Tokens",
        status: "active",
        position: 81,
        threadCount: 1,
        postCount: 0,
        createdAt: NOW,
        updatedAt: NOW,
      });
      return await ctx.db.insert("forumThreads", {
        categoryId,
        categorySlug: "crypto-bags",
        slug: "symbaiex-symf-on-bags-helping-support-forum-costs",
        title: "SYMF",
        body: `Token mint: ${MINT}`,
        authorId,
        status: "active",
        pinned: false,
        replyCount: 0,
        viewCount: 0,
        lastPostAt: NOW - HOUR,
        lastPostUserId: authorId,
        searchText: "SYMF",
        createdAt: NOW - HOUR,
        updatedAt: NOW - HOUR,
      });
    });
    const first = await initialized(t);
    expect(first.adopted).toBe(1);
    expect(
      (await t.mutation(internal.tokenAlphaData.ensureInfrastructure, {}))
        .adopted,
    ).toBe(0);
    const context = await t.query(internal.tokenAlphaData.getContext, {
      platform: "bags",
      mints: [MINT],
    });
    expect(context).toEqual({
      tracked: [{ mint: MINT, threadId, lastUpdatedAt: NOW - HOUR }],
      metadata: [],
    });
    const previous = snapshot({
      observedAt: NOW - HOUR,
      metricsAsOf: NOW - HOUR,
      metadataAsOf: NOW - 6 * HOUR,
      priceUsd: 0.0009,
    });
    await t.run(async (ctx) => {
      const canonical = await ctx.db
        .query("tokenAlphaTrackedTokens")
        .withIndex("by_chain_and_mint", (q) =>
          q.eq("chain", "solana").eq("mint", MINT),
        )
        .unique();
      await ctx.db.patch("tokenAlphaTrackedTokens", canonical!._id, {
        latestSnapshot: previous,
      });
    });
    expect(
      (
        await t.query(internal.tokenAlphaData.getContext, {
          platform: "bags",
          mints: [MINT],
        })
      ).metadata,
    ).toEqual([previous]);
    expect(
      (
        await t.query(internal.tokenAlphaData.getContext, {
          platform: "bags",
          mints: [`${MINT.slice(0, -1)}s`],
        })
      ).tracked,
    ).toEqual([]);
    const run = await t.mutation(internal.tokenAlphaData.claimRun, {
      platform: "bags",
      claimToken: "canonical",
    });
    const saved = await t.mutation(internal.tokenAlphaData.saveSnapshot, {
      runKey: run!.runKey,
      claimToken: "canonical",
      snapshot: snapshot(),
    });
    expect(saved.threadId).toBe(threadId);
    expect(saved.previous).toEqual(previous);
    await t.mutation(internal.tokenAlphaData.saveDraft, {
      runKey: run!.runKey,
      claimToken: "canonical",
      analysis: "Activity merits observation; sentiment is unassessed.",
      title: "SYMF watch",
      body: "Private deterministic facts and labeled analysis.",
    });
    expect(
      await t.query(internal.tokenAlphaData.getRun, { runKey: run!.runKey }),
    ).toMatchObject({ status: "drafted", threadId });
    await expect(
      t.mutation(internal.tokenAlphaData.saveSnapshot, {
        runKey: run!.runKey,
        claimToken: "canonical",
        snapshot: snapshot(),
      }),
    ).rejects.toThrow(/inactive/);
  });

  test("refuses expired, wrong-claim, wrong-platform and paused writes", async () => {
    const t = setup();
    await initialized(t);
    const run = await t.mutation(internal.tokenAlphaData.claimRun, {
      platform: "bags",
      claimToken: "correct",
    });
    const request = {
      runKey: run!.runKey,
      claimToken: "correct",
      snapshot: snapshot(),
    };
    await expect(
      t.mutation(internal.tokenAlphaData.saveSnapshot, {
        ...request,
        claimToken: "wrong",
      }),
    ).rejects.toThrow(/inactive/);
    await expect(
      t.mutation(internal.tokenAlphaData.saveSnapshot, {
        ...request,
        snapshot: snapshot({ platform: "pumpfun" }),
      }),
    ).rejects.toThrow(/does not match/);
    vi.mocked(Date.now).mockReturnValue(NOW + HOUR / 2);
    await expect(
      t.mutation(internal.tokenAlphaData.saveSnapshot, request),
    ).rejects.toThrow(/expired/);
    vi.mocked(Date.now).mockReturnValue(NOW);
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: false });
    await expect(
      t.mutation(internal.tokenAlphaData.saveSnapshot, request),
    ).rejects.toThrow(/inactive/);
    await expect(
      t.query(internal.tokenAlphaData.getContext, {
        platform: "bags",
        mints: Array.from({ length: 6 }, () => MINT),
      }),
    ).rejects.toThrow(/five/);
  });

  test("does not adopt a known token thread from a private board", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const authorId = await ctx.db.insert("users", { role: "reader" });
      const categoryId = await ctx.db.insert("forumCategories", {
        slug: "crypto-bags",
        name: "Bags.App",
        description: "Private",
        status: "active",
        viewAccess: "members",
        position: 81,
        threadCount: 1,
        postCount: 0,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("forumThreads", {
        categoryId,
        categorySlug: "crypto-bags",
        slug: "symbaiex-symf-on-bags-helping-support-forum-costs",
        title: "SYMF",
        body: MINT,
        authorId,
        status: "active",
        pinned: false,
        replyCount: 0,
        viewCount: 0,
        lastPostAt: NOW,
        lastPostUserId: authorId,
        searchText: "SYMF",
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    expect(
      (await t.mutation(internal.tokenAlphaData.ensureInfrastructure, {}))
        .adopted,
    ).toBe(0);
    expect(
      await t.query(internal.tokenAlphaData.getContext, {
        platform: "bags",
        mints: [MINT],
      }),
    ).toEqual({ tracked: [], metadata: [] });
  });
});

describe("token alpha free-tier quota", () => {
  test("reserves forty-eight ranking reads after ten metadata reads and the verification baseline", async () => {
    const t = setup();
    await initialized(t);
    const enrichmentResults = await Promise.all(
      Array.from({ length: 12 }, () =>
        t.mutation(internal.tokenAlphaData.reserveApiRequest, {
          kind: "enrichment",
        }),
      ),
    );
    expect(enrichmentResults.filter(Boolean)).toHaveLength(10);
    const readOverallLimit = async () =>
      await t.run(
        async (ctx) =>
          await ctx.runQuery(components.rateLimiter.lib.getValue, {
            name: "tokenAlphaTrackerRequests",
            config: { kind: "fixed window", rate: 70, period: DAY, start: 0 },
          }),
      );
    const beforeDenial = await readOverallLimit();
    expect(
      await t.mutation(internal.tokenAlphaData.reserveApiRequest, {
        kind: "enrichment",
      }),
    ).toBe(false);
    expect(await readOverallLimit()).toEqual(beforeDenial);
    const rankings = await Promise.all(
      Array.from({ length: 48 }, () =>
        t.mutation(internal.tokenAlphaData.reserveApiRequest, {
          kind: "ranking",
        }),
      ),
    );
    expect(rankings.every(Boolean)).toBe(true);
    expect(
      await t.mutation(internal.tokenAlphaData.reserveApiRequest, {
        kind: "ranking",
      }),
    ).toBe(false);
    const days = await t.run(
      async (ctx) => await ctx.db.query("tokenAlphaUsageDays").take(34),
    );
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ requests: 70, enrichmentRequests: 10 });
  });

  test("shares one atomic daily quota across concurrent lane requests, including the twelve verification calls", async () => {
    const t = setup();
    await initialized(t);
    const results = await Promise.all(
      Array.from({ length: 80 }, () =>
        t.mutation(internal.tokenAlphaData.reserveApiRequest, {}),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(58);
    expect(
      await t.mutation(internal.tokenAlphaData.reserveApiRequest, {}),
    ).toBe(false);
    const usage = await t.run(
      async (ctx) => await ctx.db.query("tokenAlphaUsageDays").take(34),
    );
    expect(usage).toHaveLength(1);
    expect(usage[0].requests).toBe(70);
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: false });
    await t.mutation(internal.tokenAlphaData.setEnabled, { enabled: true });
    expect(
      await t.mutation(internal.tokenAlphaData.reserveApiRequest, {}),
    ).toBe(false);
  });

  test("UTC day rollover does not erase the conservative rolling 32-day accounting", async () => {
    const t = setup();
    await initialized(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("tokenAlphaUsageDays", {
        dayKey: "2026-10-20",
        requests: 2_288,
        updatedAt: NOW - DAY,
      });
    });
    expect(
      await t.mutation(internal.tokenAlphaData.reserveApiRequest, {}),
    ).toBe(false);
    vi.mocked(Date.now).mockReturnValue(NOW + DAY);
    expect(
      await t.mutation(internal.tokenAlphaData.reserveApiRequest, {}),
    ).toBe(false);
    vi.mocked(Date.now).mockReturnValue(NOW + 32 * DAY);
    expect(
      await t.mutation(internal.tokenAlphaData.reserveApiRequest, {}),
    ).toBe(true);
  });

  test("disabled infrastructure does not spend or queue", async () => {
    const t = setup();
    await t.mutation(internal.tokenAlphaData.ensureInfrastructure, {});
    expect(
      await t.mutation(internal.tokenAlphaData.reserveApiRequest, {}),
    ).toBe(false);
    expect(await t.mutation(internal.tokenAlphaData.queueHourly, {})).toEqual({
      queued: 0,
    });
  });
});
