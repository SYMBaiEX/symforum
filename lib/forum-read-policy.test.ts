import { describe, expect, test } from "vitest";
import { FORUM_READ_POLICY, rpcCreditCost } from "./forum-read-policy";

describe("approved provider read policy (pure data, not activated admission)", () => {
  test("pins feature ceilings without changing the Markets interval", () => {
    expect(FORUM_READ_POLICY.terminalDailyUnits).toBe(6_000);
    expect(FORUM_READ_POLICY.commerceDailyUnits).toBe(20_000);
    expect(FORUM_READ_POLICY.marketSampleDailyRefreshes).toBe(144);
    expect(FORUM_READ_POLICY.marketSampleIntervalMs).toBe(600_000);
    expect(86_400_000 / FORUM_READ_POLICY.marketSampleIntervalMs).toBe(144);
  });

  test("keeps provider windows and unchanged restrictive Tracker subquotas explicit", () => {
    expect(FORUM_READ_POLICY.helius).toEqual({
      dailyCredits: 10_000,
      rollingCredits: 300_000,
      rollingDays: 32,
      requestsPerWindow: 5,
      windowMs: 1_000,
      sendRequestsPerWindow: 1,
      sendWindowMs: 1_000,
    });
    expect(FORUM_READ_POLICY.jupiter).toEqual({
      requestsPerWindow: 50,
      keylessRequestsPerWindow: 25,
      windowMs: 60_000,
    });
    expect(FORUM_READ_POLICY.dexscreener).toEqual({
      requestsPerWindow: 60,
      windowMs: 60_000,
    });
    expect(FORUM_READ_POLICY.geckoterminal).toEqual({
      requestsPerWindow: 8,
      windowMs: 60_000,
    });
    expect(FORUM_READ_POLICY.tracker).toEqual({
      dailyRequests: 70,
      dailyCandles: 12,
      dailyEnrichments: 10,
      rollingRequests: 2_300,
      rollingDays: 32,
    });
    expect(
      48 +
        FORUM_READ_POLICY.tracker.dailyCandles +
        FORUM_READ_POLICY.tracker.dailyEnrichments,
    ).toBe(FORUM_READ_POLICY.tracker.dailyRequests);
    expect(
      FORUM_READ_POLICY.tracker.dailyRequests *
        FORUM_READ_POLICY.tracker.rollingDays,
    ).toBeLessThanOrEqual(FORUM_READ_POLICY.tracker.rollingRequests);
  });

  test("daily Helius allowance cannot bypass the separately tighter rolling credit ceiling", () => {
    expect(
      FORUM_READ_POLICY.helius.dailyCredits *
        FORUM_READ_POLICY.helius.rollingDays,
    ).toBe(320_000);
    expect(FORUM_READ_POLICY.helius.rollingCredits).toBeLessThan(320_000);
    expect(FORUM_READ_POLICY.helius.rollingCredits).toBeLessThan(1_000_000);
  });

  test("200 cold wallets, five shared intervals, overview batches and risk checks fit only the internal terminal arithmetic", () => {
    const walletUnits = 200 * 5;
    const chartUnits = 5 * (86_400_000 / 300_000) * 2;
    const batchUnits = FORUM_READ_POLICY.marketSampleDailyRefreshes;
    const riskUnits = 200;
    expect(walletUnits + chartUnits + batchUnits).toBe(4_024);
    expect(walletUnits + chartUnits + batchUnits + riskUnits).toBe(4_224);
    expect(4_224).toBeLessThan(FORUM_READ_POLICY.terminalDailyUnits);
    // This is an admission ceiling, not a guarantee of provider availability.
    const geckoDemand = 1_440 * 7 + 1_440 + 5 * 288;
    expect(geckoDemand).toBe(12_960);
    expect(geckoDemand).toBeGreaterThan(
      FORUM_READ_POLICY.geckoterminal.requestsPerWindow * 1_440,
    );
  });
});

describe("actual standard RPC method cost allowlist", () => {
  test.each([
    "getAccountInfo",
    "getBalance",
    "getBlockHeight",
    "getFeeForMessage",
    "getFirstAvailableBlock",
    "getGenesisHash",
    "getLatestBlockhash",
    "getMultipleAccounts",
    "getSignatureStatuses",
    "getSignaturesForAddress",
    "getTokenAccountsByOwner",
    "getTransaction",
    "isBlockhashValid",
    "simulateTransaction",
    "sendTransaction",
  ])(
    "classifies %s without invoking any transport or financial callback",
    (method) => {
      expect(rpcCreditCost(method)).toBe(1);
    },
  );

  test.each([
    "",
    " getBalance",
    "getBalance ",
    "GetBalance",
    "getbalance",
    "getTransactionV2",
    "getProgramAccounts",
    "getProgramAccountsV2",
    "getAsset",
    "getTokenAccounts",
    "getTransactionsForAddress",
    "getTransfersByAddress",
    "constructor",
    "toString",
    "__proto__",
  ])(
    "denies unknown or non-allowlisted method %j rather than assigning one credit",
    (method) => {
      expect(rpcCreditCost(method)).toBeNull();
    },
  );
});
