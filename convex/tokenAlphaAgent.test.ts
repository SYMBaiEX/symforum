// @vitest-environment node
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import type { TokenSnapshot } from "../lib/token-alpha";
import { OPENROUTER_TOKEN_SCOUT_MODEL } from "../lib/ai-models";
import { SolanaTrackerError } from "../lib/solana-tracker";
import { SolanaMintVerificationError } from "../lib/solana-mint-validation";

const mocks = vi.hoisted(() => ({
  rankings: vi.fn(),
  enrich: vi.fn(),
  verify: vi.fn(),
  generate: vi.fn(),
  route: vi.fn(),
  config: vi.fn(),
}));
vi.mock("../lib/solana-tracker", async (original) => ({
  ...(await original<typeof import("../lib/solana-tracker")>()),
  fetchTokenRankings: mocks.rankings,
  enrichTokenSnapshot: mocks.enrich,
}));
vi.mock("../lib/solana-mint-validation", async (original) => ({
  ...(await original<typeof import("../lib/solana-mint-validation")>()),
  verifySolanaMints: mocks.verify,
}));
vi.mock("./modelRouting", () => ({ convexModelRoutingConfig: mocks.config }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: mocks.generate,
}));
vi.mock("../lib/ai-model-routing", async (original) => ({
  ...(await original<typeof import("../lib/ai-model-routing")>()),
  runWithModelFallback: mocks.route,
}));

import {
  runTokenPilot,
  probeTokenData,
  tokenAnalysisIsSafe,
  tokenAnalysisValidationCode,
  withCachedTokenMetadata,
} from "./tokenAlphaAgent";

const NOW = Date.UTC(2026, 9, 21, 20);
const MINT = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
const ANALYSIS =
  "Trading activity is visible in this sample, but volume alone cannot establish lasting demand. I would watch whether liquidity and participation remain consistent over successive observations.";
const GUARANTEE_WARNING =
  "Liquidity describes funds available in the pool, not guaranteed execution at a quoted price; volume records trading activity, not lasting demand. Further observations are needed before drawing conclusions about participation.";
const CAPACITY_WARNING =
  "Liquidity describes reported available trading capacity, not guaranteed execution or price stability; volume reflects activity during the interval, not lasting demand. Further observations are needed before drawing conclusions about participation.";
const snapshot: TokenSnapshot = {
  platform: "bags",
  mint: MINT,
  name: "SYMBaiEX Forum",
  symbol: "SYMF",
  observedAt: NOW,
  metricsAsOf: NOW,
  priceUsd: 0.001,
  marketCapUsd: 1_000,
  holders: 50,
  volume1hUsd: 2_000,
  liquidityUsd: 10_000,
  priceChange1hPercent: 2,
  imageUrl: null,
  website: null,
  twitter: null,
  telegram: null,
  description: "A token supporting forum costs.",
  sourceUrl: `https://www.solanatracker.io/token/${MINT}`,
  sourceRank: 1,
};

function context(
  options: {
    claimed?: boolean;
    existing?: boolean;
    previous?: TokenSnapshot;
    tracked?: { mint: string; lastUpdatedAt: number; threadId: string }[];
  } = {},
) {
  const state: {
    snapshot?: TokenSnapshot;
    previous?: TokenSnapshot;
    threadId?: string;
  } = {};
  if (options.existing) state.threadId = "existing-thread";
  if (options.previous) state.previous = options.previous;
  const runMutation = vi.fn(
    async (
      ref: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) => {
      const name = getFunctionName(ref);
      if (name === "tokenAlphaData:claimRun")
        return options.claimed === false
          ? null
          : { runKey: "bags:2026-10-21T20" };
      if (name === "tokenAlphaData:reserveApiRequest") return true;
      if (name === "tokenAlphaData:saveSnapshot")
        state.snapshot = args.snapshot as TokenSnapshot;
      if (name === "forum:publishTokenForumContribution")
        return {
          status: "published",
          threadId: "published-thread",
          ...(options.existing ? { postId: "published-post" } : {}),
          categorySlug: "crypto-bags",
          title: "display-only",
        };
      return null;
    },
  );
  const runQuery = vi.fn(async (ref: Parameters<typeof getFunctionName>[0]) => {
    if (getFunctionName(ref) === "tokenAlphaData:getContext")
      return { tracked: options.tracked ?? [], metadata: [] };
    return state;
  });
  return {
    ctx: { runMutation, runQuery } as unknown as ActionCtx,
    runMutation,
    runQuery,
  };
}

