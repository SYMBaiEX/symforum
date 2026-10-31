/// <reference types="vite/client" />
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerBetterAuth } from "@convex-dev/better-auth/test";
import { makeFunctionReference } from "convex/server";
import schema from "./schema";
import { createIdentityAuth } from "./identity";

const modules = import.meta.glob("./**/*.ts");
const NOW = Date.UTC(2026, 9, 31, 12);
function setup() {
  const t = convexTest(schema, modules);
  registerBetterAuth(t);
  return t;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("CONVEX_SITE_URL", "https://strong-bee-384.convex.site");
  vi.stubEnv("IDENTITY_SITE_URL", "https://www.symbaiex.com");
  vi.stubEnv("BETTER_AUTH_ENABLED", "true");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "isolated-counter-test-secret-not-production",
  );
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

test("one guarded counter increment needs one top-level server transaction, not action-side read/CAS round trips", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    await adapter.create({
      model: "rateLimit",
      data: { key: "normal-counter", count: 0, lastRequest: NOW },
    });
    const reads = vi.spyOn(ctx, "runQuery");
    const writes = vi.spyOn(ctx, "runMutation");
    const result = await adapter.incrementOne({
      model: "rateLimit",
      where: [
        { field: "key", value: "normal-counter" },
        { field: "count", operator: "lt", value: 30 },
      ],
      increment: { count: 1 },
      set: { lastRequest: NOW },
    });
    expect(result).toMatchObject({
      key: "normal-counter",
      count: 1,
      lastRequest: NOW,
    });
    expect(reads.mock.calls.length + writes.mock.calls.length).toBe(1);
    expect(reads).not.toHaveBeenCalled();
    expect(writes).toHaveBeenCalledTimes(1);
    return null;
  });
});

test("same-key contention returns exact cap decisions without exhausting application-side CAS attempts", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    await adapter.create({
      model: "rateLimit",
      data: { key: "contended-counter", count: 0, lastRequest: NOW },
    });
    const results = await Promise.allSettled(
      Array.from({ length: 64 }, () =>
        adapter.incrementOne({
          model: "rateLimit",
          where: [
            { field: "key", value: "contended-counter" },
            { field: "count", operator: "lt", value: 30 },
          ],
          increment: { count: 1 },
          set: { lastRequest: NOW },
        }),
      ),
    );
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(
      results.filter((r) => r.status === "fulfilled" && r.value !== null),
    ).toHaveLength(30);
    expect(
      await adapter.findOne({
        model: "rateLimit",
        where: [{ field: "key", value: "contended-counter" }],
      }),
    ).toMatchObject({ count: 30, lastRequest: NOW });
    return null;
  });
});

test("distinct counter keys stay isolated under parallel increments", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    for (let i = 0; i < 16; i++)
      await adapter.create({
        model: "rateLimit",
        data: { key: `independent-${i}`, count: 0, lastRequest: NOW },
      });
    const results = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        adapter.incrementOne({
          model: "rateLimit",
          where: [{ field: "key", value: `independent-${i}` }],
          increment: { count: 1 },
        }),
      ),
    );
    expect(results).toHaveLength(16);
    for (let i = 0; i < results.length; i++)
      expect(results[i]).toMatchObject({ key: `independent-${i}`, count: 1 });
    return null;
  });
});

test("old guards, absent rows and null predicates never change a counter", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    const where = [{ field: "key", value: "guarded-counter" }];
    await adapter.create({
      model: "rateLimit",
      data: { key: "guarded-counter", count: 4, lastRequest: NOW },
    });
    for (const guard of [
      [{ field: "key", value: "missing-counter" }],
      [...where, { field: "count", value: 3 }],
      [...where, { field: "lastRequest", operator: "lt" as const, value: NOW }],
      [...where, { field: "count", value: null }],
    ])
      expect(
        await adapter.incrementOne({
          model: "rateLimit",
          where: guard,
          increment: { count: 1 },
        }),
      ).toBeNull();
    expect(await adapter.findOne({ model: "rateLimit", where })).toMatchObject({
      count: 4,
      lastRequest: NOW,
    });
    return null;
  });
});

test("set and increment preserve zero, no-op and updated logical-id output semantics", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    const where = [{ field: "key", value: "set-counter" }];
    await adapter.create({
      model: "rateLimit",
      data: { key: "set-counter", count: 0, lastRequest: NOW },
    });
    const before = await adapter.findOne({ model: "rateLimit", where });
    expect(
      await adapter.incrementOne({
        model: "rateLimit",
        where,
        increment: { count: 0 },
      }),
    ).toEqual(before);
    const result = await adapter.incrementOne({
      model: "rateLimit",
      where,
      increment: { count: 2 },
      set: { count: 100, lastRequest: NOW + 60_000 },
    });
    expect(result).toMatchObject({ count: 2, lastRequest: NOW + 60_000 });
    expect(result).toEqual(
      await adapter.findOne({ model: "rateLimit", where }),
    );
    expect(
      await adapter.incrementOne({
        model: "rateLimit",
        where,
        increment: {},
        set: { count: 1, lastRequest: NOW + 120_000 },
      }),
    ).toMatchObject({ count: 1, lastRequest: NOW + 120_000 });
    return null;
  });
});

