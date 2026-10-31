import { describe, expect, test } from "vitest";
import type { TerminalMarket } from "../../lib/forum-terminal-model";
import { sortMarketRows, type MarketSortKey } from "./market-explorer-model";

// Explicit exhaustive map: adding a real sort key must extend this coverage.
const columns = {
  price: "priceUsd",
  change1h: "priceChange1hPercent",
  marketCap: "marketCapUsd",
  liquidity: "liquidityUsd",
  volume1h: "volume1hUsd",
  volume24h: "volume24hUsd",
  holders: "holders",
} as const satisfies Record<MarketSortKey, keyof TerminalMarket>;
const exactMints = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1V",
];
const values = [
  null,
  undefined,
  NaN,
  Infinity,
  -Infinity,
  -1e200,
  -1e-12,
  -0,
  0,
  1e-300,
  1e-12,
  1,
  1,
  1e21,
  Number.MAX_VALUE,
];
function row(
  mint: string,
  field: keyof TerminalMarket,
  value: number | null | undefined,
): TerminalMarket {
  return Object.freeze({
    mint,
    name: "Duplicate untrusted name",
    symbol: "SAME",
    platform: "other",
    observedAt: 1800000000000,
    metricsAsOf: 1800000000000,
    priceUsd: null,
    marketCapUsd: null,
    fdvUsd: Number.MAX_VALUE,
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
    sourceUrl: "https://sample.example.test/retained",
    sourceRank: 1,
    threadId: null,
    threadUrl: null,
    [field]: value,
  }) as TerminalMarket;
}
describe("bounded deterministic market comparator laws", () => {
  for (const key of Object.keys(columns) as MarketSortKey[])
    for (const direction of ["asc", "desc"] as const)
      test(`${key} ${direction}: known/missing order, exact ties, comparator laws and frozen input`, () => {
        const field = columns[key];
        const rows = values.map((value, i) =>
          row(`fixture-${String(i).padStart(2, "0")}`, field, value),
        );
        rows.push(row(exactMints[0], field, 1), row(exactMints[1], field, 1));
        const input = Object.freeze(rows) as unknown as TerminalMarket[];
        const snapshot = input.map((value) => ({ ...value }));
        const sorted = sortMarketRows(input, key, direction);
        expect(sorted).not.toBe(input);
        expect(new Set(sorted)).toEqual(new Set(input));
        const known = (value: number | null | undefined): value is number =>
          value != null &&
          Number.isFinite(value) &&
          (key === "change1h" || value >= 0);
        const valid = sorted.filter((value) => known(value[field]));
        const missing = sorted.filter((value) => !known(value[field]));
        expect(sorted).toEqual([...valid, ...missing]);
        expect(valid.some((value) => Object.is(value[field], 0))).toBe(true);
        expect(valid.some((value) => value[field] === 1e-300)).toBe(true);
        expect(valid.some((value) => value[field] === Number.MAX_VALUE)).toBe(
          true,
        );
        expect(valid.some((value) => value[field] === -1e200)).toBe(
          key === "change1h",
        );
        for (let i = 1; i < valid.length; i++) {
          const before = valid[i - 1][field]!,
            after = valid[i][field]!;
          if (direction === "asc") expect(before).toBeLessThanOrEqual(after);
          else expect(before).toBeGreaterThanOrEqual(after);
          if (before === after)
            expect(
              valid[i - 1].mint.localeCompare(valid[i].mint, "en-US"),
            ).toBeLessThanOrEqual(0);
        }
        expect(missing.map((value) => value.mint)).toEqual(
          missing
            .map((value) => value.mint)
            .sort((a, b) => a.localeCompare(b, "en-US")),
        );
        const tiedMints = sorted
          .filter((value) => exactMints.includes(value.mint))
          .map((value) => value.mint);
        expect(tiedMints).toEqual(
          [...exactMints].sort((a, b) => a.localeCompare(b, "en-US")),
        );
        expect(exactMints[0].localeCompare(exactMints[1], "en-US")).not.toBe(0);

        // Observe the real sorter on each pair, then test the resulting relation.
        const pair = input.map((a, i) =>
          input.map((b, j) =>
            i === j
              ? 0
              : sortMarketRows([a, b], key, direction)[0] === a
                ? -1
                : 1,
          ),
        );
        for (let a = 0; a < input.length; a++)
          for (let b = 0; b < input.length; b++) {
            expect(pair[a][b] + pair[b][a]).toBe(0);
            for (let c = 0; c < input.length; c++)
              if (pair[a][b] <= 0 && pair[b][c] <= 0)
                expect(pair[a][c]).toBeLessThanOrEqual(0);
          }
        const expected = sorted.map((value) => value.mint);
        for (const permutation of [
          input,
          [...input].reverse(),
          [...input.slice(5), ...input.slice(0, 5)],
          input
            .filter((_, i) => i % 2 === 0)
            .concat(input.filter((_, i) => i % 2 === 1)),
        ])
          expect(
            sortMarketRows(permutation, key, direction).map(
              (value) => value.mint,
            ),
          ).toEqual(expected);
        expect(sortMarketRows(sorted, key, direction)).toEqual(sorted);
        expect(input).toEqual(snapshot);
        expect(
          input.every(
            (value, i) => value === rows[i] && Object.isFrozen(value),
          ),
        ).toBe(true);
      });
});
