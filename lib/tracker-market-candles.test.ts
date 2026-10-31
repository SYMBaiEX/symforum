import { describe, expect, test, vi } from "vitest";
import { SYMF_TOKEN } from "./symf-token";
import {
  MARKET_QUOTES,
  readPublicMarket,
  readTrackerMarket,
} from "./terminal-market-source";
import { parseMarketCandles, parseSymfCandles } from "./symf-market-data";
import {
  parseTrackerCandles,
  trackerCandleUrl,
} from "./tracker-market-candles";

const NOW = Date.parse("2026-10-31T03:00:00Z");
const binding = {
  mint: SYMF_TOKEN.mint,
  pool: SYMF_TOKEN.pool,
  quote: MARKET_QUOTES[0],
};
const tuple = [NOW / 1000 - 900, 1, 2, 0.5, 1.5, 10];
const candle = {
  time: tuple[0],
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
};
const gecko = (
  base: string = binding.mint,
  quote: string = binding.quote,
  rows: unknown = [tuple],
) => ({
  meta: { base: { address: base }, quote: { address: quote } },
  data: { attributes: { ohlcv_list: rows } },
});

describe("exact-mint candle identity and safe diagnostics", () => {
  test("explicit-token Gecko mode accepts pair reversal but legacy contract remains strict", () => {
    const reversed = gecko(binding.quote, binding.mint);
    expect(parseMarketCandles(reversed, NOW, binding, "explicit-mint")).toEqual(
      [candle],
    );
    expect(() => parseSymfCandles(reversed, NOW)).toThrow("wrong_market_token");
    for (const value of [
      gecko(MARKET_QUOTES[1], binding.quote),
      gecko(binding.mint, binding.mint),
    ])
      expect(() =>
        parseMarketCandles(value, NOW, binding, "explicit-mint"),
      ).toThrow(expect.objectContaining({ code: "candle-identity" }));
  });
  test("separates empty, malformed schema, and invalid numeric candles without fabrication", () => {
    for (const [value, code] of [
      [gecko(binding.mint, binding.quote, []), "empty-candles"],
      [{ data: { attributes: { ohlcv_list: [tuple] } } }, "candle-schema"],
      [
        gecko(binding.mint, binding.quote, [[...tuple.slice(0, 5), -1]]),
        "candle-numeric",
      ],
      [
        gecko(binding.mint, binding.quote, [[tuple[0], "1", 2, 0.5, 1.5, 10]]),
        "candle-numeric",
      ],
      [gecko(binding.mint, binding.quote, [tuple, tuple]), "candle-numeric"],
    ] as const)
      expect(() =>
        parseMarketCandles(value, NOW, binding, "explicit-mint"),
      ).toThrow(expect.objectContaining({ code }));
  });
  test("Tracker request is pool-specific USD with fixed range; optional contradictory echoes fail closed", () => {
    const url = new URL(trackerCandleUrl(binding, "15m", NOW));
    expect(url.pathname).toBe(`/chart/${binding.mint}/${binding.pool}`);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      currency: "usd",
      marketCap: "false",
      type: "15m",
      time_to: String(NOW / 1000),
      time_from: String(NOW / 1000 - 120 * 900),
    });
    expect(
      parseTrackerCandles({ oclhv: [candle] }, NOW, binding, "15m"),
    ).toEqual([candle]);
    for (const echo of [
      { mint: MARKET_QUOTES[1] },
      { token: MARKET_QUOTES[1] },
      { pool: MARKET_QUOTES[1] },
      { quote: MARKET_QUOTES[1] },
      { currency: "sol" },
      { type: "1h" },
      { interval: "1h" },
      { marketCap: true },
    ])
      expect(() =>
        parseTrackerCandles({ oclhv: [candle], ...echo }, NOW, binding, "15m"),
      ).toThrow(expect.objectContaining({ code: "candle-identity" }));
    for (const [c, code] of [
      [{ ...candle, time: NOW / 1000 + 61 }, "candle-future"],
      [{ ...candle, time: NOW / 1000 - 122 * 900 }, "candle-window"],
      [{ ...candle, high: 0.1 }, "candle-range"],
      [{ ...candle, open: Infinity }, "candle-number"],
      [{ ...candle, volume: -1 }, "candle-volume"],
      [{ ...candle, time: NOW }, "candle-time-unit"],
      [{ ...candle, time: 0 }, "candle-time"],
      [{ ...candle, time: NaN }, "candle-number"],
      [{ ...candle, time: 1.5 }, "candle-time"],
      [{ ...candle, open: 0 }, "candle-price"],
      [{ ...candle, volume: "10" }, "candle-number"],
    ] as const)
      expect(() =>
        parseTrackerCandles({ oclhv: [c] }, NOW, binding, "15m"),
      ).toThrow(expect.objectContaining({ code }));
    expect(() =>
      parseTrackerCandles({ oclhv: [candle, candle] }, NOW, binding, "15m"),
    ).toThrow(expect.objectContaining({ code: "candle-duplicate" }));
    expect(() =>
      parseTrackerCandles({ oclhv: [] }, NOW, binding, "15m"),
    ).toThrow(expect.objectContaining({ code: "empty-candles" }));
    expect(() => parseTrackerCandles([candle], NOW, binding, "15m")).toThrow(
      expect.objectContaining({ code: "candle-schema" }),
    );
  });
  test("Gecko pins only its Accept version; Tracker credentials cannot follow another host", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("{}"));
    await readPublicMarket("https://api.geckoterminal.com/docs", 100, fetcher);
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: { Accept: "application/json;version=20230203" },
      redirect: "error",
    });
    fetcher.mockClear();
    await expect(
      readTrackerMarket(
        "https://attacker.test/chart/a/b",
        "fixture-key",
        fetcher,
      ),
    ).rejects.toThrow("invalid_market_provider");
    expect(fetcher).not.toHaveBeenCalled();
    await readTrackerMarket(
      trackerCandleUrl(binding, "15m", NOW),
      "fixture-key",
      fetcher,
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      headers: { Accept: "application/json", "x-api-key": "fixture-key" },
      redirect: "error",
    });
  });
});
