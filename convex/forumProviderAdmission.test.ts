/// <reference types="vite/client" />
import { RateLimiter } from "@convex-dev/rate-limiter";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { components } from "./_generated/api";
import schema from "./schema";
import type { MeteredProvider } from "../lib/provider-admission-error";
import type { ProviderAdmission } from "./forumProviderFetch";
import { providerFetch } from "./forumProviderFetch";
import type { ActionCtx } from "./_generated/server";
import { FORUM_READ_POLICY } from "../lib/forum-read-policy";

const modules = import.meta.glob("./**/*.ts");
const admit = makeFunctionReference<
  "mutation",
  { provider: MeteredProvider; credits: number; sendTransaction?: true },
  ProviderAdmission
>("forumProviderAdmission:admit");
const NOW = Date.parse("2026-10-31T12:00:00Z");
const DAY = 86_400_000;
const limiter = new RateLimiter(components.rateLimiter, {});
const modulo = (n: number, m: number) => ((n % m) + m) % m;
function setup() {
  const t = convexTest(schema, modules);
  registerLimiter(t);
  return t;
}
const request = (provider: MeteredProvider = "helius", credits = 1) => ({
  provider,
  credits,
});
async function seedCredit(
  t: ReturnType<typeof setup>,
  at: number,
  count: number,
) {
  const day = Math.floor(at / DAY);
  const slot = modulo(day, 33);
  vi.setSystemTime(at);
  return t.run((ctx) =>
    limiter.limit(ctx, "forumProviderCreditsV1", {
      key: `helius:${slot}`,
      config: {
        kind: "fixed window",
        rate: 10000,
        capacity: 10000,
        period: 33 * DAY,
        start: slot * DAY,
      },
      count,
    }),
  );
}
async function todayUsed(t: ReturnType<typeof setup>, now = Date.now()) {
  const slot = modulo(Math.floor(now / DAY), 33);
  const value = await t.run((ctx) =>
    limiter.getValue(ctx, "forumProviderCreditsV1", {
      key: `helius:${slot}`,
      config: {
        kind: "fixed window",
        rate: 10000,
        capacity: 10000,
        period: 33 * DAY,
        start: slot * DAY,
      },
    }),
  );
  return 10000 - value.value;
}
async function sendSlotUsed(t: ReturnType<typeof setup>, now = Date.now()) {
  const slot = modulo(Math.floor(now / 1000), 2);
  const value = await t.run((ctx) =>
    limiter.getValue(ctx, "forumProviderBurstV1", {
      key: `helius-send:${slot}`,
      config: {
        kind: "fixed window",
        rate: 1,
        capacity: 1,
        period: 2000,
        start: slot * 1000,
      },
    }),
  );
  return 1 - value.value;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

test.each([
  ["helius", 5],
  ["dexscreener", 60],
  ["geckoterminal", 8],
] as const)(
  "200 parallel %s admissions share one component quota and admit at most %i",
  async (provider, limit) => {
    const t = setup();
    const results = await Promise.all(
      Array.from({ length: 200 }, () => t.mutation(admit, request(provider))),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(limit);
    expect(results.filter((r) => !r.ok)).toHaveLength(200 - limit);
    expect(results.filter((r) => !r.ok)).toEqual(
      Array.from({ length: 200 - limit }, () => ({
        ok: false,
        reason: "burst",
        retryAt: NOW + (provider === "helius" ? 2000 : 120000),
      })),
    );
    if (provider === "helius") expect(await todayUsed(t)).toBe(5);
  },
);

test.each([
  ["helius", 5, 1000],
  ["dexscreener", 60, 60000],
  ["geckoterminal", 8, 60000],
] as const)(
  "%s adjacent buckets prevent a boundary double burst and retain original retry time",
  async (provider, count, width) => {
    const t = setup();
    vi.setSystemTime(NOW + width - 1);
    for (let i = 0; i < count; i++)
      expect((await t.mutation(admit, request(provider))).ok).toBe(true);
    vi.setSystemTime(NOW + width);
    const expected = { ok: false, reason: "burst", retryAt: NOW + 2 * width };
    expect(await t.mutation(admit, request(provider))).toEqual(expected);
    vi.setSystemTime(NOW + 2 * width - 1);
    expect(await t.mutation(admit, request(provider))).toEqual(expected);
    vi.setSystemTime(NOW + 2 * width);
    expect((await t.mutation(admit, request(provider))).ok).toBe(true);
  },
);

test("mixed adjacent request buckets admit remaining capacity, then wait until the older bucket expires", async () => {
  const t = setup();
  for (let i = 0; i < 3; i++) await t.mutation(admit, request());
  vi.setSystemTime(NOW + 1000);
  for (let i = 0; i < 2; i++)
    expect((await t.mutation(admit, request())).ok).toBe(true);
  expect(await t.mutation(admit, request())).toEqual({
    ok: false,
    reason: "burst",
    retryAt: NOW + 2000,
  });
  vi.setSystemTime(NOW + 2000);
  for (let i = 0; i < 3; i++)
    expect((await t.mutation(admit, request())).ok).toBe(true);
  expect(await todayUsed(t)).toBe(8);
});

test("provider request budgets do not consume one another", async () => {
  const t = setup();
  for (let i = 0; i < 8; i++) await t.mutation(admit, request("geckoterminal"));
  expect((await t.mutation(admit, request("dexscreener"))).ok).toBe(true);
  expect((await t.mutation(admit, request("helius"))).ok).toBe(true);
  expect(await todayUsed(t)).toBe(1);
});

test("weighted RPC credits charge before I/O and deny without spending burst capacity or more credits", async () => {
  const t = setup();
  await seedCredit(t, NOW, 9995);
  expect((await t.mutation(admit, request("helius", 5))).ok).toBe(true);
  expect(await todayUsed(t)).toBe(10000);
  const nextDay = (Math.floor(NOW / DAY) + 1) * DAY;
  expect(await t.mutation(admit, request())).toEqual({
    ok: false,
    reason: "daily",
    retryAt: nextDay,
  });
  expect(await todayUsed(t)).toBe(10000);
  vi.setSystemTime(nextDay);
  expect((await t.mutation(admit, request())).ok).toBe(true);
  expect(await todayUsed(t)).toBe(1);
});

test("thirty fully consumed days prevent a midnight rolling-credit double burst", async () => {
  const t = setup();
  const startDay = Math.floor(NOW / DAY) * DAY;
  for (let offset = 30; offset >= 1; offset--)
    await seedCredit(t, startDay - offset * DAY, 10000);
  vi.setSystemTime(NOW);
  const expected = {
    ok: false,
    reason: "rolling",
    retryAt: startDay + 3 * DAY,
  };
  expect(await t.mutation(admit, request())).toEqual(expected);
  vi.setSystemTime(startDay + 2 * DAY + DAY - 1);
  expect(await t.mutation(admit, request())).toEqual(expected);
  vi.setSystemTime(startDay + 3 * DAY);
  expect((await t.mutation(admit, request())).ok).toBe(true);
});

test("rolling retry accounts for enough expiring credits, not just the first nonempty day", async () => {
  const t = setup();
  const day = Math.floor(NOW / DAY) * DAY;
  await seedCredit(t, day - 32 * DAY, 1);
  await seedCredit(t, day - 31 * DAY, 9999);
  for (let offset = 30; offset >= 2; offset--)
    await seedCredit(t, day - offset * DAY, 10000);
  vi.setSystemTime(NOW);
  expect(await t.mutation(admit, request("helius", 3))).toEqual({
    ok: false,
    reason: "rolling",
    retryAt: day + 2 * DAY,
  });
});

test("component slots retain covered days and naturally reuse only after day33, without a reset", async () => {
  const t = setup();
  const day = Math.floor(NOW / DAY) * DAY;
  await seedCredit(t, day, 10000);
  vi.setSystemTime(day + 32 * DAY);
  expect((await t.mutation(admit, request())).ok).toBe(true);
  vi.setSystemTime(day + 33 * DAY);
  expect((await t.mutation(admit, request())).ok).toBe(true);
  expect(await todayUsed(t)).toBe(1);
});

test("fixed slot count remains bounded through leap-month/day rollover", async () => {
  const t = setup();
  const start = Date.parse("2028-02-27T23:59:59Z");
  for (let day = 0; day < 70; day++) {
    vi.setSystemTime(start + day * DAY);
    for (const provider of [
      "helius",
      "dexscreener",
      "geckoterminal",
    ] as const) {
      expect((await t.mutation(admit, request(provider))).ok).toBe(true);
      vi.setSystemTime(
        start + day * DAY + (provider === "helius" ? 1000 : 60000),
      );
      expect((await t.mutation(admit, request(provider))).ok).toBe(true);
    }
  }
  const values = await t.run(async (ctx) =>
    Promise.all([
      ...Array.from({ length: 33 }, (_, slot) =>
        limiter.getValue(ctx, "forumProviderCreditsV1", {
          key: `helius:${slot}`,
          config: {
            kind: "fixed window",
            rate: 10000,
            capacity: 10000,
            period: 33 * DAY,
            start: slot * DAY,
          },
        }),
      ),
    ]),
  );
  expect(values).toHaveLength(33);
  // Every reachable key is one of 33 credit slots or two request slots for
  // each fixed provider. This test never asks a component to clear old state.
  expect(
    values.every((row) => Number.isSafeInteger(row.value) && row.value >= 9996),
  ).toBe(true);
});

test.each([0, -1, 0.5, NaN, Infinity, 10001])(
  "invalid weighted cost %s is rejected before component writes",
  async (credits) => {
    const t = setup();
    await expect(t.mutation(admit, request("helius", credits))).rejects.toThrow(
      "Invalid provider admission.",
    );
    expect(await todayUsed(t)).toBe(0);
    expect((await t.mutation(admit, request())).ok).toBe(true);
  },
);

test.each(["dexscreener", "geckoterminal"] as const)(
  "non-RPC provider %s cannot spoof weighted credits",
  async (provider) => {
    const t = setup();
    await expect(t.mutation(admit, request(provider, 2))).rejects.toThrow(
      "Invalid provider admission.",
    );
    expect((await t.mutation(admit, request(provider))).ok).toBe(true);
  },
);

test("configured policy retains upstream margins and does not touch financial/model settings", () => {
  expect(FORUM_READ_POLICY.helius).toMatchObject({
    dailyCredits: 10000,
    rollingCredits: 300000,
    rollingDays: 32,
    requestsPerWindow: 5,
    windowMs: 1000,
  });
  expect(FORUM_READ_POLICY.geckoterminal.requestsPerWindow).toBe(8);
  expect(FORUM_READ_POLICY.dexscreener.requestsPerWindow).toBe(60);
});

test("ten serial RPC reads wait before I/O without repeating any upstream call", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const t = setup();
  const rpc = "https://mainnet.helius-rpc.com/?api-key=inert";
  const times: number[] = [];
  const fetcher = vi.fn<typeof fetch>(async () => {
    times.push(Date.now());
    return new Response("{}");
  });
  const runMutation = async (
    _ref: unknown,
    args: { provider: MeteredProvider; credits: number },
  ) => t.mutation(admit, args);
  const read = providerFetch(
    { runMutation } as unknown as Pick<ActionCtx, "runMutation">,
    { rpcUrls: [rpc], fetcher },
  );
  const initial = {
    method: "POST",
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getBalance",
      params: [],
    }),
  };
  const work = (async () => {
    for (let i = 0; i < 10; i++) await read(rpc, initial);
  })();
  await vi.advanceTimersByTimeAsync(2500);
  await work;
  expect(fetcher).toHaveBeenCalledTimes(10);
  expect(times.slice(0, 5)).toEqual(Array(5).fill(NOW));
  expect(times.slice(5)).toEqual(Array(5).fill(NOW + 2000));
  expect(await todayUsed(t)).toBe(10);
});

