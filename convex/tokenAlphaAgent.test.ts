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
  withCachedTokenMetadata,
} from "./tokenAlphaAgent";

const NOW = Date.UTC(2026, 9, 21, 20);
const MINT = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
const ANALYSIS =
  "Trading activity is visible in this sample, but volume alone cannot establish lasting demand. I would watch whether liquidity and participation remain consistent over successive observations.";
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

function context(options: { claimed?: boolean; existing?: boolean } = {}) {
  const state: {
    snapshot?: TokenSnapshot;
    previous?: TokenSnapshot;
    threadId?: string;
  } = {};
  if (options.existing) state.threadId = "existing-thread";
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
      return { tracked: [], metadata: [] };
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
      "modest, high, low, strong, weak, deep, thin or healthy",
    );
    expect(prompt).toContain(
      "explicitly name its benchmark from the supplied within-snapshot metrics",
    );
    expect(prompt).toContain(
      "brief conditional interpretation and uncertainty",
    );
    expect(prompt).toContain(
      "Do not repeat promotional claims from the project description",
    );
    expect(mocks.generate).toHaveBeenCalledTimes(2);
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
