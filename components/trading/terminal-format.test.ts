import { describe, expect, it } from "vitest";
import type { TerminalMarket } from "@/lib/forum-terminal-model";
import {
  balanceLabel,
  marketMoney,
  safeExternalUrl,
  searchMarkets,
} from "./terminal-format";
import { readChartData } from "./price-chart-data";

describe("terminal public-data boundaries", () => {
  it("does not invent missing, negative or non-finite dollar values", () => {
    expect(marketMoney(null)).toBe("Unavailable");
    expect(marketMoney(Number.NaN)).toBe("Unavailable");
    expect(marketMoney(-1)).toBe("Unavailable");
    expect(marketMoney(0)).toBe("$0.00");
  });
  it("formats token raw amounts without floating-point balance loss", () => {
    expect(balanceLabel("12345678901234567890123456", 6)).toBe(
      "12345678901234567890.123456",
    );
    expect(balanceLabel("1", 9)).toBe("0.000000001");
    expect(balanceLabel("1000000", 6)).toBe("1");
    expect(balanceLabel("-1", 6)).toBe("Unavailable");
    expect(balanceLabel("1", -1)).toBe("Unavailable");
  });
  it("restricts external metadata links to credential-free HTTPS", () => {
    expect(safeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalUrl("http://example.com")).toBeNull();
    expect(safeExternalUrl("https://user:secret@example.com")).toBeNull();
    expect(safeExternalUrl("https://example.com/token")).toBe(
      "https://example.com/token",
    );
  });
  it("searches without mutating the case-sensitive mint identity", () => {
    const markets = [
      { mint: "AbCdefMint", symbol: "DEMO", name: "Example" },
    ] as TerminalMarket[];
    expect(searchMarkets(markets, "abc")[0].mint).toBe("AbCdefMint");
    expect(searchMarkets(markets, "demo")).toHaveLength(1);
    expect(searchMarkets(markets, "other")).toEqual([]);
  });
});

describe("generic chart input", () => {
  const mint = "So11111111111111111111111111111111111111112";
  const now = 1_800_000_000_000;
  const chart = {
    mint,
    pool: "11111111111111111111111111111111",
    interval: "15m",
    checkedAt: now,
    candles: [
      {
        time: now / 1000 - 60,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 200,
      },
    ],
  };
  it("accepts the selected mint only", () => {
    expect(readChartData(chart, mint, "15m", now).candles).toHaveLength(1);
    expect(() => readChartData(chart, "other", "15m", now)).toThrow();
    expect(() => readChartData(chart, mint, "1m", now)).toThrow();
  });
  it("rejects duplicate times, invalid ranges and future data", () => {
    expect(() =>
      readChartData(
        { ...chart, candles: [...chart.candles, ...chart.candles] },
        mint,
        "15m",
        now,
      ),
    ).toThrow();
    expect(() =>
      readChartData(
        { ...chart, candles: [{ ...chart.candles[0], high: 0.1 }] },
        mint,
        "15m",
        now,
      ),
    ).toThrow();
    expect(() =>
      readChartData({ ...chart, checkedAt: now + 90_000 }, mint, "15m", now),
    ).toThrow();
    expect(() =>
      readChartData({ ...chart, candles: [] }, mint, "15m", now),
    ).toThrow();
  });
  it("accepts optional checked market metrics without confusing FDV and cap", () => {
    const parsed = readChartData(
      {
        ...chart,
        priceUsd: 0.1,
        stats: {
          marketCap: null,
          fdv: 100_000,
          liquidity: 3000,
          volume24h: 4000,
        },
      },
      mint,
      "15m",
      now,
    );
    expect(parsed.stats?.marketCap).toBeNull();
    expect(parsed.stats?.fdv).toBe(100_000);
    expect(() =>
      readChartData(
        {
          ...chart,
          stats: {
            marketCap: Infinity,
            fdv: 100_000,
            liquidity: null,
            volume24h: null,
          },
        },
        mint,
        "15m",
        now,
      ),
    ).toThrow();
  });
});