test("200 concurrent wrapped RPC calls stay bounded, with no more than one upstream attempt each", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const t = setup();
  const rpc = "https://mainnet.helius-rpc.com/?api-key=inert";
  const times: number[] = [];
  const ids: number[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    times.push(Date.now());
    ids.push((JSON.parse(init!.body as string) as { id: number }).id);
    return new Response("{}");
  });
  const runMutation = async (
    _ref: unknown,
    args: { provider: MeteredProvider; credits: number },
  ) => t.mutation(admit, args);
  const read = providerFetch(
    { runMutation } as unknown as Pick<ActionCtx, "runMutation">,
    { rpcUrls: [rpc], fetcher },
  );
  const work = Promise.allSettled(
    Array.from({ length: 200 }, (_, id) =>
      read(rpc, {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "getBalance",
          params: [],
        }),
      }),
    ),
  );
  await vi.advanceTimersByTimeAsync(2500);
  const results = await work;
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(190);
  expect(fetcher).toHaveBeenCalledTimes(10);
  expect(new Set(ids).size).toBe(10);
  for (const start of times)
    expect(
      times.filter((time) => time >= start && time < start + 1000),
    ).toHaveLength(5);
  expect(await todayUsed(t)).toBe(10);
});

test("200 parallel send-method admissions share a stricter one-per-second subgate", async () => {
  const t = setup();
  const send = { ...request(), sendTransaction: true as const };
  const results = await Promise.all(
    Array.from({ length: 200 }, () => t.mutation(admit, send)),
  );
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.filter((r) => !r.ok)).toEqual(
    Array.from({ length: 199 }, () => ({
      ok: false,
      reason: "burst",
      retryAt: NOW + 2000,
    })),
  );
  expect(await todayUsed(t)).toBe(1);
  // A denied method-specific request did not consume any of the four remaining
  // shared RPC slots or credits. Reads still obey the original overall limit.
  for (let i = 0; i < 4; i++)
    expect((await t.mutation(admit, request())).ok).toBe(true);
  expect(await t.mutation(admit, request())).toMatchObject({
    ok: false,
    reason: "burst",
  });
  expect(await todayUsed(t)).toBe(5);
});

