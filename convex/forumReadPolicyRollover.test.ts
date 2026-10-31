/// <reference types="vite/client" />
import { RateLimiter } from "@convex-dev/rate-limiter";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { FORUM_READ_POLICY } from "../lib/forum-read-policy";
import { SYMF_TOKEN } from "../lib/symf-token";
import { classifyMarketCap } from "../lib/forum-market-cap";
import { components } from "./_generated/api";
import { commerceLimiter } from "./forumCommerce";
import { marketReadLimiter } from "./forumMarketData";
import { terminalReadLimiter } from "./forumTerminalData";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 31, 12);
const MIDNIGHT = Date.UTC(2026, 10, 1);
const claim = makeFunctionReference<
  "mutation",
  { lease: string },
  { fetch: boolean; state: string }
>("forumTerminalRefresh:claim");
function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  return t;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected external transport");
    }),
  );
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

for (const kind of ["terminal", "commerce"] as const)
  for (const remaining of [0, 3])
    test(`${kind} old-cap row retains exactly${remaining} remaining units until the natural UTC reset`, async () => {
      const t = setup();
      const name =
        kind === "terminal" ? "terminalReadDaily" : "commerceNetworkDaily";
      const oldCap = kind === "terminal" ? 100 : 1_000;
      const newCap =
        kind === "terminal"
          ? FORUM_READ_POLICY.terminalDailyUnits
          : FORUM_READ_POLICY.commerceDailyUnits;
      const oldLimiter = new RateLimiter(components.rateLimiter, {
        [name]: { kind: "fixed window", rate: oldCap, period: DAY, start: 0 },
      });
      expect(
        await t.run((ctx) =>
          oldLimiter.limit(ctx, name, {
            key: "all",
            count: oldCap - remaining,
          }),
        ),
      ).toMatchObject({ ok: true });
      const check = (count: number) =>
        t.run((ctx) =>
          kind === "terminal"
            ? marketReadLimiter.check(ctx, "terminalReadDaily", {
                key: "all",
                count,
              })
            : commerceLimiter.check(ctx, "commerceNetworkDaily", {
                key: "all",
                count,
              }),
        );
      const consume = (count: number) =>
        t.run((ctx) =>
          kind === "terminal"
            ? terminalReadLimiter.limit(ctx, "terminalReadDaily", {
                key: "all",
                count,
              })
            : commerceLimiter.limit(ctx, "commerceNetworkDaily", {
                key: "all",
                count,
              }),
        );
      // New source configuration must not silently refill/reset the existing row.
      expect(await check(remaining + 1)).toMatchObject({ ok: false });
      if (remaining) {
        expect(await check(remaining)).toMatchObject({ ok: true });
        expect(await consume(1)).toMatchObject({ ok: true });
        expect(await check(remaining)).toMatchObject({ ok: false });
        expect(await check(remaining - 1)).toMatchObject({ ok: true });
      }
      vi.setSystemTime(MIDNIGHT - 1);
      expect(await check(remaining ? remaining : 1)).toMatchObject({
        ok: false,
      });
      vi.setSystemTime(MIDNIGHT);
      expect(await consume(newCap)).toMatchObject({ ok: true });
      expect(await check(1)).toMatchObject({ ok: false });
    });

for (const remaining of [0, 3])
  test(`actual Markets claim preserves the old48-cap row's${remaining} remaining units and activates144 only at UTC reset`, async () => {
    const t = setup();
    const oldLimiter = new RateLimiter(components.rateLimiter, {
      terminalSampleRefreshDaily: {
        kind: "fixed window",
        rate: 48,
        period: DAY,
        start: 0,
      },
    });
    // This matching-config reader measures the same ledger used by actual claim.
    const newLimiter = new RateLimiter(components.rateLimiter, {
      terminalSampleRefreshDaily: {
        kind: "fixed window",
        rate: FORUM_READ_POLICY.marketSampleDailyRefreshes,
        period: DAY,
        start: 0,
      },
    });
    await t.run(async (ctx) => {
      await oldLimiter.limit(ctx, "terminalSampleRefreshDaily", {
        key: "all",
        count: 48 - remaining,
      });
      await ctx.db.insert("forumTerminalMarkets", {
        mint: SYMF_TOKEN.mint,
        platform: "pumpfun",
        band: classifyMarketCap(75_000),
        observedAt: NOW,
        snapshot: {
          platform: "pumpfun",
          mint: SYMF_TOKEN.mint,
          name: "Test",
          symbol: "T",
          observedAt: NOW,
          metricsAsOf: NOW,
          priceUsd: 1,
          marketCapUsd: 75_000,
          holders: 1,
          volume1hUsd: 0,
          liquidityUsd: 1,
          priceChange1hPercent: 0,
          imageUrl: null,
          website: null,
          twitter: null,
          telegram: null,
          description: null,
          sourceUrl: `https://www.solanatracker.io/token/${SYMF_TOKEN.mint}`,
          sourceRank: 1,
        },
      });
    });
    const sameDay = await t.mutation(claim, { lease: "same-day" });
    expect(sameDay).toMatchObject(
      remaining
        ? { fetch: true, state: "loading" }
        : { fetch: false, state: "budget" },
    );
    if (remaining) {
      expect(
        await t.run((ctx) =>
          newLimiter.check(ctx, "terminalSampleRefreshDaily", {
            key: "all",
            count: remaining - 1,
          }),
        ),
      ).toMatchObject({ ok: true });
      expect(
        await t.run((ctx) =>
          newLimiter.check(ctx, "terminalSampleRefreshDaily", {
            key: "all",
            count: remaining,
          }),
        ),
      ).toMatchObject({ ok: false });
    } else {
      expect(
        await t.run((ctx) =>
          marketReadLimiter.check(ctx, "terminalReadDaily", {
            key: "all",
            count: FORUM_READ_POLICY.terminalDailyUnits,
          }),
        ),
      ).toMatchObject({ ok: true });
      expect(
        await t.run((ctx) =>
          commerceLimiter.check(ctx, "commerceNetworkDaily", {
            key: "all",
            count: FORUM_READ_POLICY.commerceDailyUnits,
          }),
        ),
      ).toMatchObject({ ok: true });
    }
    vi.setSystemTime(MIDNIGHT);
    expect(await t.mutation(claim, { lease: "new-utc-day" })).toMatchObject({
      fetch: true,
      state: "loading",
    });
    expect(
      await t.run((ctx) =>
        newLimiter.check(ctx, "terminalSampleRefreshDaily", {
          key: "all",
          count: FORUM_READ_POLICY.marketSampleDailyRefreshes - 1,
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      await t.run((ctx) =>
        newLimiter.check(ctx, "terminalSampleRefreshDaily", {
          key: "all",
          count: FORUM_READ_POLICY.marketSampleDailyRefreshes,
        }),
      ),
    ).toMatchObject({ ok: false });
  });
