import { describe, expect, it } from "vitest";
import type { TerminalMarket } from "@/lib/forum-terminal-model";
import {
  formatMarketPercent,
  marketObservation,
  rawMarketNumber,
  sortMarketRows,
} from "./market-explorer-model";

function market(
  mint: string,
  overrides: Partial<TerminalMarket> = {},
): TerminalMarket {
  return {
    mint,
    name: mint,
    symbol: mint,
    platform: "other",
    observedAt: 1_800_000_000_000,
    metricsAsOf: 1_800_000_000_000,
    priceUsd: null,
    marketCapUsd: null,
    fdvUsd: null,
    liquidityUsd: null,
    volume1hUsd: null,
    volume24hUsd: null,
    holders: null,
    priceChange1hPercent: null,
    imageUrl: null,
    website: null,
    twitter: null,
    telegram: null,
    description: null,
    sourceUrl: "https://example.com/source",
    sourceRank: null,
    threadId: null,
    threadUrl: null,
    ...overrides,
  };
}

describe("sampled-market display contracts", () => {
  it("keeps missing, negative and non-finite metrics after known values in either sort direction", () => {
    const columns = [
      ["price", "priceUsd"],
      ["marketCap", "marketCapUsd"],
      ["liquidity", "liquidityUsd"],
      ["volume1h", "volume1hUsd"],
      ["volume24h", "volume24hUsd"],
      ["holders", "holders"],
    ] as const;
    for (const [key, field] of columns) {
      const rows = [
        market("missing", { [field]: null }),
        market("high", { [field]: 20 }),
        market("nan", { [field]: Number.NaN }),
        market("low", { [field]: 10 }),
        market("infinite", { [field]: Infinity }),
        market("negative", { [field]: -1 }),
      ];
      const original = rows.map((row) => row.mint);
      for (const direction of ["asc", "desc"] as const) {
        const sorted = sortMarketRows(rows, key, direction);
        expect(sorted.slice(0, 2).map((row) => row.mint)).toEqual(
          direction === "asc" ? ["low", "high"] : ["high", "low"],
        );
        expect(sorted.slice(2).map((row) => row.mint)).toEqual([
          "infinite",
          "missing",
          "nan",
          "negative",
        ]);
        expect(rows.map((row) => row.mint)).toEqual(original);
        expect(sorted).not.toBe(rows);
      }
    }
  });

  it("sorts actual circulating cap rather than FDV and breaks numeric ties by exact mint", () => {
    const rows = [
      market("z", { marketCapUsd: 60_000, fdvUsd: 9_000_000 }),
      market("b", { marketCapUsd: 700_000, fdvUsd: 800_000 }),
      market("a", { marketCapUsd: 700_000, fdvUsd: 900_000 }),
      market("unknown", { marketCapUsd: null, fdvUsd: 99_000_000 }),
    ];
    expect(
      sortMarketRows(rows, "marketCap", "desc").map((row) => row.mint),
    ).toEqual(["a", "b", "z", "unknown"]);
    expect(
      sortMarketRows(rows, "marketCap", "asc").map((row) => row.mint),
    ).toEqual(["z", "a", "b", "unknown"]);
  });

  it("keeps zero and negative percentage changes meaningful instead of treating them as missing", () => {
    const rows = [
      market("unknown", { priceChange1hPercent: null }),
      market("down", { priceChange1hPercent: -4 }),
      market("flat", { priceChange1hPercent: 0 }),
      market("up", { priceChange1hPercent: 5 }),
    ];
    expect(
      sortMarketRows(rows, "change1h", "asc").map((row) => row.mint),
    ).toEqual(["down", "flat", "up", "unknown"]);
    expect(
      sortMarketRows(rows, "change1h", "desc").map((row) => row.mint),
    ).toEqual(["up", "flat", "down", "unknown"]);
    expect(
      sortMarketRows(
        [market("missing"), market("zero", { holders: 0 })],
        "holders",
        "asc",
      )[0].mint,
    ).toBe("zero");
  });

  it("formats signed percentages without negative zero, fake zeroes or invalid values", () => {
    expect(formatMarketPercent(0)).toBe("0.00%");
    expect(formatMarketPercent(-0)).toBe("0.00%");
    expect(formatMarketPercent(0.001)).toBe("+<0.01%");
    expect(formatMarketPercent(-0.001)).toBe("−<0.01%");
    expect(formatMarketPercent(12.5)).toBe("+12.50%");
    expect(formatMarketPercent(-3.25)).toBe("−3.25%");
    for (const value of [null, undefined, NaN, Infinity, -Infinity])
      expect(formatMarketPercent(value)).toBe("Unavailable");
  });

  it("keeps raw precision in display titles without scientific notation", () => {
    expect(rawMarketNumber(700_000)).toBe("700000");
    expect(rawMarketNumber(0.000000001)).toBe("0.000000001");
    expect(rawMarketNumber(0)).toBe("0");
    expect(rawMarketNumber(1e21)).toBe("1000000000000000000000");
    for (const value of [null, undefined, NaN, Infinity])
      expect(rawMarketNumber(value)).toBeUndefined();
  });

  it("retains exact observation dates and rejects invalid or future freshness claims", () => {
    const now = 1_800_000_000_000;
    const recent = marketObservation(now - 120_000, now);
    expect(recent).toMatchObject({
      label: "2m ago",
      dateTime: new Date(now - 120_000).toISOString(),
      stale: false,
    });
    expect(marketObservation(now - 3_600_000, now)).toMatchObject({
      label: "1h ago",
      stale: true,
    });
    for (const timestamp of [NaN, Infinity, -1, 0, now + 60_001])
      expect(marketObservation(timestamp, now)).toEqual({
        label: "Unavailable",
        dateTime: null,
        full: "Observation time unavailable",
        stale: true,
      });
    expect(marketObservation(now, NaN).stale).toBe(true);
  });
});
