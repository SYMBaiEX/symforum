/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register } from "@convex-dev/rate-limiter/test";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { components } from "./_generated/api";
import type { ProviderUsageSnapshot } from "../lib/provider-usage-model";
import { providerLedgerRequests } from "../lib/provider-usage-model";
const modules = import.meta.glob("./**/*.ts");
const snapshot = makeFunctionReference<
  "action",
  Record<string, never>,
  ProviderUsageSnapshot
>("forumProviderUsage:snapshot");
const readSnapshot = makeFunctionReference<
  "query",
  { asOf: number },
  ProviderUsageSnapshot
>("forumProviderUsage:readSnapshot");
const admit = makeFunctionReference<
  "mutation",
  {
    provider: "helius" | "dexscreener" | "geckoterminal";
    credits: number;
    sendTransaction?: true;
  },
  unknown
>("forumProviderAdmission:admit");
const NOW = Date.parse("2026-11-01T12:00:00Z");
const setup = (withLimiter = true) => {
  const t = convexTest(schema, modules);
  if (withLimiter) register(t);
  return t;
};
async function actor(
  t: ReturnType<typeof setup>,
  role: "owner" | "admin" | "reader",
  forumRole?: "admin" | "moderator",
) {
  const id = await t.run((ctx) =>
    ctx.db.insert("users", {
      role,
      ...(forumRole ? { forumRole } : {}),
      name: "Invented fixture account",
    }),
  );
  return t.withIdentity({ subject: id });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
test("anonymous, member and forum-only staff are rejected before any ledger read", async () => {
  const reads = vi.spyOn(RateLimiter.prototype, "getValue");
  const t = setup(false); // A ledger read would fail because no component is registered.
  await expect(t.action(snapshot, {})).rejects.toThrow(/sign in to continue/i);
  for (const forumRole of [undefined, "admin", "moderator"] as const) {
    const reader = await actor(t, "reader", forumRole);
    await expect(reader.action(snapshot, {})).rejects.toThrow(
      /administrator access/i,
    );
    await expect(reader.query(readSnapshot, { asOf: NOW })).rejects.toThrow(
      /administrator access/i,
    );
  }
  expect(reads).not.toHaveBeenCalled();
});
test.each(["owner", "admin"] as const)(
  "%s can read one frozen server-dated aggregate without consuming allowance",
  async (role) => {
    const t = setup(),
      current = await actor(t, role);
    await t.mutation(admit, {
      provider: "helius",
      credits: 1,
      sendTransaction: true,
    });
    await t.mutation(admit, { provider: "geckoterminal", credits: 1 });
    const first = await current.action(snapshot, {});
    const second = await current.action(snapshot, {});
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      asOf: NOW,
      complete: true,
      accountUsageKnown: false,
      denialHistoryRecorded: false,
    });
    expect(first.counters.find((row) => row.id === "helius-rpc")?.used).toBe(1);
    expect(first.counters.find((row) => row.id === "helius-send")?.used).toBe(
      1,
    );
    expect(first.counters.find((row) => row.id === "helius-daily")?.used).toBe(
      1,
    );
    expect(
      first.counters.find((row) => row.id === "helius-rolling")?.used,
    ).toBe(1);
    expect(first.counters.find((row) => row.id === "geckoterminal")?.used).toBe(
      1,
    );
    const json = JSON.stringify(first);
    expect(json).not.toMatch(
      /Invented fixture account|api-key|helius:|forumProviderBurst|wallet|email|signature|private/i,
    );
    vi.setSystemTime(NOW + 2000);
    const next = await current.action(snapshot, {});
    expect(next.asOf).toBe(NOW + 2000);
    expect(next.counters.find((row) => row.id === "helius-rpc")?.used).toBe(0);
    expect(next.counters.find((row) => row.id === "helius-daily")?.used).toBe(
      1,
    );
  },
);
test("public refresh accepts no caller time or identity and a revoked administrator loses access", async () => {
  const t = setup();
  const id = await t.run((ctx) => ctx.db.insert("users", { role: "admin" }));
  const current = t.withIdentity({ subject: id });
  await expect(
    current.action(snapshot, { asOf: NOW } as unknown as Record<string, never>),
  ).rejects.toThrow();
  expect((await current.action(snapshot, {})).asOf).toBe(NOW);
  await t.run((ctx) => ctx.db.patch("users", id, { role: "reader" }));
  await expect(current.action(snapshot, {})).rejects.toThrow(
    /administrator access/i,
  );
});
test("an unavailable component is an explicit partial snapshot, never zero usage", async () => {
  const t = setup(false),
    current = await actor(t, "admin");
  const result = await current.action(snapshot, {});
  expect(result.complete).toBe(false);
  expect(
    result.counters.every(
      (row) => row.used === null && row.eligibleAt === null,
    ),
  ).toBe(true);
});
test("one failed ledger read stays partial while the other40 results remain available", async () => {
  const t = setup(),
    current = await actor(t, "admin");
  const reads = vi
    .spyOn(RateLimiter.prototype, "getValue")
    .mockRejectedValueOnce(new Error("INERT PRIVATE FAILURE, NOT FOR CLIENTS"));
  const result = await current.action(snapshot, {});
  expect(reads).toHaveBeenCalledTimes(41);
  expect(result.complete).toBe(false);
  expect(
    result.counters.find((row) => row.id === "helius-rpc")?.used,
  ).toBeNull();
  expect(result.counters.find((row) => row.id === "geckoterminal")?.used).toBe(
    0,
  );
  expect(JSON.stringify(result)).not.toContain("PRIVATE FAILURE");
});
test("snapshot reads leave every one of the41 component values byte-for-byte unchanged", async () => {
  const t = setup(),
    current = await actor(t, "admin");
  const limiter = new RateLimiter(components.rateLimiter, {});
  await t.mutation(admit, { provider: "dexscreener", credits: 1 });
  const read = () =>
    t.run((ctx) =>
      Promise.all(
        providerLedgerRequests(NOW).map(({ name, key, config }) =>
          limiter.getValue(ctx, name, { key, config }),
        ),
      ),
    );
  const before = await read();
  await current.action(snapshot, {});
  expect(await read()).toEqual(before);
});