test("send subgate covers second boundaries without spending denied credit or changing the stored deadline", async () => {
  const t = setup();
  const send = { ...request(), sendTransaction: true as const };
  vi.setSystemTime(NOW + 999);
  expect((await t.mutation(admit, send)).ok).toBe(true);
  vi.setSystemTime(NOW + 1000);
  const denied = { ok: false, reason: "burst", retryAt: NOW + 2000 };
  expect(await t.mutation(admit, send)).toEqual(denied);
  vi.setSystemTime(NOW + 1999);
  expect(await t.mutation(admit, send)).toEqual(denied);
  expect(await todayUsed(t)).toBe(1);
  vi.setSystemTime(NOW + 2000);
  expect((await t.mutation(admit, send)).ok).toBe(true);
  expect(await todayUsed(t)).toBe(2);
});

test("overall RPC denial does not prematurely consume the stricter method subgate", async () => {
  const t = setup();
  for (let i = 0; i < 5; i++) await t.mutation(admit, request());
  const send = { ...request(), sendTransaction: true as const };
  expect(await t.mutation(admit, send)).toMatchObject({
    ok: false,
    reason: "burst",
  });
  expect(await todayUsed(t)).toBe(5);
  expect(await sendSlotUsed(t)).toBe(0);
  vi.setSystemTime(NOW + 2000);
  expect((await t.mutation(admit, send)).ok).toBe(true);
  expect(await todayUsed(t)).toBe(6);
});

