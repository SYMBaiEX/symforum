import { expect, test } from "vitest";
import type { TerminalMarket } from "@/lib/forum-terminal-model";
import {
  MARKET_EXPORT_HEADERS,
  marketExportCsv,
  marketExportNumber,
} from "./market-export";
const now = 1_800_000_000_000;
const row: TerminalMarket = {
  mint: "exact-mint",
  name: "Example",
  symbol: "EX",
  platform: "pumpfun",
  observedAt: now - 7200000,
  metricsAsOf: now - 7200000,
  priceUsd: 1e-25,
  marketCapUsd: 0,
  fdvUsd: 999,
  liquidityUsd: null,
  volume1hUsd: 12.345678901234567,
  volume24hUsd: 1e25,
  holders: 0,
  priceChange1hPercent: -1e-12,
  imageUrl: null,
  website: null,
  twitter: null,
  telegram: null,
  description: null,
  sourceUrl:
    "https://www.solanatracker.io/token/exact-mint?api-key=not-for-export#fragment",
  sourceRank: null,
  threadId: null,
  threadUrl: null,
  marketData: {
    state: "available",
    checkedAt: now - 60000,
    sourceUrl:
      "https://dexscreener.com/solana/pool?key=not-for-export#fragment",
  },
};
test.each([
  0,
  -0,
  Number.MIN_VALUE,
  1e-25,
  0.00005835,
  1234.5678901234567,
  1e25,
  Number.MAX_VALUE,
])("raw decimal roundtrips loaded %s without scientific notation", (value) => {
  const text = marketExportNumber(value);
  expect(text).not.toMatch(/[eE]/);
  expect(Number(text)).toBe(value === 0 ? 0 : value);
});
test.each([null, undefined, NaN, Infinity, -Infinity, -1])(
  "unknown or invalid unsigned %s never becomes zero",
  (value) => {
    expect(marketExportNumber(value)).toBe("null");
  },
);
test("signed change remains numeric while original per-field times and canonical public paths stay separate", () => {
  const csv = marketExportCsv([row], now, true, now - 900000);
  expect(csv).toContain('"2027-01-15T07:59:00.000Z"');
  expect(csv).toContain(new Date(row.metricsAsOf).toISOString());
  expect(csv).toContain('"https://dexscreener.com/solana/pool"');
  expect(csv).toContain('"https://www.solanatracker.io/token/exact-mint"');
  expect(csv).not.toContain("not-for-export");
  expect(csv).not.toContain("#fragment");
  expect(csv).not.toContain("999");
  expect(csv).toContain(
    "0.0000000000000000000000001,0,null,12.345678901234567,10000000000000000000000000,0,-0.000000000001",
  );
  expect(csv.split("\r\n")[1]).toContain('"available",false');
});
test.each([
  "=SUM(1,2)",
  ' +HYPERLINK("evil")',
  "-cmd",
  "@SUM(1)",
  "\tfoo",
  "\rbar",
  "\nbaz",
  "＝SUM(1)",
])("untrusted formula-like text %j is escaped, not executable", (name) => {
  const csv = marketExportCsv(
    [{ ...row, name, symbol: name }],
    now,
    false,
    null,
  );
  expect(csv).toContain(`"'${name.replaceAll('"', '""')}"`);
});
test("only allowlisted fields and safe exact provider hosts are serialized; nulls remain authoritative", () => {
  const value = {
    ...row,
    description: "PRIVATE_PAYLOAD",
    wallet: "PRIVATE_WALLET",
    marketData: {
      state: "unavailable" as const,
      checkedAt: NaN,
      sourceUrl: "https://dexscreener.com.evil.test/",
    },
    sourceUrl: "https://user:password@dexscreener.com/pool",
    priceUsd: null,
  };
  const csv = marketExportCsv([value], now, false, null);
  expect(csv).not.toMatch(/PRIVATE_|password|evil\.test/);
  expect(csv).toContain('"unavailable",true,null');
  expect(csv).toContain(",null,0,null,");
});
test("serialization preserves supplied subset/order and never fills missing rows or headers with current time", () => {
  const csv = marketExportCsv(
    [
      { ...row, mint: "B" },
      { ...row, mint: "A" },
    ],
    now,
    false,
    null,
  );
  expect(csv.split("\r\n")[0]).toBe(MARKET_EXPORT_HEADERS.join(","));
  expect(csv.split("\r\n")[1]).toContain(',1,"B",');
  expect(csv.split("\r\n")[2]).toContain(',2,"A",');
  expect(marketExportCsv([], now, false, null)).toBe(
    MARKET_EXPORT_HEADERS.join(",") + "\r\n",
  );
});