function calls(ctx: ReturnType<typeof context>, name: string) {
  return ctx.runMutation.mock.calls
    .filter(([ref]) => getFunctionName(ref) === name)
    .map(([, args]) => args);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.resetAllMocks();
  vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
  vi.stubEnv("SOLANA_TRACKER_API_KEY", "synthetic-private-key");
  mocks.rankings.mockResolvedValue([snapshot]);
  mocks.enrich.mockResolvedValue(snapshot);
  mocks.verify.mockResolvedValue(new Set([MINT]));
  mocks.config.mockResolvedValue({});
  mocks.generate
    .mockResolvedValueOnce({
      output: { analysis: ANALYSIS },
      response: { modelId: "vendor/free" },
      usage: { inputTokens: 100, outputTokens: 60 },
    })
    .mockResolvedValueOnce({
      output: { approved: true, reason: "Source faithful." },
      response: { modelId: "vendor/free" },
      usage: { inputTokens: 180, outputTokens: 30 },
    });
  mocks.route.mockImplementation(async (_config, args) => ({
    value: await args.run(
      {
        provider: "openrouter",
        modelId: OPENROUTER_TOKEN_SCOUT_MODEL,
        persistedModel: OPENROUTER_TOKEN_SCOUT_MODEL,
      },
      new AbortController().signal,
    ),
    route: {
      persistedModel: OPENROUTER_TOKEN_SCOUT_MODEL,
      reservationKey: `reserve-${args.stage}`,
      reservationModel: OPENROUTER_TOKEN_SCOUT_MODEL,
    },
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("token pilot orchestration", () => {
  test("data probe verifies candidates without a draft, model call or publication", async () => {
    const ctx = context();
    expect(await probeTokenData(ctx.ctx, "bags")).toEqual({
      status: "ok",
      stage: "complete",
      indexed: 1,
      verified: 1,
    });
    const args = mocks.rankings.mock.calls[0][0];
    expect(await args.reserveRequest()).toBe(true);
    expect(calls(ctx, "tokenAlphaData:reserveApiRequest")).toEqual([
      { kind: "ranking" },
    ]);
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(0);
  });
  test.each(["rankings", "mint-verification"] as const)(
    "data probe reports only the safe %s stage on failure",
    async (stage) => {
      const failure = new Error("untrusted upstream body with private values");
      if (stage === "rankings") mocks.rankings.mockRejectedValue(failure);
      else mocks.verify.mockRejectedValue(failure);
      const ctx = context();
      expect(await probeTokenData(ctx.ctx, "pumpfun")).toEqual({
        status: "failed",
        stage,
        indexed: null,
        verified: null,
      });
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(0);
    },
  );
  test("disabled or duplicate run makes no external or model request", async () => {
    const ctx = context({ claimed: false });
    expect((await runTokenPilot(ctx.ctx, { platform: "bags" })).status).toBe(
      "skipped",
    );
    expect(mocks.rankings).not.toHaveBeenCalled();
    expect(mocks.generate).not.toHaveBeenCalled();
  });
  test.each([
    ["rankings", new SolanaTrackerError("http-429"), "http-429"],
    [
      "mint-verification",
      new SolanaMintVerificationError("timeout"),
      "timeout",
    ],
  ] as const)(
    "data probe and run retain only the safe %s failure code",
    async (stage, error, code) => {
      if (stage === "rankings") mocks.rankings.mockRejectedValue(error);
      else mocks.verify.mockRejectedValue(error);
      const ctx = context();
      expect(await probeTokenData(ctx.ctx, "bags")).toEqual({
        status: "failed",
        stage,
        code,
        indexed: null,
        verified: null,
      });
      expect(await runTokenPilot(ctx.ctx, { platform: "bags" })).toEqual({
        status: "failed",
        reason: `token-pilot-${stage}-failed:${code}`,
      });
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(0);
    },
  );
  test("invalid on-chain accounts are removed before generation", async () => {
    mocks.verify.mockResolvedValue(new Set());
    const ctx = context();
    expect((await runTokenPilot(ctx.ctx, { platform: "bags" })).status).toBe(
      "skipped",
    );
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(0);
  });
  test("final mint filtering reindexes ranking proof without changing volume order", async () => {
    const highest = {
      ...snapshot,
      mint: "A".repeat(44),
      sourceRank: 1,
      volume1hUsd: 5_000,
    };
    const excluded = {
      ...snapshot,
      mint: "B".repeat(44),
      sourceRank: 2,
      volume1hUsd: 3_000,
    };
    const selected = { ...snapshot, sourceRank: 3, volume1hUsd: 2_000 };
    mocks.rankings.mockResolvedValue([highest, excluded, selected]);
    mocks.verify.mockResolvedValue(new Set([highest.mint, selected.mint]));
    mocks.enrich.mockImplementation(async ({ snapshot: fresh }) => ({
      ...fresh,
      description: "Additional project metadata.",
      imageUrl: "https://example.com/token.png",
    }));
    const ctx = context({
      tracked: [
        { mint: highest.mint, lastUpdatedAt: NOW, threadId: "highest-thread" },
      ],
    });
    expect((await runTokenPilot(ctx.ctx, { platform: "bags" })).status).toBe(
      "published",
    );
    const reviewed = JSON.parse(
      mocks.generate.mock.calls[1][0].prompt.split("\n").at(-1),
    );
    expect(reviewed.rankingEvidence).toEqual([
      {
        mint: highest.mint,
        volume1hUsd: 5_000,
        sourceRank: 1,
        metricsAsOf: NOW,
      },
      {
        mint: selected.mint,
        volume1hUsd: 2_000,
        sourceRank: 2,
        metricsAsOf: NOW,
      },
    ]);
    expect(reviewed.snapshot).toMatchObject({
      mint: MINT,
      sourceRank: 2,
      volume1hUsd: 2_000,
      description: "Additional project metadata.",
    });
    expect(reviewed.rankingEvidence).not.toContainEqual(
      expect.objectContaining({ mint: excluded.mint }),
    );
    expect(mocks.rankings).toHaveBeenCalledTimes(1);
    expect(mocks.verify).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
  test.each([
    ["mint", "A".repeat(44)],
    ["platform", "pumpfun"],
    ["name", "Other identity\u202e"],
    ["symbol", "OTHER\u202e"],
    ["sourceRank", 2],
    ["volume1hUsd", 999],
    ["metricsAsOf", NOW + 1],
    ["observedAt", NOW + 1],
    ["priceUsd", 2],
    ["marketCapUsd", 2],
    ["holders", 2],
    ["liquidityUsd", 2],
    ["priceChange1hPercent", 3],
    ["sourceUrl", "https://www.solanatracker.io/token/other"],
  ] as const)(
    "metadata cannot overwrite ranked snapshot field %s",
    async (field, value) => {
      mocks.enrich.mockResolvedValue({ ...snapshot, [field]: value });
      const ctx = context();
      expect(await runTokenPilot(ctx.ctx, { platform: "bags" })).toEqual({
        status: "failed",
        reason: "token-pilot-metadata-failed",
      });
      expect(calls(ctx, "tokenAlphaData:saveSnapshot")).toHaveLength(0);
      expect(mocks.generate).not.toHaveBeenCalled();
      expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(0);
    },
  );
  test("in-place enrichment mutation cannot rewrite the captured ranking facts", async () => {
    mocks.enrich.mockImplementation(async ({ snapshot: fresh }) => {
      fresh.volume1hUsd = 999;
      return fresh;
    });
    const ctx = context();
    expect(await runTokenPilot(ctx.ctx, { platform: "bags" })).toEqual({
      status: "failed",
      reason: "token-pilot-metadata-failed",
    });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(calls(ctx, "tokenAlphaData:saveSnapshot")).toHaveLength(0);
  });
  test("RPC failure is fail-closed, without model work or publication", async () => {
    mocks.verify.mockRejectedValue(new Error("synthetic RPC failure"));
    const ctx = context();
    expect((await runTokenPilot(ctx.ctx, { platform: "bags" })).status).toBe(
      "failed",
    );
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(calls(ctx, "tokenAlphaData:finishRun")[0].status).toBe("failed");
    expect(calls(ctx, "tokenAlphaData:finishRun")[0].reason).toBe(
      "token-pilot-mint-verification-failed",
    );
  });
  test("successful path records usage, private proof and review before publishing once", async () => {
    const ctx = context();
    expect(await runTokenPilot(ctx.ctx, { platform: "bags" })).toEqual({
      status: "published",
      threadId: "published-thread",
    });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(calls(ctx, "forumAgentEditorialData:recordUsage")).toHaveLength(2);
    expect(
      calls(ctx, "forumAgentEditorialData:recordUsage").every(
        (args) => args.reservationKey,
      ),
    ).toBe(true);
    expect(
      calls(ctx, "forumAgentResearchPackets:recordPublicationDecision")[0]
        .publishable,
    ).toBe(true);
    expect(
      calls(ctx, "forumAgentResearchPackets:recordPublicationDecision")[0]
        .reason,
    ).toBe("token-snapshot-and-independent-review-passed");
    expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(1);
    for (const [, args, fallback] of mocks.route.mock.calls) {
      expect(fallback).toEqual([OPENROUTER_TOKEN_SCOUT_MODEL]);
      expect(args.agent).toBe("bags-scout");
    }
    expect(
      mocks.config.mock.calls.every(
        ([, options]) => options.elizaRuntime === "force",
      ),
    ).toBe(true);
  });
  test("initial review receives explicit null history and strict comparison instructions", async () => {
    const ctx = context();
    await runTokenPilot(ctx.ctx, { platform: "bags" });
    const prompt = mocks.generate.mock.calls[1][0].prompt;
    const reviewed = JSON.parse(prompt.split("\n").at(-1));
    expect(reviewed.snapshot).toEqual(snapshot);
    expect(reviewed.previous).toBeNull();
    expect(reviewed.rankingEvidence).toEqual([
      { mint: MINT, volume1hUsd: 2_000, sourceRank: 1, metricsAsOf: NOW },
    ]);
    expect(prompt).toContain(
      "final bounded scan sample of at most five eligible tokens returned by Solana Tracker",
    );
    expect(prompt).toContain(
      "sorted by rolling one-hour USD volume in non-increasing order and reindexed after finalized Solana mint validation",
    );
    expect(prompt).toContain(
      "Rank applies only within this validated scan cohort, not the complete Solana Tracker index",
    );
    expect(prompt).toContain(
      "sourceRank must equal each row's ordinal position starting at one",
    );
    expect(prompt).toContain(
      "selected snapshot must match its exact case-sensitive mint row's volume1hUsd, sourceRank and metricsAsOf",
    );
    expect(reviewed.body).toContain("1h price change: +2%");
    expect(reviewed.body).not.toContain("Change from the previous snapshot");
    expect(prompt).toContain(
      "Both snapshot formats refer only to the Solana chain",
    );
    expect(prompt).toContain("exact same case-sensitive mint and platform");
    expect(prompt).toContain(
      "finite metricsAsOf strictly earlier than snapshot.metricsAsOf",
    );
    expect(prompt).toContain(
      "For post-to-post deltas in the Change from the previous snapshot section only",
    );
    expect(prompt).toContain(
      "Unknown with no change inferred; never manufacture missing history",
    );
    expect(prompt).toContain(
      "An initial token watch may omit the post-to-post change section entirely",
    );
    expect(prompt).toContain(
      "snapshot.priceChange1hPercent and does not require previous",
    );
    expect(prompt).toContain(
      "check it directly against the current snapshot, not as a post-to-post delta",
    );
    expect(prompt).toContain("it is not volume traded since the previous post");
    expect(mocks.generate.mock.calls[1][0]).toMatchObject({
      maxOutputTokens: 3_000,
      maxRetries: 0,
    });
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
  test("follow-up review receives the exact prior snapshot underlying deterministic deltas", async () => {
    const previous = {
      ...snapshot,
      observedAt: NOW - 3_600_000,
      metricsAsOf: NOW - 3_600_000,
      priceUsd: 0.0005,
      marketCapUsd: 500,
      holders: 25,
      volume1hUsd: 1_000,
      warnings: ["Prior observation retained unchanged."],
    };
    const before = structuredClone(previous);
    const ctx = context({ existing: true, previous });
    expect((await runTokenPilot(ctx.ctx, { platform: "bags" })).status).toBe(
      "published",
    );
    const reviewed = JSON.parse(
      mocks.generate.mock.calls[1][0].prompt.split("\n").at(-1),
    );
    expect(reviewed.previous).toEqual(previous);
    expect(reviewed.rankingEvidence).toEqual([
      { mint: MINT, volume1hUsd: 2_000, sourceRank: 1, metricsAsOf: NOW },
    ]);
    expect(mocks.generate.mock.calls[1][0].prompt).toContain(
      "Rank applies only within this validated scan cohort",
    );
    expect(reviewed.body).toContain("Price: +$0.0005 (+100%)");
    expect(reviewed.body).toContain(
      "Rolling 1h volume window difference: +$1,000.00 (+100%)",
    );
    expect(previous).toEqual(before);
    const generated = JSON.parse(
      mocks.generate.mock.calls[0][0].prompt.split("\n").at(-1),
    );
    expect(generated).toEqual(snapshot);
    expect(generated).not.toHaveProperty("previous");
    expect(mocks.generate).toHaveBeenCalledTimes(2);
  });
  test.each([
    { ...snapshot, mint: MINT.replace("T", "t"), metricsAsOf: NOW - 1 },
    { ...snapshot, platform: "pumpfun" as const, metricsAsOf: NOW - 1 },
    { ...snapshot, metricsAsOf: NOW },
    { ...snapshot, metricsAsOf: NOW + 1 },
    { ...snapshot, metricsAsOf: Number.NaN },
  ])(
    "incomparable history stays auditable but produces no reviewable deltas: %j",
    async (previous) => {
      const before = structuredClone(previous);
      const ctx = context({ existing: true, previous });
      await runTokenPilot(ctx.ctx, { platform: "bags" });
      const reviewed = JSON.parse(
        mocks.generate.mock.calls[1][0].prompt.split("\n").at(-1),
      );
      expect(reviewed.previous).toEqual(JSON.parse(JSON.stringify(previous)));
      expect(reviewed.body).toContain(
        "Unknown: no earlier comparable snapshot is available. No change is inferred.",
      );
      expect(reviewed.body).not.toContain(
        "Rolling 1h volume window difference:",
      );
      expect(previous).toEqual(before);
      expect(mocks.generate).toHaveBeenCalledTimes(2);
    },
  );
  test("draft prompt rejects unbenchmarked magnitude claims and repeated promotional text", async () => {
    const ctx = context();
    await runTokenPilot(ctx.ctx, { platform: "bags" });
    const prompt = mocks.generate.mock.calls[0][0].prompt;
    expect(prompt).toContain(
      "for this named project and snapshot, never market-wide claims",
    );
    expect(prompt).toContain(
      "Do not add numerals, spelled-out numbers or counts",
    );
    expect(prompt).toContain(
      "small, large, substantial, tiny, huge, modest, high, low, strong, weak, deep, thin or healthy",
    );
    expect(prompt).toContain(
      "including phrases such as a small amount of trading",
    );
    expect(prompt).toContain(
      "explicitly name its benchmark from the supplied within-snapshot metrics",
    );
    expect(prompt).toContain(
      "comparison of rolling-hour trading volume in USD with reported liquidity in USD",
    );
    expect(prompt).toContain(
      "if volume is below liquidity, say rolling-hour volume is below reported liquidity, not trading volume is small",
    );
    expect(prompt).toContain("omit it if either value is unavailable");
    expect(prompt).toContain(
      "not strength, quality, lasting demand or an investment opportunity",
    );
    expect(prompt).toContain(
      "Do not turn lower trading volume into a favorable or unfavorable rating or suggest a trade",
    );
    expect(prompt).toContain(
      "brief conditional interpretation and uncertainty",
    );
    expect(prompt).toContain(
      "Do not repeat promotional claims from the project description",
    );
    expect(prompt).toContain(
      "prefer direct uncertainty wording such as liquidity does not establish execution quality or price stability, rather than using the word guaranteed",
    );
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({
      maxOutputTokens: 4_000,
      maxRetries: 0,
    });
  });
  test("an explicit retry preserves the source key and still uses only the forced Eliza bounded scout route", async () => {
    const ctx = context();
    const operatorRetryOf = "bags:2026-10-21T19";
    expect(
      (await runTokenPilot(ctx.ctx, { platform: "bags", operatorRetryOf }))
        .status,
    ).toBe("published");
    expect(calls(ctx, "tokenAlphaData:claimRun")[0]).toMatchObject({
      platform: "bags",
      operatorRetryOf,
    });
    expect(
      mocks.route.mock.calls.every(
        ([, , routes]) =>
          JSON.stringify(routes) ===
          JSON.stringify([OPENROUTER_TOKEN_SCOUT_MODEL]),
      ),
    ).toBe(true);
    expect(
      mocks.config.mock.calls.every(
        ([, options]) => options.elizaRuntime === "force",
      ),
    ).toBe(true);
  });
  test("review rejection preserves private draft and does not publish", async () => {
    mocks.generate
      .mockReset()
      .mockResolvedValueOnce({
        output: { analysis: ANALYSIS },
        response: { modelId: "vendor/free" },
        usage: {},
      })
      .mockResolvedValueOnce({
        output: { approved: false, reason: "Unsupported implication." },
        response: { modelId: "vendor/free" },
        usage: {},
      });
    const ctx = context();
    expect(await runTokenPilot(ctx.ctx, { platform: "bags" })).toEqual({
      status: "held",
      reason: "independent-review-rejected",
    });
    expect(
      calls(ctx, "forumAgentResearchPackets:recordPublicationDecision")[0],
    ).toMatchObject({
      publishable: false,
      reason: "token-independent-review-held:Unsupported implication.",
    });
    expect(calls(ctx, "tokenAlphaData:finishRun")[0]).toMatchObject({
      status: "held",
      reason: "independent-review-rejected",
    });
    expect(calls(ctx, "tokenAlphaData:saveDraft")).toHaveLength(0);
    expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(0);
  });
  test("rejected review details are bounded to the private decision only", async () => {
    const privateReason = `Private source quotation: ${"x".repeat(300)}`;
    mocks.generate
      .mockReset()
      .mockResolvedValueOnce({
        output: { analysis: ANALYSIS },
        response: { modelId: "vendor/free" },
        usage: {},
      })
      .mockResolvedValueOnce({
        output: { approved: false, reason: privateReason },
        response: { modelId: "vendor/free" },
        usage: {},
      });
    const ctx = context();
    const result = await runTokenPilot(ctx.ctx, { platform: "bags" });
    const [decision] = calls(
      ctx,
      "forumAgentResearchPackets:recordPublicationDecision",
    );
    expect(decision.reason).toBe(
      `token-independent-review-held:${privateReason}`.slice(0, 240),
    );
    expect((decision.reason as string).length).toBe(240);
    expect(result).toEqual({
      status: "held",
      reason: "independent-review-rejected",
    });
    for (const name of [
      "tokenAlphaData:finishRun",
      "forumAgentEditorialData:recordUsage",
    ])
      expect(JSON.stringify(calls(ctx, name))).not.toContain(
        "Private source quotation",
      );
    expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(0);
  });
  test("promotional source text stays in the private snapshot but not the reviewed draft", async () => {
    const description =
      "The official meme coin with real utility. Hop in early and ribbit your way to the top!";
    mocks.enrich.mockResolvedValue({ ...snapshot, description });
    const ctx = context();
    expect((await runTokenPilot(ctx.ctx, { platform: "bags" })).status).toBe(
      "published",
    );
    expect(calls(ctx, "tokenAlphaData:saveSnapshot")[0].snapshot).toMatchObject(
      { description },
    );
    const [revision] = calls(
      ctx,
      "forumAgentResearchPackets:recordDraftRevision",
    );
    const [decision] = calls(
      ctx,
      "forumAgentResearchPackets:recordPublicationDecision",
    );
    const [draft] = calls(ctx, "tokenAlphaData:saveDraft");
    expect(revision.body).toContain(
      "Project description (unverified): Withheld:",
    );
    expect(revision.body).not.toContain(description);
    expect(decision.body).toBe(revision.body);
    expect(draft.body).toBe(revision.body);
    const reviewed = JSON.parse(
      mocks.generate.mock.calls[1][0].prompt.split("\n").at(-1),
    );
    expect(reviewed.snapshot.description).toBe(description);
    expect(reviewed.body).toBe(revision.body);
  });
  test.each([GUARANTEE_WARNING, CAPACITY_WARNING])(
    "an explicit guarantee risk warning reaches independent review unchanged: %s",
    async (analysis) => {
      mocks.generate
        .mockReset()
        .mockResolvedValueOnce({
          output: { analysis },
          response: { modelId: "vendor/free" },
          usage: {},
        })
        .mockResolvedValueOnce({
          output: { approved: false, reason: "Independent quality hold." },
          response: { modelId: "vendor/free" },
          usage: {},
        });
      const ctx = context();
      expect(await runTokenPilot(ctx.ctx, { platform: "bags" })).toEqual({
        status: "held",
        reason: "independent-review-rejected",
      });
      expect(mocks.generate).toHaveBeenCalledTimes(2);
      const reviewed = JSON.parse(
        mocks.generate.mock.calls[1][0].prompt.split("\n").at(-1),
      );
      expect(reviewed.body).toContain(analysis);
      expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(0);
    },
  );
  test.each([
    ["length", "Short private draft."],
    ["characters", `${ANALYSIS} 123 private draft`],
    ["policy-phrase", `${ANALYSIS} Guaranteed execution is available.`],
  ] as const)(
    "local validation failure exposes only its fixed %s code",
    async (code, analysis) => {
      mocks.generate.mockReset().mockResolvedValueOnce({
        output: { analysis },
        response: { modelId: "vendor/free" },
        usage: {},
      });
      const ctx = context();
      const reason = `token-pilot-model-draft-failed:analysis-${code}`;
      expect(await runTokenPilot(ctx.ctx, { platform: "bags" })).toEqual({
        status: "failed",
        reason,
      });
      expect(calls(ctx, "tokenAlphaData:finishRun")[0]).toMatchObject({
        status: "failed",
        reason,
      });
      expect(
        calls(ctx, "forumAgentResearchPackets:recordDraftRevision"),
      ).toHaveLength(0);
      expect(
        calls(ctx, "forumAgentResearchPackets:recordPublicationDecision"),
      ).toHaveLength(0);
      expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(0);
      expect(mocks.generate).toHaveBeenCalledTimes(1);
      expect(calls(ctx, "forumAgentEditorialData:recordUsage")).toHaveLength(1);
      expect(
        JSON.stringify(calls(ctx, "tokenAlphaData:finishRun")),
      ).not.toContain(analysis);
    },
  );
  test("ambiguous generation failure is not retried or replaced by a fallback", async () => {
    mocks.route.mockRejectedValueOnce(new Error("unknown upstream outcome"));
    const ctx = context();
    expect((await runTokenPilot(ctx.ctx, { platform: "bags" })).status).toBe(
      "failed",
    );
    expect(mocks.route).toHaveBeenCalledTimes(1);
    expect(calls(ctx, "forum:publishTokenForumContribution")).toHaveLength(0);
  });
});

describe("opinion and metadata boundaries", () => {
  test.each([
    GUARANTEE_WARNING,
    CAPACITY_WARNING,
    `${ANALYSIS} Liquidity describes available pool funds, not guaranteed execution.`,
    `${ANALYSIS} Liquidity describes currently reported pool capacity, not guaranteed execution or price stability.`,
    `${ANALYSIS} Returns are not guaranteed.`,
    `${ANALYSIS} Execution is not guaranteed at a quoted price.`,
    `${ANALYSIS} Execution is not guaranteed.`,
  ])("accepts only explicit negated-guarantee warnings: %s", (analysis) => {
    expect(tokenAnalysisIsSafe(analysis)).toBe(true);
    expect(tokenAnalysisValidationCode(analysis)).toBeNull();
  });
  test.each([
    "Guaranteed execution at a quoted price.",
    "Guaranteed returns are available.",
    "Returns are guaranteed.",
    "Not not guaranteed execution at a quoted price.",
    "Returns are not not guaranteed.",
    "It is not true that returns are not guaranteed.",
    "It is a lie that returns are not guaranteed.",
    "The idea that returns are not guaranteed is a myth.",
    "Returns are not guaranteed? Absolutely.",
    "Execution is not guaranteed at a quoted price? Absolutely.",
    "Liquidity describes funds available in the pool, not guaranteed execution at a quoted price? Absolutely.",
    "Liquidity describes reported available trading capacity, not guaranteed execution or price stability? Absolutely.",
    "Liquidity describes reported available trading capacity, not guaranteed execution or price stability is a lie.",
    "Liquidity describes reported available trading capacity, not guaranteed execution or price stability, except for this token.",
    "Liquidity describes reported available trading capacity, not not guaranteed execution or price stability.",
    "It is a lie that liquidity describes reported available trading capacity, not guaranteed execution or price stability.",
    "The idea that liquidity describes reported available trading capacity, not guaranteed execution or price stability is a myth.",
    "Liquidity describes guaranteed returns, not guaranteed execution or price stability.",
    "Liquidity describes not guaranteed returns, not guaranteed execution or price stability.",
    "Liquidity describes buy now trading capacity, not guaranteed execution or price stability.",
    "Liquidity describes sell now trading capacity, not guaranteed execution or price stability.",
    "Liquidity describes risk-free trading capacity, not guaranteed execution or price stability.",
    "Liquidity describes audited trading capacity, not guaranteed execution or price stability.",
    "Liquidity describes a verified team, not guaranteed execution or price stability.",
    "Liquidity describes ape in trading capacity, not guaranteed execution or price stability.",
    "Liquidity describes a price target, not guaranteed execution or price stability.",
    "Liquidity describes reported capacity, additional detail, not guaranteed execution or price stability.",
    "Liquidity describes reported capacity: a promise, not guaranteed execution or price stability.",
    "Liquidity describes https://example.com capacity, not guaranteed execution or price stability.",
    "Liquidity describes www.example.com capacity, not guaranteed execution or price stability.",
    "Liquidity describes reported capacity, not guaranteed execution or price stability. Returns are guaranteed.",
    "Not guaranteed returns, only a snapshot of trading activity.",
    "Returns are not guaranteed, unless you use this token.",
    "No returns are not guaranteed.",
    "Returns are not guaranteed is false.",
    "Returns are not guaranteed except for this token.",
    "Not guaranteed execution and guaranteed returns.",
    "Not guaranteed returns. Execution is guaranteed.",
    "Not guaranteed safety.",
    "Not guaranteed returns. Do not buy now.",
    "Not guaranteed returns. Do not sell now.",
    "Not guaranteed returns. This is not audited.",
    "Not guaranteed returns. This is not a verified team.",
    "Not guaranteed returns. No price target is provided.",
    "Not guaranteed returns. No risk-free trade exists.",
    "Not guaranteed returns. Do not ape in.",
    "Not guaranteed returns. Visit https://example.com.",
    "Not guaranteed returns. Visit www.example.com.",
  ])(
    "keeps promises, ambiguous negation and all other policy phrases blocked: %s",
    (clause) => {
      const analysis = `${ANALYSIS} ${clause}`;
      expect(tokenAnalysisIsSafe(analysis)).toBe(false);
      expect(tokenAnalysisValidationCode(analysis)).toBe("policy-phrase");
    },
  );
  test("liquidity-warning descriptors have a bounded grammar, not a whole-phrase exemption", () => {
    const safe = `${ANALYSIS} Liquidity describes ${"a".repeat(120)}, not guaranteed execution or price stability.`;
    expect(tokenAnalysisIsSafe(safe)).toBe(true);
    expect(
      tokenAnalysisValidationCode(
        safe.replace("a".repeat(120), "a".repeat(121)),
      ),
    ).toBe("policy-phrase");
    expect(tokenAnalysisValidationCode(safe.replace("a".repeat(120), ""))).toBe(
      "policy-phrase",
    );
  });
  test("diagnostic categories preserve the existing length and character limits", () => {
    expect(tokenAnalysisValidationCode("x".repeat(79))).toBe("length");
    expect(tokenAnalysisValidationCode("x".repeat(80))).toBeNull();
    expect(tokenAnalysisValidationCode("x".repeat(700))).toBeNull();
    expect(tokenAnalysisValidationCode("x".repeat(701))).toBe("length");
    for (const character of ["1", "[", "]", "<", ">", "\n", "\u0000", "\u202e"])
      expect(tokenAnalysisValidationCode(`${ANALYSIS} ${character}`)).toBe(
        "characters",
      );
  });
  test("rejects new numerical, actionable or markup-bearing model claims", () => {
    expect(tokenAnalysisIsSafe(ANALYSIS)).toBe(true);
    for (const text of [
      ANALYSIS + " Buy now.",
      ANALYSIS + " 100%",
      ANALYSIS + " [img]",
      ANALYSIS + " https://evil.com",
    ])
      expect(tokenAnalysisIsSafe(text)).toBe(false);
  });
  test("cache preserves metadata age while numeric data stays fresh", () => {
    const cached = {
      ...snapshot,
      priceUsd: 999,
      observedAt: NOW - 1_000,
      metadataAsOf: NOW - 3_600_000,
    };
    const result = withCachedTokenMetadata(snapshot, cached, NOW);
    expect(result?.priceUsd).toBe(snapshot.priceUsd);
    expect(result?.metadataAsOf).toBe(cached.metadataAsOf);
    expect(
      withCachedTokenMetadata(
        snapshot,
        { ...cached, metadataAsOf: NOW - 25 * 3_600_000 },
        NOW,
      ),
    ).toBeNull();
    expect(
      withCachedTokenMetadata(snapshot, { ...cached, mint: "other-mint" }, NOW),
    ).toBeNull();
  });
});
