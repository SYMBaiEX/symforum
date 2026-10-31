/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { SYMF_TOKEN } from "../lib/symf-token";
const modules = import.meta.glob("./**/*.ts");
test("public chart cache coalesces 200 concurrent viewers without provider fanout", async () => {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  const args = {
    mint: SYMF_TOKEN.mint,
    kind: "chart" as const,
    interval: "15m",
  };
  const results = await Promise.all(
    Array.from({ length: 200 }, (_, i) =>
      t.mutation(internal.forumMarketData.claim, { ...args, lease: String(i) }),
    ),
  );
  expect(results.filter((r) => r.fetch)).toHaveLength(1);
  expect(
    await t.run((ctx) => ctx.db.query("forumMarketDataCache").take(2)),
  ).toHaveLength(1);
});
test("a late cache writer cannot overwrite a newer lease; failures are negatively cached", async () => {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  const key = `chart:${SYMF_TOKEN.mint}:15m`;
  const admission = await t.mutation(internal.forumMarketData.claim, {
    mint: SYMF_TOKEN.mint,
    kind: "chart",
    interval: "15m",
    lease: "new",
  });
  await t.mutation(internal.forumMarketData.save, {
    key,
    lease: "old",
    attemptAt: admission.cache.lastAttemptAt ?? undefined,
    payload: "{}",
  });
  const row = await t.run((ctx) =>
    ctx.db
      .query("forumMarketDataCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique(),
  );
  expect(row?.payload).toBeNull();
  await t.mutation(internal.forumMarketData.save, {
    key,
    lease: "new",
    attemptAt: admission.cache.lastAttemptAt ?? undefined,
    payload: null,
  });
  expect(
    await t.mutation(internal.forumMarketData.claim, {
      mint: SYMF_TOKEN.mint,
      kind: "chart",
      interval: "15m",
      lease: "again",
    }),
  ).toMatchObject({ fetch: false, state: "unavailable" });
});
test("invalid intervals do not reserve a cache row", async () => {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  try {
    expect(
      await t.mutation(internal.forumMarketData.claim, {
        mint: SYMF_TOKEN.mint,
        kind: "chart",
        interval: "1s",
        lease: "bad",
      }),
    ).toMatchObject({ fetch: false, state: "unsupported" });
    expect(
      await t.run((ctx) => ctx.db.query("forumMarketDataCache").take(2)),
    ).toHaveLength(0);
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
