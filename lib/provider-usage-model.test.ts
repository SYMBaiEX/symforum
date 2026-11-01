import { expect, test } from "vitest";
import {
  providerLedgerRequests,
  providerUsageSnapshot,
  type ProviderLedgerState,
} from "./provider-usage-model";
import {
  adminSectionHref,
  isAdminSectionId,
  ownerOnlyAdminSections,
} from "./admin-sections";
const NOW = Date.parse("2026-11-01T12:00:00Z"),
  DAY = 86400000;
const states = (at = NOW): ProviderLedgerState[] =>
  providerLedgerRequests(at).map((request) => ({
    ts: 0,
    value: request.config.capacity,
  }));
const counter = (
  snapshot: ReturnType<typeof providerUsageSnapshot>,
  id: string,
) => snapshot.counters.find((row) => row.id === id)!;
test("plans exactly the existing41 fixed keys with bounded rotating cardinality", () => {
  const keys = new Set<string>();
  for (let day = 0; day < 70; day++)
    for (const advance of [0, 1000, 60000]) {
      const plan = providerLedgerRequests(NOW + day * DAY + advance);
      expect(plan).toHaveLength(41);
      plan.forEach((request) => keys.add(`${request.name}:${request.key}`));
    }
  expect(keys.size).toBe(41);
});
test("missing/expired records mean zero recorded reservations, not provider billing proof", () => {
  const raw = states();
  raw[0] = { ts: NOW - 2000, value: 0 };
  const snapshot = providerUsageSnapshot(NOW, raw);
  expect(snapshot.complete).toBe(true);
  expect(
    snapshot.counters.every((row) => row.used === 0 && row.eligibleAt === NOW),
  ).toBe(true);
  expect(snapshot).toMatchObject({
    accountUsageKnown: false,
    denialHistoryRecorded: false,
    scope: "application-reservations",
    asOf: NOW,
  });
});
test("current and previous raw balances are interpreted at their original aligned windows", () => {
  const raw = states();
  raw[0] = { ts: NOW, value: 3 };
  raw[1] = { ts: NOW - 1000, value: 2 };
  raw[2] = { ts: NOW, value: 0 };
  const snapshot = providerUsageSnapshot(NOW, raw);
  expect(counter(snapshot, "helius-rpc")).toMatchObject({
    used: 5,
    eligibleAt: NOW + 1000,
    windowStart: NOW - 1000,
    windowEnd: NOW + 1000,
  });
  expect(counter(snapshot, "helius-send")).toMatchObject({
    used: 1,
    eligibleAt: NOW + 2000,
  });
  expect(raw[0]).toEqual({ ts: NOW, value: 3 });
});
test("invalid, future and failed reads remain unknown and block combined eligibility", () => {
  for (const invalid of [
    null,
    { ts: NOW + 1, value: 0 },
    { ts: NOW, value: -1 },
    { ts: NOW, value: NaN },
    { ts: NOW, value: 6 },
  ]) {
    const raw = states();
    raw[0] = invalid;
    const snapshot = providerUsageSnapshot(NOW, raw);
    expect(snapshot.complete).toBe(false);
    expect(counter(snapshot, "helius-rpc")).toMatchObject({
      used: null,
      eligibleAt: null,
    });
    expect(counter(snapshot, "helius-send").eligibleAt).toBeNull();
    expect(counter(snapshot, "dexscreener").used).toBe(0);
  }
});
test("partial credit reads do not turn unknown account capacity into free RPC eligibility", () => {
  const raw = states();
  raw[20] = null;
  const snapshot = providerUsageSnapshot(NOW, raw);
  expect(counter(snapshot, "helius-daily").used).toBe(0);
  expect(counter(snapshot, "helius-rolling")).toMatchObject({
    used: null,
    eligibleAt: null,
  });
  expect(counter(snapshot, "helius-rpc")).toMatchObject({
    used: 0,
    eligibleAt: null,
  });
});
test("daily and rolling credit eligibility retain actual conservative bucket deadlines", () => {
  const raw = states();
  const day = Math.floor(NOW / DAY) * DAY;
  const requests = providerLedgerRequests(NOW);
  for (let offset = 0; offset < 30; offset++)
    raw[8 + offset] = { ts: requests[8 + offset]!.expectedStart, value: 0 };
  const snapshot = providerUsageSnapshot(NOW, raw);
  expect(counter(snapshot, "helius-daily")).toMatchObject({
    used: 10000,
    eligibleAt: day + DAY,
  });
  expect(counter(snapshot, "helius-rolling")).toMatchObject({
    used: 300000,
    eligibleAt: day + 4 * DAY,
  });
  expect(counter(snapshot, "helius-rpc").eligibleAt).toBe(day + 4 * DAY);
  expect(counter(snapshot, "helius-send").eligibleAt).toBe(day + 4 * DAY);
});
test("requires the full bounded read set and a server-valid snapshot time", () => {
  expect(() => providerUsageSnapshot(NOW, [])).toThrow("bounded");
  for (const at of [0, -1, NaN, Infinity, 1.5])
    expect(() => providerLedgerRequests(at)).toThrow("snapshot time");
});
test("provider usage reuses the canonical admin route without changing owner-only sections", () => {
  expect(isAdminSectionId("providers")).toBe(true);
  expect(adminSectionHref("providers")).toBe("/admin/providers");
  expect(ownerOnlyAdminSections).toEqual(
    new Set(["api", "users", "ai", "telemetry"]),
  );
});
