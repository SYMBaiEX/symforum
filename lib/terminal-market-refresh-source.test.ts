import { describe, expect, test } from "vitest";
import { SYMF_TOKEN } from "./symf-token";
import { snapshotToTerminal } from "./forum-terminal-data";
import type { TokenSnapshot } from "./token-alpha";
import {
  marketRefreshUrl,
  parseMarketRefresh,
  withRefreshedMarket,
} from "./terminal-market-refresh-source";

const NOW = 1_800_000_000_000;
const MINT = SYMF_TOKEN.mint;
const OTHER = "8Ta68iepck46U9PQzQvNPceN2f3mxJQN7dWe6CMYBAGS";
const pair = {
  chainId: "solana",
  pairAddress: SYMF_TOKEN.pool,
  baseToken: { address: MINT },
  quoteToken: { address: "So11111111111111111111111111111111111111112" },
  priceUsd: "2.5",
  marketCap: 750_000,
  fdv: 900_000,
  liquidity: { usd: 10_000 },
  volume: { h1: 1_000, h24: 20_000 },
  priceChange: { h1: -2.5 },
};
const snapshot: TokenSnapshot = {
  platform: "pumpfun",
  mint: MINT,
  name: "Sample",
  symbol: "EX",
  observedAt: NOW - 3_600_000,
  metricsAsOf: NOW - 3_600_000,
  priceUsd: 1,
  marketCapUsd: 75_000,
  holders: 123,
  volume1hUsd: 500,
  liquidityUsd: 5_000,
  priceChange1hPercent: 1,
  imageUrl: null,
  website: null,
  twitter: null,
  telegram: null,
  description: null,
  sourceUrl: `https://www.solanatracker.io/token/${MINT}`,
  sourceRank: 3,
};

describe("bounded public market batch adapter", () => {
  test("builds only one fixed Solana batch URL for distinct validated addresses", () => {
    expect(marketRefreshUrl([MINT, OTHER])).toBe(
      `https://api.dexscreener.com/tokens/v1/solana/${MINT},${OTHER}`,
    );
    for (const mints of [
      [],
      ["https://attacker.test"],
      [MINT, MINT],
      Array(31).fill(MINT),
    ])
      expect(() => marketRefreshUrl(mints)).toThrow();
  });
  test("binds exact chain, base, liquid pool and SOL/USDC quote; ignores extra assets", () => {
    const result = parseMarketRefresh(
      [pair, { ...pair, baseToken: { address: OTHER } }],
      [MINT],
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      mint: MINT,
      state: "available",
      priceUsd: 2.5,
      marketCapUsd: 750_000,
      priceChange1hPercent: -2.5,
    });
    for (const bad of [
      { ...pair, chainId: "ethereum" },
      { ...pair, baseToken: { address: OTHER } },
      { ...pair, quoteToken: { address: OTHER } },
      { ...pair, liquidity: { usd: 0 } },
      { ...pair, priceUsd: "NaN" },
      { ...pair, pairAddress: "bad" },
    ])
      expect(parseMarketRefresh([bad], [MINT], NOW)[0].state).toBe(
        "unavailable",
      );
    expect(parseMarketRefresh([pair, pair], [MINT], NOW)[0].state).toBe(
      "unavailable",
    );
    expect(
      parseMarketRefresh(Array(101).fill(pair), [MINT], NOW)[0].state,
    ).toBe("unavailable");
    expect(() => parseMarketRefresh({}, [MINT], NOW)).toThrow();
    expect(() => parseMarketRefresh([], [MINT], NaN)).toThrow();
  });
  test("missing fields stay unknown; market cap never falls back to FDV", () => {
    expect(
      parseMarketRefresh(
        [{ ...pair, marketCap: null, volume: {}, priceChange: {} }],
        [MINT],
        NOW,
      )[0],
    ).toMatchObject({
      state: "available",
      marketCapUsd: null,
      fdvUsd: 900_000,
      volume1hUsd: null,
      volume24hUsd: null,
      priceChange1hPercent: null,
    });
    expect(parseMarketRefresh([], [MINT], NOW)[0]).toMatchObject({
      state: "unavailable",
      priceUsd: null,
      marketCapUsd: null,
      sourceUrl: null,
    });
  });
  test("display overlays preserve holder time and original scout evidence", () => {
    const original = snapshotToTerminal(snapshot);
    const quote = parseMarketRefresh([pair], [MINT], NOW)[0];
    const merged = withRefreshedMarket(original, quote, NOW);
    expect(merged).toMatchObject({
      priceUsd: 2.5,
      marketCapUsd: 750_000,
      holders: 123,
      metricsAsOf: snapshot.metricsAsOf,
      observedAt: snapshot.observedAt,
      sourceRank: 3,
      sourceUrl: snapshot.sourceUrl,
      marketData: { state: "available", checkedAt: NOW },
    });
    expect(original).toEqual(snapshotToTerminal(snapshot));
    expect(
      withRefreshedMarket(
        original,
        { ...quote, checkedAt: original.metricsAsOf - 1 },
        NOW,
      ),
    ).toBe(original);
    for (const checkedAt of [NaN, Infinity, 0])
      expect(withRefreshedMarket(original, { ...quote, checkedAt }, NOW)).toBe(
        original,
      );
    expect(
      withRefreshedMarket(original, { ...quote, checkedAt: NOW + 60_001 }, NOW),
    ).toBe(original);
    const missing = parseMarketRefresh([], [MINT], NOW)[0];
    expect(withRefreshedMarket(original, missing, NOW)).toMatchObject({
      priceUsd: null,
      holders: 123,
      metricsAsOf: snapshot.metricsAsOf,
      marketData: { state: "unavailable" },
    });
  });
});
