import { expect, test } from "vitest";
import {
  CHART_CACHE_FRESH_MS,
  CHART_CACHE_RETENTION_MS,
} from "@/lib/chart-cache-policy";
import {
  chartResponsePolicy,
  chartStateMessage,
  chartSourceLabel,
  readChartData,
  retainedChartData,
} from "./price-chart-data";

const now = 1_800_000_000_000;
const mint = "So11111111111111111111111111111111111111112";
const data = {
  mint,
  pool: mint,
  interval: "15m" as const,
  checkedAt: now,
  priceUsd: 0.0015,
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
const response = (status = 200, headers: Record<string, string> = {}) => ({
  ok: status < 400,
  status,
  headers: new Headers(headers),
});

test("validated source attribution survives retention without renewing its timestamp", () => {
  const parsed = readChartData(
    { ...data, candleSource: "solana-tracker" },
    mint,
    "15m",
    now,
  );
  expect(chartSourceLabel(parsed)).toBe("Solana Tracker");
  expect(retainedChartData(parsed, now + 60_000, true)).toMatchObject({
    candleSource: "solana-tracker",
    checkedAt: now,
    stale: true,
  });
  expect(chartSourceLabel(readChartData(data, mint, "15m", now))).toBe(
    "GeckoTerminal",
  );
  expect(() =>
    readChartData(
      { ...data, candleSource: "<private-error>" },
      mint,
      "15m",
      now,
    ),
  ).toThrow();
});

test("CDN payloads cannot claim freshness past five minutes or survive 24-hour retention", () => {
  const checkedAt = now - CHART_CACHE_FRESH_MS;
  expect(
    readChartData({ ...data, checkedAt, stale: false }, mint, "15m", now),
  ).toMatchObject({ checkedAt, stale: true });
  expect(() =>
    readChartData(
      { ...data, checkedAt: now - CHART_CACHE_RETENTION_MS },
      mint,
      "15m",
      now,
    ),
  ).toThrow("chart_retention");
  expect(
    readChartData({ ...data, checkedAt: now - 1000 }, mint, "15m", now),
  ).toMatchObject({ checkedAt: now - 1000, stale: false });
});

test("local last-good retention never renews the check time on refresh failure", () => {
  const stale = retainedChartData(data, now + 60_000, true);
  expect(stale).toMatchObject({
    checkedAt: now,
    priceUsd: 0.0015,
    stale: true,
  });
  expect(retainedChartData(data, now + CHART_CACHE_RETENTION_MS)).toBeNull();
  expect(
    retainedChartData({ ...data, checkedAt: now + 60_001 }, now),
  ).toBeNull();
  expect(retainedChartData(data, NaN)).toBeNull();
});

test("server body and Retry-After deadlines are honored without early polling", () => {
  expect(chartResponsePolicy(data, response(), now).nextRetryAt).toBe(
    now + CHART_CACHE_FRESH_MS,
  );
  expect(
    chartResponsePolicy(
      { state: "unavailable", cache: { nextRetryAt: now + 120_000 } },
      response(503, { "Retry-After": "240" }),
      now,
    ),
  ).toEqual({ state: "unavailable", nextRetryAt: now + 240_000 });
  expect(
    chartResponsePolicy(
      { state: "budget", cache: { nextRetryAt: now + 3_600_000 } },
      response(429),
      now,
    ),
  ).toEqual({ state: "budget", nextRetryAt: now + 3_600_000 });
  expect(
    chartResponsePolicy(
      { state: "deferred", cache: { nextRetryAt: now + 1500 } },
      response(503),
      now,
    ),
  ).toEqual({ state: "deferred", nextRetryAt: now + 1500 });
  expect(
    chartResponsePolicy(
      {},
      response(503, { "Retry-After": new Date(now + 120_000).toUTCString() }),
      now,
    ).nextRetryAt,
  ).toBe(now + 120_000);
});

test("malformed retry metadata stays bounded and unsupported responses do not poll", () => {
  for (const value of [null, NaN, Infinity, "1500", now - 1])
    expect(
      chartResponsePolicy(
        { state: "unavailable", cache: { nextRetryAt: value } },
        response(503, { "Retry-After": "not-a-date" }),
        now,
      ).nextRetryAt,
    ).toBe(now + 60_000);
  expect(
    chartResponsePolicy({ cache: { nextRetryAt: now + 1 } }, response(), now)
      .nextRetryAt,
  ).toBe(now + 1000);
  expect(
    chartResponsePolicy({ cache: { nextRetryAt: now + 1e12 } }, response(), now)
      .nextRetryAt,
  ).toBe(now + CHART_CACHE_RETENTION_MS);
  expect(
    chartResponsePolicy(
      { state: "unsupported", cache: { nextRetryAt: now + 1500 } },
      response(404),
      now,
    ),
  ).toEqual({ state: "unsupported", nextRetryAt: null });
});

test("only closed status messages reach the chart, never provider error bodies", () => {
  expect(
    chartResponsePolicy(
      { error: "provider secret", state: "unknown" },
      response(429),
      now,
    ).state,
  ).toBe("budget");
  for (const state of [
    "budget",
    "unavailable",
    "loading",
    "deferred",
    "unsupported",
  ] as const) {
    expect(chartStateMessage(state, true)).toContain(
      "Showing last checked data.",
    );
    expect(chartStateMessage(state, false)).not.toMatch(
      /retry in a minute|provider secret/i,
    );
  }
  expect(chartStateMessage("deferred", false)).toBe(
    "Waiting for shared data window.",
  );
  expect(chartStateMessage("budget", true, true)).toContain("Offline");
});
