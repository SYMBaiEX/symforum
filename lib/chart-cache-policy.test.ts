import { describe, expect, test } from "vitest";
import {
  CHART_CACHE_MAX_BACKOFF_MS,
  CHART_CACHE_MIN_BACKOFF_MS,
  CHART_CACHE_RETENTION_MS,
  marketFailureBackoff,
  marketProviderRetryAt,
  nextMarketBudgetReset,
} from "./chart-cache-policy";

const NOW = Date.parse("2026-10-30T23:59:30Z");

describe("shared chart cache retry policy", () => {
  test("exponential failure delays start at one minute and stop at fifteen", () => {
    expect(CHART_CACHE_MIN_BACKOFF_MS).toBe(60_000);
    expect(CHART_CACHE_MAX_BACKOFF_MS).toBe(900_000);
    expect([0, 1, 2, 3, 4, 5, 6, 100].map(marketFailureBackoff)).toEqual([
      60_000, 60_000, 120_000, 240_000, 480_000, 900_000, 900_000, 900_000,
    ]);
    expect(marketFailureBackoff(-2)).toBe(60_000);
    expect(marketFailureBackoff(2.9)).toBe(120_000);
  });

  test("Retry-After seconds and HTTP dates become bounded numeric timestamps", () => {
    expect(marketProviderRetryAt(" 120 ", NOW)).toBe(NOW + 120_000);
    expect(marketProviderRetryAt("0.0001", NOW)).toBe(NOW + 1);
    expect(
      marketProviderRetryAt(new Date(NOW + 180_000).toUTCString(), NOW),
    ).toBe(NOW + 180_000);
    expect(marketProviderRetryAt("99999999", NOW)).toBe(
      NOW + CHART_CACHE_RETENTION_MS,
    );
    expect(
      marketProviderRetryAt(
        new Date(NOW + 2 * CHART_CACHE_RETENTION_MS).toUTCString(),
        NOW,
      ),
    ).toBe(NOW + CHART_CACHE_RETENTION_MS);
  });

  test.each([
    null,
    "",
    " ",
    "0",
    "-1",
    "NaN",
    "Infinity",
    "12seconds",
    "https://private.example/secret",
    new Date(NOW).toUTCString(),
    new Date(NOW - 1000).toUTCString(),
  ])("rejects invalid or nonfuture Retry-After %s", (header) => {
    expect(marketProviderRetryAt(header, NOW)).toBeNull();
  });

  test.each([0, -1, NaN, Infinity, NOW + 0.5])(
    "invalid check time %s cannot admit a provider hint",
    (now) => {
      expect(marketProviderRetryAt("120", now)).toBeNull();
    },
  );

  test("daily budget resets at the next UTC midnight, not a rolling day or local midnight", () => {
    const midnight = Date.parse("2026-10-31T00:00:00Z");
    expect(nextMarketBudgetReset(NOW)).toBe(midnight);
    expect(nextMarketBudgetReset(midnight - 1)).toBe(midnight);
    expect(nextMarketBudgetReset(midnight)).toBe(
      Date.parse("2026-11-01T00:00:00Z"),
    );
    expect(nextMarketBudgetReset(Date.parse("2026-10-30T12:00:00-05:00"))).toBe(
      midnight,
    );
  });
});
