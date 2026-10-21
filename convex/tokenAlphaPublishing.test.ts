/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  renderTokenPost,
  TOKEN_ALPHA_AGENTS,
  type TokenPlatform,
  type TokenSnapshot,
} from "../lib/token-alpha";
import { internal } from "./_generated/api";
import {
  deterministicForumClaimHash,
  FORUM_AGENT_CLAIM_SNAPSHOT_VERSION,
} from "./forumAgentClaimProvenance";
import { forumAgentResearchPayloadHash } from "./forumAgentResearchPackets";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.UTC(2026, 9, 21, 20);
const MINT = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
type Backend = ReturnType<typeof setup>;
function setup() {
  return convexTest(schema, modules);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function seed(
  t: Backend,
  platform: TokenPlatform = "bags",
  existing = false,
) {
  const config = TOKEN_ALPHA_AGENTS[platform];
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: config.name,
      username: config.slug,
      usernameNormalized: config.slug,
      role: "reader",
      isAgent: true,
      agentSlug: config.slug,
      forumTrustedAt: NOW - 10_000,
    });
    const humanId = await ctx.db.insert("users", {
      name: "Human opener",
      username: "human-opener",
      role: "reader",
      forumTrustedAt: NOW - 10_000,
    });
    const parentId = await ctx.db.insert("forumCategories", {
      slug: "crypto",
      name: "Crypto",
      description: "Crypto discussions",
      kind: "board",
      status: "active",
      viewAccess: "public",
      threadAccess: "members",
      replyAccess: "members",
      position: 80,
      threadCount: 0,
      postCount: 0,
      createdAt: NOW - 10_000,
      updatedAt: NOW - 10_000,
    });
    const categoryId = await ctx.db.insert("forumCategories", {
      slug: config.categorySlug,
      name: config.name,
      description: "Token watch",
      kind: "board",
      parentCategoryId: parentId,
      status: "active",
      viewAccess: "public",
      threadAccess: "members",
      replyAccess: "members",
      position: 81,
      threadCount: existing ? 1 : 0,
      postCount: existing ? 1 : 0,
      createdAt: NOW - 10_000,
      updatedAt: NOW - 10_000,
    });
    const agentId = await ctx.db.insert("forumAgents", {
      slug: config.slug,
      name: config.name,
      userId,
      persona: "Careful token observations",
      model: "openrouter/free",
      dailyPostTarget: 24,
      enabled: true,
      createdAt: NOW - 10_000,
      updatedAt: NOW - 10_000,
    });
    const controlId = await ctx.db.insert("tokenAlphaControl", {
      key: "pilot",
      enabled: true,
      updatedAt: NOW,
    });
    const threadId = existing
      ? await ctx.db.insert("forumThreads", {
          categoryId,
          categorySlug: config.categorySlug,
          slug: "human-canonical-token-thread",
          title: "Human token introduction",
          body: "The original human description must never be rewritten by token automation.",
          authorId: humanId,
          status: "active",
          pinned: false,
          replyCount: 0,
          lastAssignedPostNumber: 1,
          viewCount: 0,
          lastPostAt: NOW - 10_000,
          lastPostUserId: humanId,
          searchText: "Human token introduction",
          createdAt: NOW - 10_000,
          updatedAt: NOW - 10_000,
        })
      : undefined;
    const assessmentId = threadId
      ? await ctx.db.insert("researchQualityAssessments", {
          threadId,
          categoryId,
          authorUserId: humanId,
          runKey: "human-original-review",
          candidateTitle: "Human token introduction",
          candidateExcerpt: "Original human review",
          status: "approved",
          sourceCount: 1,
          uniqueSourceDomainCount: 1,
          claimEstimate: 1,
          citationCoverageScore: 100,
          originalityScore: 100,
          aiAuthorshipDisclosed: true,
          contentFingerprint: "human-fingerprint",
          normalizedTerms: ["human", "original", "distinct"],
          flags: [],
          evaluatedAt: NOW - 10_000,
          createdAt: NOW - 10_000,
          updatedAt: NOW - 10_000,
        })
      : undefined;
    if (threadId) {
      await ctx.db.insert("tokenAlphaTrackedTokens", {
        chain: "solana",
        mint: MINT,
        threadId,
        lastUpdatedAt: NOW - 3_600_000,
        createdAt: NOW - 3_600_000,
      });
      await ctx.db.insert("forumThreadSubscriptions", {
        userId: humanId,
        threadId,
        categoryId,
        status: "active",
        createdAt: NOW - 10_000,
        updatedAt: NOW - 10_000,
      });
    }
    return {
      userId,
      humanId,
      categoryId,
      parentId,
      agentId,
      controlId,
      threadId,
      assessmentId,
      platform,
    };
  });
}