test("daily denial does not consume a send slot and retains the later daily deadline", async () => {
  const t = setup();
  await seedCredit(t, NOW, 10000);
  const send = { ...request(), sendTransaction: true as const };
  const nextDay = (Math.floor(NOW / DAY) + 1) * DAY;
  expect(await t.mutation(admit, send)).toEqual({
    ok: false,
    reason: "daily",
    retryAt: nextDay,
  });
  expect(await todayUsed(t)).toBe(10000);
  expect(await sendSlotUsed(t)).toBe(0);
  vi.setSystemTime(nextDay);
  expect((await t.mutation(admit, send)).ok).toBe(true);
  expect(await todayUsed(t)).toBe(1);
});

test("rolling-credit denial never consumes a method slot or implies a submission outcome", async () => {
  const t = setup();
  const startDay = Math.floor(NOW / DAY) * DAY;
  for (let offset = 30; offset >= 1; offset--)
    await seedCredit(t, startDay - offset * DAY, 10000);
  vi.setSystemTime(NOW);
  const send = { ...request(), sendTransaction: true as const };
  expect(await t.mutation(admit, send)).toEqual({
    ok: false,
    reason: "rolling",
    retryAt: startDay + 3 * DAY,
  });
  expect(await sendSlotUsed(t)).toBe(0);
  vi.setSystemTime(startDay + 3 * DAY);
  expect((await t.mutation(admit, send)).ok).toBe(true);
});

test.each([
  {
    provider: "dexscreener" as const,
    credits: 1,
    sendTransaction: true as const,
  },
  {
    provider: "geckoterminal" as const,
    credits: 1,
    sendTransaction: true as const,
  },
  { provider: "helius" as const, credits: 2, sendTransaction: true as const },
])(
  "invalid method-specific admission %# is rejected before consuming any quota",
  async (args) => {
    const t = setup();
    await expect(t.mutation(admit, args)).rejects.toThrow(
      "Invalid provider admission.",
    );
    expect(await todayUsed(t)).toBe(0);
    expect(
      (await t.mutation(admit, { ...request(), sendTransaction: true })).ok,
    ).toBe(true);
  },
);

test("concurrent wrapped send-method requests each attempt upstream at most once under the stricter subgate", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const t = setup();
  const rpc = "https://mainnet.helius-rpc.com/?api-key=inert";
  const times: number[] = [];
  const ids: number[] = [];
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    times.push(Date.now());
    ids.push((JSON.parse(init!.body as string) as { id: number }).id);
    return new Response("{}");
  });
  const runMutation = async (
    _ref: unknown,
    args: {
      provider: MeteredProvider;
      credits: number;
      sendTransaction?: true;
    },
  ) => t.mutation(admit, args);
  const read = providerFetch(
    { runMutation } as unknown as Pick<ActionCtx, "runMutation">,
    { rpcUrls: [rpc], fetcher },
  );
  const work = Promise.allSettled(
    Array.from({ length: 200 }, (_, id) =>
      read(rpc, {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "sendTransaction",
          params: ["INERT NOT A TRANSACTION"],
        }),
      }),
    ),
  );
  await vi.advanceTimersByTimeAsync(2500);
  const results = await work;
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(198);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(new Set(ids).size).toBe(2);
  expect(times).toEqual([NOW, NOW + 2000]);
  for (const start of times)
    expect(
      times.filter((time) => time >= start && time < start + 1000),
    ).toHaveLength(1);
  expect(await todayUsed(t)).toBe(2);
});
