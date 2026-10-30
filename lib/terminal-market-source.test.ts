import { describe, expect, test, vi } from "vitest";
import { SYMF_TOKEN } from "./symf-token";
import {
  MARKET_QUOTES,
  readPublicMarket,
  selectMarketBinding,
} from "./terminal-market-source";
import { parseMarketCandles } from "./symf-market-data";
import { parseMarketStats } from "./symf-market-overview";

const pair = {
  chainId: "solana",
  pairAddress: SYMF_TOKEN.pool,
  baseToken: { address: SYMF_TOKEN.mint },
  quoteToken: { address: MARKET_QUOTES[0] },
  liquidity: { usd: 1000 },
  fdv: 50000,
  marketCap: null,
};
describe("generic markets retain exact identity checks", () => {
  test("binds the exact base, allowed quote and liquid Solana pool", () => {
    expect(selectMarketBinding([pair], SYMF_TOKEN.mint)).toEqual({
      mint: SYMF_TOKEN.mint,
      pool: SYMF_TOKEN.pool,
      quote: MARKET_QUOTES[0],
    });
    for (const bad of [
      { ...pair, chainId: "ethereum" },
      { ...pair, baseToken: { address: MARKET_QUOTES[1] } },
      { ...pair, liquidity: { usd: NaN } },
      { ...pair, quoteToken: { address: "wrong" } },
    ])
      expect(() => selectMarketBinding([bad], SYMF_TOKEN.mint)).toThrow();
  });
  test("does not substitute FDV for market capitalization", () => {
    expect(
      parseMarketStats([pair], selectMarketBinding([pair], SYMF_TOKEN.mint)),
    ).toMatchObject({ marketCap: null, fdv: 50000 });
  });
  test("rejects a mismatched OHLCV base or quote", () => {
    const payload = {
      meta: {
        base: { address: SYMF_TOKEN.mint },
        quote: { address: MARKET_QUOTES[0] },
      },
      data: { attributes: { ohlcv_list: [[1, 1, 2, 1, 2, 100]] } },
    };
    expect(
      parseMarketCandles(payload, 100000, {
        mint: SYMF_TOKEN.mint,
        quote: MARKET_QUOTES[0],
      }),
    ).toHaveLength(1);
    expect(() =>
      parseMarketCandles(payload, 100000, {
        mint: MARKET_QUOTES[1],
        quote: MARKET_QUOTES[0],
      }),
    ).toThrow("wrong_market_token");
    expect(() =>
      parseMarketCandles(payload, 100000, {
        mint: SYMF_TOKEN.mint,
        quote: MARKET_QUOTES[1],
      }),
    ).toThrow("wrong_market_token");
  });
  test("bounds bytes while streaming and rejects arbitrary hosts before fetch", async () => {
    const fetcher = vi.fn(async () => new Response("[123456789]"));
    await expect(
      readPublicMarket("https://api.dexscreener.com/example", 5, fetcher),
    ).rejects.toThrow("too_large");
    fetcher.mockClear();
    await expect(
      readPublicMarket("https://attacker.test/data", 100, fetcher),
    ).rejects.toThrow("invalid_market_provider");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