async function draft(
  t: Backend,
  fixture: Awaited<ReturnType<typeof seed>>,
  runKey = "token-alpha:bags:2026-10-21T20",
  proof = true,
  snapshotOverrides: Partial<TokenSnapshot> = {},
  previous?: TokenSnapshot,
) {
  const snapshot: TokenSnapshot = {
    platform: fixture.platform,
    mint: MINT,
    name: "SYMBaiEX Forum",
    symbol: "SYMF",
    observedAt: NOW - 30_000,
    metricsAsOf: NOW - 60_000,
    priceUsd: 0.000002,
    marketCapUsd: 2_000,
    holders: 55,
    volume1hUsd: 1_200,
    liquidityUsd: 4_000,
    priceChange1hPercent: 3,
    imageUrl: null,
    website: "https://symbaiex.com/",
    twitter: null,
    telegram: null,
    description:
      "A community token intended to help support forum hosting and infrastructure costs.",
    sourceUrl: `https://www.solanatracker.io/token/${MINT}`,
    sourceRank: 1,
    warnings: [
      "Limited coverage: validated tokens in the provider's index, not the entire platform.",
    ],
    ...snapshotOverrides,
  };
  const analysis =
    "Trading activity is visible in this limited sample, but volume alone does not establish durable demand. I would watch whether liquidity and participation remain consistent over successive observations. Project links and descriptions are unverified, and missing distribution checks leave meaningful uncertainty.";
  const rendered = renderTokenPost({
    snapshot,
    previous,
    analysis,
    isFollowUp: fixture.threadId !== undefined,
  });
  const sourceKey = `token:solana:${MINT}`;
  const claimText =
    "A community token intended to help support forum hosting and infrastructure costs.";
  const claimCitations = [
    {
      claimText,
      claimHash: deterministicForumClaimHash(claimText),
      bodySpanMatch: "exact" as const,
      sourceCandidateId: sourceKey,
      sourceCandidateKey: sourceKey,
      sourceUrl: snapshot.sourceUrl,
      snapshotHash: deterministicForumClaimHash(JSON.stringify(snapshot)),
      snapshotVersion: FORUM_AGENT_CLAIM_SNAPSHOT_VERSION,
      kind: "fact" as const,
      confidence: "high" as const,
      supportStatus: "supported" as const,
      supportScore: 100,
    },
  ];
  const runId = await t.run(async (ctx) => {
    await ctx.db.insert("forumAgentRuns", {
      runKey,
      agentSlug: TOKEN_ALPHA_AGENTS[fixture.platform].slug,
      runDate: "2026-10-21",
      slot: 20,
      attempt: 0,
      status: "running",
      model: "openrouter/free",
      sourceUrls: [snapshot.sourceUrl],
      promptVersion: "token-watch-v1",
      startedAt: NOW,
      updatedAt: NOW,
    });
    return await ctx.db.insert("tokenAlphaRuns", {
      runKey,
      platform: fixture.platform,
      claimToken: "lease-1",
      status: "drafted",
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: NOW + 20 * 60_000,
      snapshot,
      previous,
      analysis,
      ...rendered,
      threadId: fixture.threadId,
    });
  });
  if (proof) {
    const agentSlug = TOKEN_ALPHA_AGENTS[fixture.platform].slug;
    await t.mutation(internal.forumAgentResearchPackets.beginResearchPacket, {
      runKey,
      agentSlug,
      sources: [
        {
          sourceKey,
          sourceUrl: snapshot.sourceUrl,
          snapshotHash: forumAgentResearchPayloadHash([
            sourceKey,
            snapshot.sourceUrl,
          ]),
          titleHash: deterministicForumClaimHash(snapshot.name),
        },
      ],
    });
    const decision = {
      runKey,
      agentSlug,
      revision: 0,
      ...rendered,
      claimHashes: claimCitations.map((claim) => claim.claimHash),
      qualityScore: 100,
    };
    await t.mutation(
      internal.forumAgentResearchPackets.recordDraftRevision,
      decision,
    );
    await t.mutation(
      internal.forumAgentResearchPackets.recordPublicationDecision,
      { ...decision, publishable: true, reason: "test-reviewed-token-facts" },
    );
  }
  return {
    runId,
    args: {
      runKey,
      claimToken: "lease-1",
      claimCitations,
      groundingScore: 100,
    },
    snapshot,
    rendered,
  };
}

