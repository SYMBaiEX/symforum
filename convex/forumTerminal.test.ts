/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerBetterAuth } from "@convex-dev/better-auth/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { getBase58Decoder } from "@solana/kit";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";
import { IDENTITY_MARKER } from "../lib/identity-config";
import { SYMF_TOKEN } from "../lib/symf-token";
import { TOKEN_2022_PROGRAM } from "../lib/forum-commerce";
import { recordTerminalPromotionReceipt } from "./forumTerminalTransparency";
import type { TokenSnapshot } from "../lib/token-alpha";

const NOW = Date.parse("2026-10-30T12:00:00Z"),
  issuer = "https://strong-bee-384.convex.site";
const MINT = SYMF_TOKEN.mint,
  treasury = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";
const modules = import.meta.glob("./**/*.ts");
function setup() {
  const t = convexTest(schema, modules);
  registerBetterAuth(t);
  registerLimiter(t);
  return t;
}
function snapshot(overrides: Partial<TokenSnapshot> = {}): TokenSnapshot {
  return {
    platform: "pumpfun",
    mint: MINT,
    name: "Example",
    symbol: "EX",
    observedAt: NOW,
    metricsAsOf: NOW,
    priceUsd: 1,
    marketCapUsd: 75_000,
    holders: 20,
    volume1hUsd: 1000,
    liquidityUsd: 5000,
    priceChange1hPercent: 2,
    imageUrl: null,
    website: null,
    twitter: null,
    telegram: null,
    description: null,
    sourceUrl: `https://www.solanatracker.io/token/${MINT}`,
    sourceRank: 1,
    ...overrides,
  };
}
async function actor(t: ReturnType<typeof setup>, n: number) {
  const native = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: `Reader${n}`,
          email: `reader${n}@example.test`,
          emailVerified: true,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    }),
  );
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      name: `Reader${n}`,
      role: "reader",
    });
    await ctx.db.insert("betterAuthIdentityLinks", {
      authUserId: native._id,
      userId: id,
      linkedAt: NOW,
    });
    return id;
  });
  const session = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "session",
        data: {
          userId: native._id,
          token: crypto.randomUUID(),
          createdAt: NOW,
          updatedAt: NOW,
          expiresAt: NOW + 86_400_000,
        },
      },
    }),
  );
  const wallet = getBase58Decoder().decode(new Uint8Array(32).fill(n));
  await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "account",
        data: {
          userId: native._id,
          providerId: "solana",
          accountId: wallet,
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    }),
  );
  return {
    wallet,
    userId,
    authUserId: native._id,
    client: t.withIdentity({
      issuer,
      subject: native._id,
      authSystem: IDENTITY_MARKER,
      sessionId: session._id,
    }),
  };
}
beforeEach(() => {
  // The auth adapter uses new Date(), so Date.now alone leaves sessions wall-clock dependent.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("CONVEX_SITE_URL", issuer);
  vi.stubEnv("BETTER_AUTH_ENABLED", "true");
  vi.stubEnv("FORUM_COMMERCE_TREASURY", treasury);
  vi.stubEnv("FORUM_COMMERCE_RPC_URL", "https://api.mainnet-beta.solana.com");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

test("authentication and terminal samples use the same fixed fixture clock", () => {
  expect(Date.now()).toBe(NOW);
  expect(new Date().getTime()).toBe(NOW);
});

describe("public sampled terminal markets", () => {
  test("stores every validated candidate, classifies actual cap and returns only the public projection", async () => {
    const t = setup(),
      other = getBase58Decoder().decode(new Uint8Array(32).fill(9));
    await t.mutation(internal.forumTerminalData.recordSnapshots, {
      snapshots: [
        snapshot(),
        snapshot({ mint: other, marketCapUsd: 750_000, sourceRank: 2 }),
      ],
    });
    const all = await t.query(api.forumTerminal.listMarket, { now: NOW });
    expect(all.markets).toHaveLength(2);
    expect(all.coverage).toBe("sampled");
    expect(all.stale).toBe(false);
    const small = await t.query(api.forumTerminal.listMarket, {
      now: NOW,
      band: "50k100k",
    });
    expect(small.markets.map((m) => m.mint)).toEqual([MINT]);
    expect(small.markets[0].fdvUsd).toBeNull();
    expect(small.markets[0]).not.toHaveProperty("warnings");
    expect(small.markets[0].threadUrl).toBeNull();
    expect(
      (await t.query(api.forumTerminal.listMarket, { now: NOW + 16 * 60_000 }))
        .stale,
    ).toBe(true);
    await expect(
      t.query(api.forumTerminal.listMarket, { now: NOW, limit: 61 }),
    ).rejects.toThrow();
  });
  test("rejects stale ingestion and never lets an older snapshot replace newer data", async () => {
    const t = setup();
    await expect(
      t.mutation(internal.forumTerminalData.recordSnapshots, {
        snapshots: [snapshot({ metricsAsOf: NOW - 901_000 })],
      }),
    ).rejects.toThrow();
    await t.mutation(internal.forumTerminalData.recordSnapshots, {
      snapshots: [snapshot()],
    });
    await t.mutation(internal.forumTerminalData.recordSnapshots, {
      snapshots: [snapshot({ metricsAsOf: NOW - 1000, priceUsd: 2 })],
    });
    expect(
      (await t.query(api.forumTerminal.getMarket, { mint: MINT, now: NOW }))
        ?.priceUsd,
    ).toBe(1);
  });
  test("prunes a bounded batch of old private alerts while keeping recent notifications", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 55; i++)
        await ctx.db.insert("forumTerminalAlerts", {
          authUserId: "private-owner",
          mint: MINT,
          symbol: "EX",
          direction: "above",
          thresholdUsd: 1,
          priceUsd: 2,
          observedAt: NOW - 31 * 86_400_000 - i,
          acknowledged: false,
        });
      await ctx.db.insert("forumTerminalAlerts", {
        authUserId: "private-owner",
        mint: MINT,
        symbol: "EX",
        direction: "above",
        thresholdUsd: 1,
        priceUsd: 2,
        observedAt: NOW,
        acknowledged: false,
      });
    });
    await t.mutation(internal.forumTerminalData.recordSnapshots, {
      snapshots: [snapshot()],
    });
    const remaining = await t.run((ctx) =>
      ctx.db.query("forumTerminalAlerts").withIndex("by_observedAt").take(60),
    );
    expect(remaining).toHaveLength(6);
    expect(remaining.some((row) => row.observedAt === NOW)).toBe(true);
  });
});
describe("private watches and bounded read leases", () => {
  test("watchlists preserve case and ownership; alert crossings are deduplicated by observed snapshot", async () => {
    const t = setup(),
      a = await actor(t, 1),
      b = await actor(t, 2);
    await expect(t.query(api.forumTerminal.listWatchlist, {})).rejects.toThrow(
      "Sign in",
    );
    await t.mutation(internal.forumTerminalData.recordSnapshots, {
      snapshots: [snapshot()],
    });
    await a.client.mutation(api.forumTerminal.setWatchlist, {
      mint: MINT,
      enabled: true,
      priceAboveUsd: 1.5,
    });
    expect(
      (await a.client.query(api.forumTerminal.listWatchlist, {}))[0].mint,
    ).toBe(MINT);
    expect(await b.client.query(api.forumTerminal.listWatchlist, {})).toEqual(
      [],
    );
    const next = snapshot({ metricsAsOf: NOW + 1000, priceUsd: 2 });
    await t.mutation(internal.forumTerminalData.recordSnapshots, {
      snapshots: [next],
    });
    await t.mutation(internal.forumTerminalData.evaluateAlerts, {
      snapshot: next,
      paginationOpts: { numItems: 100, cursor: null },
    });
    await t.mutation(internal.forumTerminalData.evaluateAlerts, {
      snapshot: next,
      paginationOpts: { numItems: 100, cursor: null },
    });
    const alerts = await a.client.query(api.forumTerminal.listAlerts, {});
    expect(alerts).toHaveLength(1);
    expect(alerts[0].direction).toBe("above");
    expect(await b.client.query(api.forumTerminal.listAlerts, {})).toEqual([]);
    await expect(
      b.client.mutation(api.forumTerminal.acknowledgeAlert, {
        id: alerts[0].id,
      }),
    ).rejects.toThrow("not found");
    await a.client.mutation(api.forumTerminal.acknowledgeAlert, {
      id: alerts[0].id,
    });
    expect(
      (await a.client.query(api.forumTerminal.listAlerts, {}))[0].acknowledged,
    ).toBe(true);
  });
  test("a wallet read lease is owner-bound and coalesces repeated reads even when selection changes", async () => {
    const t = setup(),
      a = await actor(t, 3),
      b = await actor(t, 4);
    await expect(
      b.client.mutation(internal.forumTerminalData.claimWalletRead, {
        wallet: a.wallet,
        lease: "wrong",
      }),
    ).rejects.toThrow("Link and verify");
    expect(
      (
        await a.client.mutation(internal.forumTerminalData.claimWalletRead, {
          wallet: a.wallet,
          lease: "first",
        })
      ).fetch,
    ).toBe(true);
    expect(
      (
        await a.client.mutation(internal.forumTerminalData.claimWalletRead, {
          wallet: a.wallet,
          lease: "duplicate",
          selectedMint: b.wallet,
        })
      ).fetch,
    ).toBe(false);
    expect(
      await t.run((ctx) => ctx.db.query("forumTerminalWallets").take(10)),
    ).toHaveLength(1);
  });
  test("a failed selection change never relabels the previous token balance", async () => {
    const t = setup(),
      a = await actor(t, 31),
      b = await actor(t, 32);
    await t.run((ctx) =>
      ctx.db.insert("forumTerminalWallets", {
        wallet: a.wallet,
        selection: MINT,
        lease: "old",
        leaseUntil: 0,
        nextFetchAt: 0,
        state: {
          wallet: a.wallet,
          checkedAt: NOW - 120_000,
          expiresAt: NOW - 60_000,
          slot: 123,
          balances: [{ mint: MINT, rawAmount: "1000000", decimals: 6 }],
          maxSolRaw: null,
          feeReserveLamports: null,
        },
      }),
    );
    expect(
      await a.client.mutation(internal.forumTerminalData.claimWalletRead, {
        wallet: a.wallet,
        selectedMint: b.wallet,
        lease: "new",
      }),
    ).toEqual({ fetch: true, state: null });
    await a.client.mutation(internal.forumTerminalData.saveWalletRead, {
      wallet: a.wallet,
      lease: "new",
      state: null,
    });
    expect(
      await a.client.mutation(internal.forumTerminalData.claimWalletRead, {
        wallet: a.wallet,
        selectedMint: b.wallet,
        lease: "again",
      }),
    ).toEqual({ fetch: false, state: null });
  });
  test("risk refresh shares one mint lease across owners and an unchanged daily budget", async () => {
    const t = setup(),
      a = await actor(t, 5),
      b = await actor(t, 6);
    expect(
      (
        await a.client.mutation(internal.forumTerminalData.claimRiskRead, {
          wallet: a.wallet,
          mint: MINT,
          lease: "a",
        })
      ).fetch,
    ).toBe(true);
    expect(
      (
        await b.client.mutation(internal.forumTerminalData.claimRiskRead, {
          wallet: b.wallet,
          mint: MINT,
          lease: "b",
        })
      ).fetch,
    ).toBe(false);
    await a.client.mutation(internal.forumTerminalData.saveRiskRead, {
      mint: MINT,
      lease: "wrong",
      risk: {
        mint: MINT,
        checkedAt: NOW,
        mintAuthority: null,
        freezeAuthority: null,
        tokenProgram: TOKEN_2022_PROGRAM,
        unsupportedExtensions: [],
        status: "checked",
      },
    });
    expect(await t.query(api.forumTerminal.getRisk, { mint: MINT })).toBeNull();
  });
  test("wallet reads validate every response, reuse cached data and never provide an unverified Max", async () => {
    const t = setup(),
      a = await actor(t, 8);
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)) as { method: string };
        const result =
          request.method === "getBalance"
            ? { context: { slot: 42 }, value: 123456789 }
            : request.method === "getAccountInfo"
              ? {
                  value: {
                    owner: TOKEN_2022_PROGRAM,
                    data: {
                      parsed: {
                        type: "mint",
                        info: {
                          isInitialized: true,
                          decimals: 6,
                          mintAuthority: null,
                          freezeAuthority: null,
                          extensions: [],
                        },
                      },
                    },
                  },
                }
              : request.method === "getTokenAccountsByOwner"
                ? {
                    context: { slot: 42 },
                    value: [
                      {
                        pubkey: MINT,
                        account: {
                          owner: TOKEN_2022_PROGRAM,
                          data: {
                            parsed: {
                              type: "account",
                              info: {
                                owner: a.wallet,
                                mint: MINT,
                                state: "initialized",
                                tokenAmount: { amount: "987654", decimals: 6 },
                              },
                            },
                          },
                        },
                      },
                    ],
                  }
                : null;
        if (result === null) throw new Error("Unexpected RPC method.");
        return Response.json({ jsonrpc: "2.0", id: 1, result });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const state = await a.client.action(api.forumTerminal.getWalletReadState, {
      wallet: a.wallet,
    });
    expect(state?.balances).toEqual([
      {
        mint: "So11111111111111111111111111111111111111112",
        rawAmount: "123456789",
        decimals: 9,
      },
      { mint: MINT, rawAmount: "987654", decimals: 6 },
    ]);
    expect(state?.maxSolRaw).toBeNull();
    expect(state?.feeReserveLamports).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      await a.client.action(api.forumTerminal.getWalletReadState, {
        wallet: a.wallet,
      }),
    ).toEqual(state);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(
      t.action(api.forumTerminal.getWalletReadState, { wallet: a.wallet }),
    ).rejects.toThrow("Sign in");
  });
  test("a failed risk refresh never reports an expired cached proof as refreshed", async () => {
    const t = setup(),
      a = await actor(t, 33);
    vi.stubEnv("FORUM_COMMERCE_RPC_URL", "https://api.mainnet-beta.solana.com");
    vi.stubEnv("HELIUS_API_KEY", "test-terminal-key");
    const old = {
      mint: MINT,
      checkedAt: NOW - 11 * 60_000,
      mintAuthority: null,
      freezeAuthority: null,
      tokenProgram: TOKEN_2022_PROGRAM,
      unsupportedExtensions: [],
      status: "checked" as const,
    };
    await t.run((ctx) =>
      ctx.db.insert("forumTerminalRisks", {
        mint: MINT,
        lease: "old",
        leaseUntil: 0,
        nextFetchAt: 0,
        risk: old,
      }),
    );
    const fetcher = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetcher);
    expect(
      await a.client.action(api.forumTerminal.refreshRisk, {
        wallet: a.wallet,
        mint: MINT,
      }),
    ).toBeNull();
    expect(await t.query(api.forumTerminal.getRisk, { mint: MINT })).toEqual(
      old,
    );
    expect(
      await a.client.action(api.forumTerminal.refreshRisk, {
        wallet: a.wallet,
        mint: MINT,
      }),
    ).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test("partial alert edits still validate the combined upper/lower bounds", async () => {
    const t = setup(),
      a = await actor(t, 10);
    await a.client.mutation(api.forumTerminal.setWatchlist, {
      mint: MINT,
      enabled: true,
      priceAboveUsd: 2,
      priceBelowUsd: 1,
    });
    await expect(
      a.client.mutation(api.forumTerminal.setWatchlist, {
        mint: MINT,
        enabled: true,
        priceBelowUsd: 3,
      }),
    ).rejects.toThrow("lower threshold");
    expect(
      (await a.client.query(api.forumTerminal.listWatchlist, {}))[0]
        .priceBelowUsd,
    ).toBe(1);
  });
});
test("promotion transparency is exact, idempotent and never exposes private wallets or changes source holds", async () => {
  const t = setup(),
    a = await actor(t, 7);
  const intent = await t.run(async (ctx) => {
    const categoryId = await ctx.db.insert("forumCategories", {
      slug: "crypto",
      name: "Web3",
      description: "Test",
      kind: "board",
      status: "active",
      viewAccess: "public",
      position: 0,
      threadCount: 0,
      postCount: 0,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const threadId = await ctx.db.insert("forumThreads", {
      categoryId,
      categorySlug: "crypto",
      slug: "test",
      title: "Test",
      body: "Test body",
      authorId: a.userId,
      status: "active",
      pinned: false,
      replyCount: 0,
      viewCount: 0,
      lastPostAt: NOW,
      lastPostUserId: a.userId,
      searchText: "test",
      createdAt: NOW,
      updatedAt: NOW,
    });
    await ctx.db.insert("tokenAlphaTrackedTokens", {
      chain: "solana",
      mint: MINT,
      threadId,
      latestSnapshot: snapshot({
        metricsAsOf: NOW - 30 * 60_000,
        observedAt: NOW - 29 * 60_000,
      }),
      lastUpdatedAt: NOW - 29 * 60_000,
      createdAt: NOW - 29 * 60_000,
    });
    return ctx.db.insert("forumPromotionIntents", {
      authUserId: a.authUserId,
      userId: a.userId,
      wallet: a.wallet,
      threadId,
      categoryId,
      categorySlug: "crypto",
      treasury,
      mint: MINT,
      tokenProgram: TOKEN_2022_PROGRAM,
      decimals: 6,
      amountRaw: "10000000000",
      treasuryAmountRaw: "5000000000",
      burnAmountRaw: "5000000000",
      reference: "test",
      lane: 0,
      startsAt: NOW,
      endsAt: NOW + 86_400_000,
      createdAt: NOW,
      checkoutExpiresAt: NOW + 600_000,
      status: "held",
      signature: getBase58Decoder().decode(new Uint8Array(64).fill(1)),
      messageHash: "a".repeat(64),
      verifiedAt: NOW,
      issue: "paid_content_no_longer_eligible",
    });
  });
  const before = await t.run((ctx) =>
    ctx.db.get("forumPromotionIntents", intent),
  );
  await t.mutation(internal.forumTerminalData.backfillTrackedMarkets, {});
  const seeded = await t.query(api.forumTerminal.getMarket, {
    mint: MINT,
    now: NOW,
  });
  expect(seeded?.metricsAsOf).toBe(NOW - 30 * 60_000);
  expect(
    (await t.query(api.forumTerminal.listMarket, { now: NOW })).stale,
  ).toBe(true);
  expect(
    await t.run((ctx) => ctx.db.query("forumTerminalAlerts").take(1)),
  ).toEqual([]);
  await t.run(async (ctx) => {
    const row = await ctx.db.get("forumPromotionIntents", intent);
    if (row) {
      await recordTerminalPromotionReceipt(ctx, row, NOW);
      await recordTerminalPromotionReceipt(ctx, row, NOW);
    }
  });
  const result = await t.query(
    api.forumTerminalTransparency.getTransparency,
    {},
  );
  expect(result.verifiedPromotions).toBe(1);
  expect(result.burnAmountRaw).toBe("5000000000");
  expect(result.treasuryAmountRaw).toBe("5000000000");
  expect(result.historyComplete).toBe(false);
  expect(JSON.stringify(result)).not.toContain(a.wallet);
  expect(JSON.stringify(result)).not.toContain(a.authUserId);
  expect(JSON.stringify(result)).not.toContain("paid_content");
  expect(
    await t.run((ctx) => ctx.db.get("forumPromotionIntents", intent)),
  ).toEqual(before);
  await t.mutation(
    internal.forumTerminalTransparency.backfillPromotionReceipts,
    {},
  );
  expect(
    (await t.query(api.forumTerminalTransparency.getTransparency, {}))
      .verifiedPromotions,
  ).toBe(1);
});
