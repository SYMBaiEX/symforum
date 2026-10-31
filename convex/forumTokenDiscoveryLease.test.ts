/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerBetterAuth } from "@convex-dev/better-auth/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { getBase58Decoder } from "@solana/kit";
import schema from "./schema";
import { api, components, internal } from "./_generated/api";
import { commerceLimiter } from "./forumCommerce";
import { IDENTITY_MARKER } from "../lib/identity-config";
import { FORUM_READ_POLICY } from "../lib/forum-read-policy";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.UTC(2026, 9, 31, 12);
const issuer = "https://strong-bee-384.convex.site";
const mint = "So11111111111111111111111111111111111111112";
const tokenProgram = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const key = "search:SOL";
const discovery = (name: string) => [
  {
    id: mint,
    symbol: "SOL",
    name,
    decimals: 9,
    tokenProgram,
    isVerified: true,
  },
];
const cached = (name: string) =>
  JSON.stringify([
    {
      mint,
      symbol: "SOL",
      name,
      decimals: 9,
      tokenProgram,
      icon: null,
      verified: true,
    },
  ]);
function setup() {
  const t = convexTest(schema, modules);
  registerBetterAuth(t);
  registerLimiter(t);
  return t;
}
type Test = ReturnType<typeof setup>;
async function actor(t: Test, n = 1) {
  const now = Date.now();
  const wallet = getBase58Decoder().decode(new Uint8Array(32).fill(n));
  const native = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: `Reader ${n}`,
          email: `lease-${n}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: `Reader ${n}`,
      role: "reader",
    });
    await ctx.db.insert("betterAuthIdentityLinks", {
      authUserId: native._id,
      userId,
      linkedAt: now,
    });
  });
  const session = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: native._id,
          token: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 86_400_000,
        },
      },
    }),
  );
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          userId: native._id,
          providerId: "solana",
          accountId: wallet,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  return {
    wallet,
    client: t.withIdentity({
      issuer,
      subject: native._id,
      authSystem: IDENTITY_MARKER,
      sessionId: session._id,
    }),
  };
}
function deferredProvider() {
  const pending: { resolve(response: Response): void }[] = [];
  const fetcher = vi.fn((input: RequestInfo | URL) => {
    expect(String(input)).toBe("https://api.jup.ag/tokens/v2/search?query=SOL");
    return new Promise<Response>((resolve) => pending.push({ resolve }));
  });
  vi.stubGlobal("fetch", fetcher);
  return { fetcher, pending };
}
const row = (t: Test) =>
  t.run((ctx) =>
    ctx.db
      .query("forumTokenDiscoveryCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique(),
  );
const search = (a: Awaited<ReturnType<typeof actor>>) =>
  a.client.action(api.forumTokenDiscovery.search, {
    wallet: a.wallet,
    search: "SOL",
  });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("CONVEX_SITE_URL", issuer);
  vi.stubEnv("BETTER_AUTH_ENABLED", "true");
  vi.stubEnv("JUPITER_API_KEY", "inert-discovery-test-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected external transport");
    }),
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

for (const fails of [false, true])
  for (const bFails of [false, true])
    test(`late action A ${fails ? "failure" : "success"} cannot overwrite ${bFails ? "negative" : "successful"} B or return an old current result`, async () => {
      const t = setup(),
        a = await actor(t),
        p = deferredProvider();
      const first = search(a).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await vi.waitFor(() => expect(p.fetcher).toHaveBeenCalledTimes(1));
      vi.setSystemTime((await row(t))!.leaseUntil + 1);
      const second = search(a).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await vi.waitFor(() => expect(p.fetcher).toHaveBeenCalledTimes(2));
      p.pending[1].resolve(
        bFails
          ? new Response(null, { status: 503 })
          : Response.json(discovery("Current B")),
      );
      if (bFails) expect(await second).toHaveProperty("error");
      else
        expect(await second).toMatchObject({ value: [{ name: "Current B" }] });
      const before = await row(t);
      p.pending[0].resolve(
        fails
          ? new Response(null, { status: 503 })
          : Response.json(discovery("Late A")),
      );
      expect(await first).toHaveProperty("error");
      expect(await row(t)).toEqual(before);
      if (bFails) expect(await search(a)).toEqual([]);
      else expect(await search(a)).toMatchObject([{ name: "Current B" }]);
      expect(p.fetcher).toHaveBeenCalledTimes(2);
    });

for (const fails of [false, true])
  test(`an expired ${fails ? "failed" : "successful"} action without replacement neither saves nor returns its provider result`, async () => {
    const t = setup(),
      a = await actor(t),
      p = deferredProvider();
    const first = search(a).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    await vi.waitFor(() => expect(p.fetcher).toHaveBeenCalledTimes(1));
    const before = await row(t);
    vi.setSystemTime(before!.leaseUntil);
    p.pending[0].resolve(
      fails
        ? new Response(null, { status: 503 })
        : Response.json(discovery("Expired")),
    );
    expect(await first).toHaveProperty("error");
    expect(await row(t)).toEqual(before);
    expect(p.fetcher).toHaveBeenCalledTimes(1);
  });

test("three generations of the same search key fence ABA completions while the current lease stays pending", async () => {
  const t = setup(),
    a = await actor(t),
    p = deferredProvider();
  const first = search(a).catch(() => null);
  await vi.waitFor(() => expect(p.fetcher).toHaveBeenCalledTimes(1));
  vi.setSystemTime((await row(t))!.leaseUntil + 1);
  const second = search(a).catch(() => null);
  await vi.waitFor(() => expect(p.fetcher).toHaveBeenCalledTimes(2));
  vi.setSystemTime((await row(t))!.leaseUntil + 1);
  const current = search(a);
  await vi.waitFor(() => expect(p.fetcher).toHaveBeenCalledTimes(3));
  const active = await row(t);
  p.pending[0].resolve(Response.json(discovery("Old A")));
  await first;
  p.pending[1].resolve(new Response(null, { status: 503 }));
  await second;
  expect(await row(t)).toEqual(active);
  await expect(search(a)).rejects.toThrow("loading");
  expect(p.fetcher).toHaveBeenCalledTimes(3);
  const completedAt = Date.now();
  p.pending[2].resolve(Response.json(discovery("Current A")));
  expect(await current).toMatchObject([{ name: "Current A" }]);
  expect((await row(t))?.expiresAt).toBe(completedAt + 300_000);
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", {
        key: "all",
        count: FORUM_READ_POLICY.commerceDailyUnits - 3,
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", {
        key: "all",
        count: FORUM_READ_POLICY.commerceDailyUnits - 2,
      }),
    ),
  ).toMatchObject({ ok: false });
});

test("200 concurrent linked readers share one pending provider request and one reservation", async () => {
  const t = setup(),
    a = await actor(t),
    b = await actor(t, 2),
    p = deferredProvider();
  const rejected: unknown[] = [];
  const requests = Array.from({ length: 200 }, (_, i) =>
    search(i % 2 ? a : b).catch((error: unknown) => {
      rejected.push(error);
      return null;
    }),
  );
  await vi.waitFor(() => expect(rejected).toHaveLength(199));
  expect(p.fetcher).toHaveBeenCalledTimes(1);
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", {
        key: "all",
        count: FORUM_READ_POLICY.commerceDailyUnits - 1,
      }),
    ),
  ).toMatchObject({ ok: true });
  expect(
    await t.run((ctx) =>
      commerceLimiter.check(ctx, "commerceNetworkDaily", {
        key: "all",
        count: FORUM_READ_POLICY.commerceDailyUnits,
      }),
    ),
  ).toMatchObject({ ok: false });
  p.pending[0].resolve(Response.json(discovery("Shared")));
  const results = await Promise.all(requests);
  expect(results.filter((value) => value !== null)).toHaveLength(1);
  expect(await search(a)).toMatchObject([{ name: "Shared" }]);
  expect(p.fetcher).toHaveBeenCalledTimes(1);
});

for (const fails of [false, true])
  test(`only the current unexpired lease can commit ${fails ? "negative" : "successful"} cache data once`, async () => {
    const t = setup(),
      a = await actor(t);
    await a.client.mutation(internal.forumTokenDiscovery.reserve, {
      wallet: a.wallet,
      key,
      lease: "current",
    });
    expect(
      await t.mutation(internal.forumTokenDiscovery.save, {
        key,
        lease: "current",
        payload: fails ? "[]" : cached("Current"),
        failed: fails,
      }),
    ).toBe(true);
    const saved = await row(t);
    expect(saved?.leaseUntil).toBe(0);
    expect(saved?.expiresAt).toBe(NOW + (fails ? 30_000 : 300_000));
    expect(
      await t.mutation(internal.forumTokenDiscovery.save, {
        key,
        lease: "current",
        payload: cached("Duplicate"),
      }),
    ).toBe(false);
    expect(await row(t)).toEqual(saved);
  });

test("legacy fresh and pending rows remain readable or fenced without lease metadata", async () => {
  const t = setup(),
    a = await actor(t);
  const id = await t.run((ctx) =>
    ctx.db.insert("forumTokenDiscoveryCache", {
      key,
      payload: cached("Legacy"),
      expiresAt: NOW + 300_000,
      leaseUntil: 0,
    }),
  );
  const legacy = await row(t);
  expect(await search(a)).toMatchObject([{ name: "Legacy" }]);
  expect(
    await t.mutation(internal.forumTokenDiscovery.save, {
      key,
      lease: "forged",
      payload: cached("Unsafe"),
    }),
  ).toBe(false);
  expect(await row(t)).toEqual(legacy);
  await t.run((ctx) =>
    ctx.db.patch("forumTokenDiscoveryCache", id, {
      expiresAt: 0,
      leaseUntil: NOW + 12_000,
    }),
  );
  const pending = await row(t);
  await expect(search(a)).rejects.toThrow("loading");
  expect(
    await t.mutation(internal.forumTokenDiscovery.save, {
      key,
      lease: "forged",
      payload: "[]",
      failed: true,
    }),
  ).toBe(false);
  expect(await row(t)).toEqual(pending);
  expect(fetch).not.toHaveBeenCalled();
});

test("missing or expired legacy rows cannot be created or modified by a late completion", async () => {
  const t = setup();
  expect(
    await t.mutation(internal.forumTokenDiscovery.save, {
      key,
      lease: "late",
      payload: "[]",
    }),
  ).toBe(false);
  expect(await row(t)).toBeNull();
  await t.run((ctx) =>
    ctx.db.insert("forumTokenDiscoveryCache", {
      key,
      payload: "[]",
      expiresAt: 0,
      leaseUntil: NOW - 1,
    }),
  );
  const legacy = await row(t);
  expect(
    await t.mutation(internal.forumTokenDiscovery.save, {
      key,
      lease: "late",
      payload: "[]",
      failed: true,
    }),
  ).toBe(false);
  expect(await row(t)).toEqual(legacy);
});

test("expired legacy rows can receive an ordinary new claim and the existing negative-cache TTL", async () => {
  const t = setup(),
    a = await actor(t);
  await t.run((ctx) =>
    ctx.db.insert("forumTokenDiscoveryCache", {
      key,
      payload: "[]",
      expiresAt: 0,
      leaseUntil: NOW - 1,
    }),
  );
  const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(search(a)).rejects.toThrow("Token search is unavailable");
  expect((await row(t))?.expiresAt).toBe(NOW + 30_000);
  expect(await search(a)).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