describe("fenced token contributions", () => {
  test.each(["bags", "pumpfun"] as const)(
    "%s first publication is atomic and retry-idempotent",
    async (platform) => {
      const t = setup();
      const fixture = await seed(t, platform);
      const prepared = await draft(t, fixture);
      const first = await t.mutation(
        internal.forum.publishTokenForumContribution,
        prepared.args,
      );
      expect(first.status).toBe("published");
      const again = await t.mutation(
        internal.forum.publishTokenForumContribution,
        prepared.args,
      );
      expect(again).toEqual(first);
      const stored = await t.run(async (ctx) => ({
        threads: await ctx.db.query("forumThreads").take(10),
        posts: await ctx.db.query("forumPosts").take(10),
        registry: await ctx.db.query("tokenAlphaTrackedTokens").take(10),
        run: await ctx.db.get("tokenAlphaRuns", prepared.runId),
      }));
      expect(stored.threads).toHaveLength(1);
      expect(stored.posts).toHaveLength(0);
      expect(stored.registry).toHaveLength(1);
      expect(stored.registry[0]).toMatchObject({
        chain: "solana",
        mint: MINT,
        threadId: first.threadId,
        latestSnapshot: prepared.snapshot,
      });
      expect(stored.run?.status).toBe("published");
    },
  );

  test("human canonical opener and its assessment remain unchanged while a reply bumps the board", async () => {
    const t = setup();
    const fixture = await seed(t, "bags", true);
    const prepared = await draft(t, fixture);
    const before = await t.run(async (ctx) => ({
      thread: await ctx.db.get("forumThreads", fixture.threadId!),
      assessment: await ctx.db.get(
        "researchQualityAssessments",
        fixture.assessmentId!,
      ),
    }));
    const result = await t.mutation(
      internal.forum.publishTokenForumContribution,
      prepared.args,
    );
    expect(result).toMatchObject({
      status: "published",
      threadId: fixture.threadId,
      postNumber: 2,
    });
    await t.mutation(
      internal.forum.publishTokenForumContribution,
      prepared.args,
    );
    const after = await t.run(async (ctx) => ({
      thread: await ctx.db.get("forumThreads", fixture.threadId!),
      assessment: await ctx.db.get(
        "researchQualityAssessments",
        fixture.assessmentId!,
      ),
      contribution: await ctx.db
        .query("researchQualityAssessments")
        .withIndex("by_runKey", (q) => q.eq("runKey", prepared.args.runKey))
        .unique(),
      board: await ctx.db.get("forumCategories", fixture.categoryId),
      posts: await ctx.db.query("forumPosts").take(10),
      subscriptions: await ctx.db
        .query("forumThreadSubscriptions")
        .withIndex("by_userId_and_threadId", (q) =>
          q.eq("userId", fixture.userId).eq("threadId", fixture.threadId!),
        )
        .take(10),
      notifications: await ctx.db.query("forumNotifications").take(10),
      citations: await ctx.db.query("forumAgentClaimCitations").take(10),
    }));
    expect(after.thread?.body).toBe(before.thread?.body);
    expect(after.thread?.authorId).toBe(fixture.humanId);
    expect(after.assessment).toEqual(before.assessment);
    expect(after.contribution?.threadId).toBeUndefined();
    expect(after.contribution?.status).toBe("passed");
    expect(after.posts).toHaveLength(1);
    expect(after.thread).toMatchObject({
      replyCount: 1,
      lastPostId: result.postId,
      lastPostAt: NOW,
    });
    expect(after.board).toMatchObject({
      threadCount: 1,
      postCount: 2,
      lastPostId: result.postId,
      lastPostAt: NOW,
    });
    expect(after.subscriptions).toHaveLength(1);
    expect(
      after.notifications.some(
        (row) =>
          row.recipientUserId === fixture.humanId &&
          row.postId === result.postId,
      ),
    ).toBe(true);
    expect(after.citations[0]).toMatchObject({
      postId: result.postId,
      assessmentId: after.contribution?._id,
    });
  });

  test("a second observation updates its AI-authored canonical thread instead of creating another", async () => {
    const t = setup();
    const fixture = await seed(t);
    const firstDraft = await draft(t, fixture);
    const first = await t.mutation(
      internal.forum.publishTokenForumContribution,
      firstDraft.args,
    );
    expect(first.status).toBe("published");
    vi.setSystemTime(NOW + 2_000);
    const followUp = await draft(
      t,
      { ...fixture, threadId: first.threadId },
      "token-alpha:bags:2026-10-21T21",
      true,
      {
        metricsAsOf: NOW + 1_000,
        observedAt: NOW + 1_500,
        priceUsd: 0.0000024,
        marketCapUsd: 2_400,
        holders: 60,
        volume1hUsd: 2_200,
      },
      firstDraft.snapshot,
    );
    const second = await t.mutation(
      internal.forum.publishTokenForumContribution,
      followUp.args,
    );
    expect(second).toMatchObject({
      status: "published",
      threadId: first.threadId,
      postNumber: 2,
    });
    expect(
      await t.run((ctx) => ctx.db.query("forumThreads").take(10)),
    ).toHaveLength(1);
    expect(
      await t.run((ctx) => ctx.db.query("forumPosts").take(10)),
    ).toHaveLength(1);
  });

  test.each([
    [false, "trust-revoked"],
    [true, "trust-revoked"],
    [false, "agent-revoked"],
    [true, "agent-revoked"],
    [false, "missing-trust"],
    [true, "missing-trust"],
    [false, "role-changed"],
    [true, "role-changed"],
  ] as const)(
    "rechecks post-claim identity for existing=%s and %s",
    async (existing, restriction) => {
      const t = setup();
      const fixture = await seed(t, "bags", existing);
      const prepared = await draft(t, fixture);
      await t.run(async (ctx) => {
        if (restriction === "trust-revoked") {
          await ctx.db.patch("users", fixture.userId, {
            forumTrustRevokedAt: NOW,
          });
        } else if (restriction === "agent-revoked") {
          await ctx.db.patch("users", fixture.userId, {
            agentRevokedAt: NOW,
          });
        } else if (restriction === "missing-trust") {
          await ctx.db.patch("users", fixture.userId, {
            forumTrustedAt: undefined,
          });
        } else {
          await ctx.db.patch("users", fixture.userId, { role: "admin" });
        }
      });
      await expect(
        t.mutation(internal.forum.publishTokenForumContribution, prepared.args),
      ).rejects.toThrow(/identity or public board/);
      expect(
        await t.run((ctx) => ctx.db.query("forumThreads").take(10)),
      ).toHaveLength(existing ? 1 : 0);
      expect(
        await t.run((ctx) => ctx.db.query("forumPosts").take(10)),
      ).toHaveLength(0);
    },
  );

  test.each(["new-baseline", "superseded-snapshot"] as const)(
    "rejects a %s at the final canonical commit",
    async (problem) => {
      const t = setup();
      const fixture = await seed(t, "bags", true);
      const prepared = await draft(t, fixture);
      await t.run(async (ctx) => {
        const canonical = await ctx.db
          .query("tokenAlphaTrackedTokens")
          .withIndex("by_chain_and_mint", (q) =>
            q.eq("chain", "solana").eq("mint", MINT),
          )
          .unique();
        await ctx.db.patch("tokenAlphaTrackedTokens", canonical!._id, {
          latestSnapshot: {
            ...prepared.snapshot,
            metricsAsOf:
              problem === "new-baseline"
                ? prepared.snapshot.metricsAsOf - 60_000
                : prepared.snapshot.metricsAsOf,
          },
        });
      });
      await expect(
        t.mutation(internal.forum.publishTokenForumContribution, prepared.args),
      ).rejects.toThrow(/superseded or its comparison baseline changed/);
      expect(
        await t.run((ctx) => ctx.db.query("forumPosts").take(10)),
      ).toHaveLength(0);
    },
  );

  test.each([
    "wrong-fence",
    "expired",
    "disabled",
    "paused",
    "not-eliza",
    "banned",
    "suspended",
    "private-ancestor",
    "closed-board",
    "stale",
    "body-tampered",
    "no-private-proof",
  ])("rejects %s without public writes", async (problem) => {
    const t = setup();
    const fixture = await seed(t);
    const prepared = await draft(
      t,
      fixture,
      undefined,
      problem !== "no-private-proof",
    );
    if (problem === "wrong-fence") prepared.args.claimToken = "wrong";
    if (problem === "not-eliza") vi.stubEnv("ELIZA_RUNTIME_MODE", "off");
    await t.run(async (ctx) => {
      if (problem === "expired")
        await ctx.db.patch("tokenAlphaRuns", prepared.runId, {
          expiresAt: NOW,
        });
      if (problem === "disabled")
        await ctx.db.patch("forumAgents", fixture.agentId, { enabled: false });
      if (problem === "paused")
        await ctx.db.patch("tokenAlphaControl", fixture.controlId, {
          enabled: false,
        });
      if (problem === "banned")
        await ctx.db.patch("users", fixture.userId, { forumBannedAt: NOW - 1 });
      if (problem === "suspended")
        await ctx.db.patch("users", fixture.userId, {
          forumSuspendedUntil: NOW + 60_000,
        });
      if (problem === "private-ancestor")
        await ctx.db.patch("forumCategories", fixture.parentId, {
          viewAccess: "members",
        });
      if (problem === "closed-board")
        await ctx.db.patch("forumCategories", fixture.categoryId, {
          threadAccess: "closed",
        });
      if (problem === "stale")
        await ctx.db.patch("tokenAlphaRuns", prepared.runId, {
          snapshot: { ...prepared.snapshot, metricsAsOf: NOW - 31 * 60_000 },
        });
      if (problem === "body-tampered")
        await ctx.db.patch("tokenAlphaRuns", prepared.runId, {
          body: prepared.rendered.body + " Extra unsupported claim.",
        });
    });
    const expectedError: Record<string, RegExp> = {
      "wrong-fence": /lease does not match/,
      expired: /active lease/,
      disabled: /agent or matching publication run/,
      paused: /disabled/,
      "not-eliza": /disabled/,
      banned: /identity or public board/,
      suspended: /identity or public board/,
      "private-ancestor": /identity or public board/,
      "closed-board": /cannot start threads/,
      stale: /fresh complete/,
      "body-tampered": /deterministic stored facts/,
      "no-private-proof": /publishable private draft/,
    };
    await expect(
      t.mutation(internal.forum.publishTokenForumContribution, prepared.args),
    ).rejects.toThrow(expectedError[problem]);
    expect(
      await t.run((ctx) => ctx.db.query("forumThreads").take(10)),
    ).toHaveLength(0);
  });

  test.each(["locked", "hidden", "moved", "wrong-canonical"])(
    "%s canonical target never produces a replacement thread",
    async (problem) => {
      const t = setup();
      const fixture = await seed(t, "bags", true);
      const prepared = await draft(t, fixture);
      await t.run(async (ctx) => {
        if (problem === "locked" || problem === "hidden")
          await ctx.db.patch("forumThreads", fixture.threadId!, {
            status: problem,
          });
        if (problem === "moved")
          await ctx.db.patch("forumThreads", fixture.threadId!, {
            categoryId: fixture.parentId,
            categorySlug: "crypto",
          });
        if (problem === "wrong-canonical")
          await ctx.db.patch("tokenAlphaRuns", prepared.runId, {
            threadId: undefined,
          });
      });
      await expect(
        t.mutation(internal.forum.publishTokenForumContribution, prepared.args),
      ).rejects.toThrow();
      expect(
        await t.run((ctx) => ctx.db.query("forumThreads").take(10)),
      ).toHaveLength(1);
      expect(
        await t.run((ctx) => ctx.db.query("forumPosts").take(10)),
      ).toHaveLength(0);
    },
  );

  test("global mint canonicalization prevents a second-platform duplicate", async () => {
    const t = setup();
    const fixture = await seed(t, "bags", true);
    await t.run(async (ctx) => {
      const config = TOKEN_ALPHA_AGENTS.pumpfun;
      const userId = await ctx.db.insert("users", {
        name: config.name,
        isAgent: true,
        agentSlug: config.slug,
        role: "reader",
        forumTrustedAt: NOW,
      });
      await ctx.db.insert("forumAgents", {
        slug: config.slug,
        name: config.name,
        userId,
        persona: "Pump watcher",
        model: "openrouter/free",
        dailyPostTarget: 24,
        enabled: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert("forumCategories", {
        slug: config.categorySlug,
        name: "Pump.fun",
        description: "Pump watches",
        kind: "board",
        parentCategoryId: fixture.parentId,
        status: "active",
        viewAccess: "public",
        threadAccess: "members",
        replyAccess: "members",
        position: 82,
        threadCount: 0,
        postCount: 0,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const prepared = await draft(t, { ...fixture, platform: "pumpfun" });
    await expect(
      t.mutation(internal.forum.publishTokenForumContribution, prepared.args),
    ).rejects.toThrow(/canonical thread/);
    expect(
      await t.run((ctx) => ctx.db.query("forumThreads").take(10)),
    ).toHaveLength(1);
  });

  test("quality findings remain private instead of bypassing the research gate", async () => {
    const t = setup();
    const fixture = await seed(t);
    const prepared = await draft(t, fixture);
    const result = await t.mutation(
      internal.forum.publishTokenForumContribution,
      { ...prepared.args, groundingScore: 0 },
    );
    expect(result.status).toBe("held");
    const stored = await t.run(async (ctx) => ({
      run: await ctx.db.get("tokenAlphaRuns", prepared.runId),
      threads: await ctx.db.query("forumThreads").take(10),
      packet: await ctx.db
        .query("forumAgentResearchPackets")
        .withIndex("by_runKey", (q) => q.eq("runKey", prepared.args.runKey))
        .unique(),
    }));
    expect(stored.run?.status).toBe("held");
    expect(stored.packet?.state).toBe("held");
    expect(stored.threads).toHaveLength(0);
  });

  test("the contribution endpoint is not public", async () => {
    // convex-test deliberately allows direct internal references. The native
    // endpoint metadata is the source of truth for public exposure instead.
    const registered = await import("./forum");
    expect(registered.publishTokenForumContribution.isInternal).toBe(true);
    expect("isPublic" in registered.publishTokenForumContribution).toBe(false);
  });
});
