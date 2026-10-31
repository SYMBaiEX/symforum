// @vitest-environment node
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ActionCtx } from "./_generated/server";
import type { TokenSnapshot } from "../lib/token-alpha";
import { SolanaTrackerError } from "../lib/solana-tracker";

const mocks = vi.hoisted(() => ({
  rankings: vi.fn(),
  verify: vi.fn(),
  enrich: vi.fn(),
  route: vi.fn(),
  config: vi.fn(),
  generate: vi.fn(),
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
vi.mock("../lib/ai-model-routing", async (original) => ({
  ...(await original<typeof import("../lib/ai-model-routing")>()),
  runWithModelFallback: mocks.route,
}));
vi.mock("./modelRouting", () => ({ convexModelRoutingConfig: mocks.config }));
vi.mock("ai", async (original) => ({
  ...(await original<typeof import("ai")>()),
  generateText: mocks.generate,
}));

import { observeTokenData, runScheduledTokenPilot } from "./tokenAlphaAgent";
const NOW = Date.parse("2026-10-30T19:12:00Z");
const RUN = "bags:2026-10-30T19";
const MINT = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
const sample: TokenSnapshot = {
  platform: "bags",
  mint: MINT,
  name: "Sample",
  symbol: "SAMPLE",
  observedAt: NOW,
  metricsAsOf: NOW,
  priceUsd: 0.001,
  marketCapUsd: 75_000,
  holders: 123,
  volume1hUsd: 5000,
  liquidityUsd: 15_000,
  priceChange1hPercent: 3,
  imageUrl: null,
  website: null,
  twitter: null,
  telegram: null,
  description: "Source-reported project description.",
  sourceUrl: `https://www.solanatracker.io/token/${MINT}`,
  sourceRank: 1,
};
type ContextOptions = {
  source?: "claimed" | "ready" | "unavailable";
  modelClaim?: boolean;
  complete?: boolean;
  budget?: boolean;
  runKey?: string;
};
function context(options: ContextOptions = {}) {
  const runMutation = vi.fn(
    async (
      ref: Parameters<typeof getFunctionName>[0],
      args: Record<string, unknown>,
    ) => {
      switch (getFunctionName(ref)) {
        case "tokenAlphaObservationData:claim":
          return {
            state: options.source ?? "claimed",
            runKey: options.runKey ?? RUN,
            snapshots: options.source === "ready" ? [sample] : [],
          };
        case "tokenAlphaObservationData:complete":
          return options.complete ?? true;
        case "tokenAlphaData:claimRun":
          return options.modelClaim ? { runKey: RUN } : null;
        case "tokenAlphaData:reserveApiRequest":
          return options.budget ?? true;
        default:
          void args;
          return null;
      }
    },
  );
  const runQuery = vi.fn(async (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "tokenAlphaData:getContext"
      ? { tracked: [], metadata: [] }
      : { snapshot: sample },
  );
  return {
    ctx: { runMutation, runQuery } as unknown as ActionCtx,
    runMutation,
    runQuery,
  };
}
const calls = (c: ReturnType<typeof context>, name: string) =>
  c.runMutation.mock.calls
    .filter(([ref]) => getFunctionName(ref) === name)
    .map(([, args]) => args);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.resetAllMocks();
  vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
  vi.stubEnv("SOLANA_TRACKER_API_KEY", "synthetic-private-key");
  mocks.rankings.mockResolvedValue([sample]);
  mocks.verify.mockResolvedValue(new Set([MINT]));
  mocks.enrich.mockResolvedValue(sample);
  mocks.config.mockResolvedValue({});
  mocks.route.mockRejectedValue(new Error("synthetic_model_stop"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

test("fresh source observation completes before unchanged held model admission, with no inference/publication", async () => {
  const c = context();
  expect(await runScheduledTokenPilot(c.ctx, { platform: "bags" })).toEqual({
    status: "skipped",
    reason: "disabled-gated-or-already-claimed",
  });
  expect(mocks.rankings).toHaveBeenCalledTimes(1);
  expect(mocks.verify).toHaveBeenCalledWith([MINT]);
  expect(calls(c, "tokenAlphaObservationData:complete")[0].snapshots).toEqual([
    sample,
  ]);
  expect(calls(c, "tokenAlphaData:claimRun")).toHaveLength(1);
  const names = c.runMutation.mock.calls.map(([ref]) => getFunctionName(ref));
  expect(names.indexOf("tokenAlphaObservationData:complete")).toBeLessThan(
    names.indexOf("tokenAlphaData:claimRun"),
  );
  expect(mocks.route).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(calls(c, "forum:publishTokenForumContribution")).toEqual([]);
});

test("same-hour ready source is reused by an admitted run, never fetched or projected twice", async () => {
  const c = context({ source: "ready", modelClaim: true });
  expect(
    (await runScheduledTokenPilot(c.ctx, { platform: "bags" })).status,
  ).toBe("failed");
  expect(mocks.rankings).not.toHaveBeenCalled();
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(calls(c, "tokenAlphaObservationData:complete")).toEqual([]);
  expect(calls(c, "forumTerminalData:recordSnapshots")).toEqual([]);
  expect(calls(c, "tokenAlphaData:saveSnapshot")[0].snapshot).toEqual(sample);
  expect(mocks.route).toHaveBeenCalledTimes(1);
});

test("unavailable or incomplete source intent never reads providers or claims a model run", async () => {
  const c = context({ source: "unavailable", modelClaim: true });
  expect(await runScheduledTokenPilot(c.ctx, { platform: "bags" })).toEqual({
    status: "skipped",
    reason: "source-observation-unavailable",
  });
  expect(mocks.rankings).not.toHaveBeenCalled();
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(calls(c, "tokenAlphaData:claimRun")).toEqual([]);
  expect(mocks.route).not.toHaveBeenCalled();
});

test("failed source attempt records only a safe code and cannot reach model admission", async () => {
  const c = context({ modelClaim: true });
  mocks.rankings.mockRejectedValue(new SolanaTrackerError("http-429"));
  expect(
    (await runScheduledTokenPilot(c.ctx, { platform: "bags" })).reason,
  ).toBe("source-observation-unavailable");
  expect(calls(c, "tokenAlphaObservationData:fail")[0].reason).toBe(
    "token-source-rankings-failed:http-429",
  );
  expect(calls(c, "tokenAlphaData:claimRun")).toEqual([]);
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.route).not.toHaveBeenCalled();
});

test("source completion revoked or denied cannot authorize model generation", async () => {
  const c = context({ complete: false, modelClaim: true });
  expect(
    (await runScheduledTokenPilot(c.ctx, { platform: "bags" })).reason,
  ).toBe("source-observation-unavailable");
  expect(calls(c, "tokenAlphaData:claimRun")).toEqual([]);
  expect(mocks.route).not.toHaveBeenCalled();
});

test("source uses the unchanged shared ranking reservation and respects denial", async () => {
  const c = context({ budget: false });
  mocks.rankings.mockImplementation(
    async (options: { reserveRequest: () => Promise<boolean> }) => {
      if (!(await options.reserveRequest()))
        throw new SolanaTrackerError("budget-denied");
      return [sample];
    },
  );
  expect((await observeTokenData(c.ctx, "bags")).state).toBe("unavailable");
  expect(calls(c, "tokenAlphaData:reserveApiRequest")).toEqual([
    { kind: "ranking" },
  ]);
  expect(calls(c, "tokenAlphaObservationData:fail")[0].reason).toBe(
    "token-source-rankings-failed:budget-denied",
  );
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.route).not.toHaveBeenCalled();
});

test("an observation from another hour cannot create a new ordinary model claim", async () => {
  const c = context({
    source: "ready",
    runKey: "bags:2026-10-30T18",
    modelClaim: true,
  });
  expect(
    (await runScheduledTokenPilot(c.ctx, { platform: "bags" })).reason,
  ).toBe("source-observation-unavailable");
  expect(calls(c, "tokenAlphaData:claimRun")).toEqual([]);
  expect(mocks.route).not.toHaveBeenCalled();
});

test("false operator flag is still an ordinary bounded source invocation", async () => {
  const c = context({ source: "unavailable", modelClaim: true });
  expect(
    (
      await runScheduledTokenPilot(c.ctx, {
        platform: "bags",
        operatorFirstPost: false,
      })
    ).reason,
  ).toBe("source-observation-unavailable");
  expect(calls(c, "tokenAlphaObservationData:claim")).toHaveLength(1);
  expect(calls(c, "tokenAlphaData:claimRun")).toEqual([]);
});

test("operator recovery remains on its existing separate admission path", async () => {
  const c = context();
  await runScheduledTokenPilot(c.ctx, {
    platform: "bags",
    operatorRetryOf: "old-explicit-authority",
  });
  expect(calls(c, "tokenAlphaObservationData:claim")).toEqual([]);
  expect(calls(c, "tokenAlphaData:claimRun")[0]).toMatchObject({
    operatorRetryOf: "old-explicit-authority",
  });
  expect(mocks.rankings).not.toHaveBeenCalled();
});

test("a successful empty segment gets one broader scan within the existing enrichment pool", async () => {
  const c = context();
  mocks.rankings
    .mockImplementationOnce(async (options) => {
      expect(options.capBand).not.toBe("all");
      expect(await options.reserveRequest()).toBe(true);
      return [];
    })
    .mockImplementationOnce(async (options) => {
      expect(options.capBand).toBe("all");
      expect(await options.reserveRequest()).toBe(true);
      return [sample];
    });
  const observed = await observeTokenData(c.ctx, "bags");
  expect(observed.snapshots).toEqual([sample]);
  expect(mocks.rankings).toHaveBeenCalledTimes(2);
  expect(calls(c, "tokenAlphaData:reserveApiRequest")).toEqual([
    { kind: "ranking" },
    { kind: "enrichment" },
  ]);
  expect(mocks.verify).toHaveBeenCalledWith([MINT]);
  expect(mocks.route).not.toHaveBeenCalled();
});

test("empty fallback exhausts its single attempt and never reaches inference", async () => {
  const c = context();
  mocks.rankings.mockResolvedValue([]);
  const observed = await observeTokenData(c.ctx, "bags");
  expect(observed.snapshots).toEqual([]);
  expect(mocks.rankings).toHaveBeenCalledTimes(2);
  expect(mocks.route).not.toHaveBeenCalled();
});

test("fallback budget denial cannot buy data or reattempt the original segment", async () => {
  const c = context({ budget: false });
  mocks.rankings
    .mockResolvedValueOnce([])
    .mockImplementationOnce(async (options) => {
      if (!(await options.reserveRequest()))
        throw new SolanaTrackerError("budget-denied");
      throw Error("Denied requests must not reach the provider");
    });
  expect((await observeTokenData(c.ctx, "bags")).state).toBe("unavailable");
  expect(mocks.rankings).toHaveBeenCalledTimes(2);
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.route).not.toHaveBeenCalled();
});