test("non-counter models retain the reviewed atomic fallback and one-use proof semantics", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    await adapter.create({
      model: "verification",
      data: {
        identifier: "preserved-proof",
        value: "test-only",
        expiresAt: new Date(NOW + 60_000),
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    });
    expect(
      await adapter.incrementOne({
        model: "verification",
        where: [{ field: "identifier", value: "preserved-proof" }],
        increment: { expiresAt: 1_000 },
      }),
    ).toMatchObject({ expiresAt: NOW + 61_000 });
    const consumed = await Promise.all(
      [0, 1].map(() =>
        adapter.consumeOne({
          model: "verification",
          where: [{ field: "identifier", value: "preserved-proof" }],
        }),
      ),
    );
    expect(consumed.filter(Boolean)).toHaveLength(1);
    return null;
  });
});

test("logical-id-only requests keep the original guarded fallback rather than drop unsupported selectors", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    const row = await adapter.create<{ id: string }>({
      model: "rateLimit",
      data: { key: "id-counter", count: 0, lastRequest: NOW },
    });
    expect(
      await adapter.incrementOne({
        model: "rateLimit",
        where: [
          { field: "id", value: row.id },
          { field: "count", operator: "lt", value: 1 },
        ],
        increment: { count: 1 },
      }),
    ).toMatchObject({ id: row.id, count: 1 });
    expect(
      await adapter.incrementOne({
        model: "rateLimit",
        where: [
          { field: "id", value: row.id },
          { field: "count", operator: "lt", value: 1 },
        ],
        increment: { count: 1 },
      }),
    ).toBeNull();
    return null;
  });
});

test("a failed non-representable update leaves old counter state intact and a later valid update succeeds", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    const where = [{ field: "key", value: "numeric-counter" }];
    await adapter.create({
      model: "rateLimit",
      data: {
        key: "numeric-counter",
        count: Number.MAX_VALUE,
        lastRequest: NOW,
      },
    });
    await expect(
      adapter.incrementOne({
        model: "rateLimit",
        where,
        increment: { count: Number.MAX_VALUE },
      }),
    ).rejects.toThrow("representable");
    expect(await adapter.findOne({ model: "rateLimit", where })).toMatchObject({
      count: Number.MAX_VALUE,
      lastRequest: NOW,
    });
    expect(
      await adapter.incrementOne({
        model: "rateLimit",
        where,
        increment: {},
        set: { count: 1 },
      }),
    ).toMatchObject({ count: 1 });
    return null;
  });
});

test("query-only contexts cannot increment an auth counter", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    await adapter.create({
      model: "rateLimit",
      data: { key: "query-counter", count: 0, lastRequest: NOW },
    });
    return null;
  });
  await expect(
    t.query(async (ctx) => {
      const adapter = (await createIdentityAuth(ctx).$context).adapter;
      return adapter.incrementOne({
        model: "rateLimit",
        where: [{ field: "key", value: "query-counter" }],
        increment: { count: 1 },
      });
    }),
  ).rejects.toThrow("mutation ctx");
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    expect(
      await adapter.findOne({
        model: "rateLimit",
        where: [{ field: "key", value: "query-counter" }],
      }),
    ).toMatchObject({ count: 0 });
    return null;
  });
});

test("every supported comparison is retained; no disallowed guard can be silently discarded", async () => {
  const t = setup();
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    const key = { field: "key", value: "comparison-counter" };
    await adapter.create({
      model: "rateLimit",
      data: { key: key.value, count: 2, lastRequest: NOW },
    });
    for (const guard of [
      { field: "count", operator: "eq" as const, value: 2 },
      { field: "count", operator: "ne" as const, value: 3 },
      { field: "count", operator: "lt" as const, value: 3 },
      { field: "count", operator: "lte" as const, value: 2 },
      { field: "count", operator: "gt" as const, value: 1 },
      { field: "count", operator: "gte" as const, value: 2 },
    ])
      expect(
        await adapter.incrementOne({
          model: "rateLimit",
          where: [key, guard],
          increment: { count: 0 },
        }),
      ).toMatchObject({ count: 2 });
    expect(
      await adapter.incrementOne({
        model: "rateLimit",
        where: [key, { field: "count", operator: "in", value: [1] }],
        increment: { count: 1 },
      }),
    ).toBeNull();
    expect(
      await adapter.findOne({ model: "rateLimit", where: [key] }),
    ).toMatchObject({ count: 2 });
    return null;
  });
});

test("the internal boundary rejects missing keys, arbitrary models and nonfinite updates without writes", async () => {
  const t = setup();
  const ref = makeFunctionReference<"mutation">("identityRateLimit:increment");
  await expect(
    t.mutation(ref, { where: [], increment: { count: 1 } }),
  ).rejects.toThrow("Invalid identity counter");
  await expect(
    t.mutation(ref, {
      model: "user",
      where: [{ field: "key", value: "forbidden" }],
      increment: { count: 1 },
    }),
  ).rejects.toThrow();
  await expect(
    t.mutation(ref, {
      where: [{ field: "key", value: "forbidden" }],
      increment: { count: Infinity },
    }),
  ).rejects.toThrow("Invalid identity counter");
  await expect(
    t.mutation(ref, {
      where: [{ field: "key", value: "forbidden" }],
      increment: {},
      set: { count: Infinity },
    }),
  ).rejects.toThrow("Invalid identity counter");
  await t.action(async (ctx) => {
    const adapter = (await createIdentityAuth(ctx).$context).adapter;
    expect(await adapter.findMany({ model: "rateLimit" })).toHaveLength(0);
    return null;
  });
});
