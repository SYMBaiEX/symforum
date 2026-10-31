/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { FORUM_READ_POLICY } from "../lib/forum-read-policy";
import { commerceLimiter } from "./forumCommerce";
import { marketReadLimiter } from "./forumMarketData";
import { terminalReadLimiter } from "./forumTerminalData";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.parse("2026-10-31T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());
function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  return t;
}

test("terminal wallet and public market factories share the same approved daily ledger", async () => {
  const t = setup();
  await t.run(async (ctx) => {
    const cap = FORUM_READ_POLICY.terminalDailyUnits;
    expect(
      await marketReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: cap,
      }),
    ).toMatchObject({ ok: true });
    await expect(
      terminalReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: cap + 1,
      }),
    ).rejects.toThrow("count 6001 exceeds 6000");
    expect(
      await terminalReadLimiter.limit(ctx, "terminalReadDaily", {
        key: "all",
        count: cap - 2,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await marketReadLimiter.limit(ctx, "terminalReadDaily", {
        key: "all",
        count: 2,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await terminalReadLimiter.check(ctx, "terminalReadDaily", {
        key: "all",
        count: 1,
      }),
    ).toMatchObject({ ok: false });
  });
});

test("shared network reservations retain their existing key and UTC daily window", async () => {
  const t = setup();
  const now = Date.now();
  await t.run(async (ctx) => {
    const cap = FORUM_READ_POLICY.commerceDailyUnits;
    expect(
      await commerceLimiter.limit(ctx, "commerceNetworkDaily", {
        key: "all",
        count: cap,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await commerceLimiter.check(ctx, "commerceNetworkDaily", { key: "all" }),
    ).toMatchObject({ ok: false });
  });
  vi.setSystemTime(now + 11 * 3_600_000);
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", { key: "all" }),
    ),
  ).toMatchObject({ ok: false });
  vi.setSystemTime(now + 12 * 3_600_000);
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", {
        key: "all",
        count: FORUM_READ_POLICY.commerceDailyUnits,
      }),
    ),
  ).toMatchObject({ ok: true });
});
