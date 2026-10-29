/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { register as registerBetterAuth } from "@convex-dev/better-auth/test";
import { register as registerLimiter } from "@convex-dev/rate-limiter/test";
import { getBase58Decoder } from "@solana/kit";
import schema from "./schema";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { IDENTITY_MARKER } from "../lib/identity-config";
import {
  COMMERCE_MINT,
  COMMERCE_POOL,
  TOKEN_2022_PROGRAM,
  PROMOTION_MEMO_PROGRAM,
} from "../lib/forum-commerce";

const modules = import.meta.glob("./**/*.ts"),
  issuer = "https://strong-bee-384.convex.site",
  treasury = "6fHaP66Vzs9hkgTA9uBSuWBHkaAGgbRvYc4JxkK2RMBY";

test("wallet session returns only the current verified human account's linked wallets", async () => {
  const t = setup(),
    first = await actor(t, 101),
    second = await actor(t, 102);
  await expect(t.query(api.forumCommerce.getWalletSession, {})).rejects.toThrow(
    "Sign in",
  );
  expect(
    await first.client.query(api.forumCommerce.getWalletSession, {}),
  ).toEqual({ authUserId: first.authUserId, wallets: [first.wallet] });
  expect(
    await second.client.query(api.forumCommerce.getWalletSession, {}),
  ).toEqual({ authUserId: second.authUserId, wallets: [second.wallet] });
});
test("token discovery requires linked ownership and reuses a bounded shared cache without a second provider request", async () => {
  const t = setup(),
    first = await actor(t, 103),
    second = await actor(t, 104);
  const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json([
      {
        id: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        name: "Solana",
        decimals: 9,
        tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        isVerified: true,
      },
    ]),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    first.client.action(api.forumTokenDiscovery.search, {
      wallet: second.wallet,
      search: "SOL",
    }),
  ).rejects.toThrow("Link and verify");
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    await first.client.action(api.forumTokenDiscovery.search, {
      wallet: first.wallet,
      search: "SOL",
    }),
  ).toHaveLength(1);
  expect(
    await second.client.action(api.forumTokenDiscovery.search, {
      wallet: second.wallet,
      search: "SOL",
    }),
  ).toHaveLength(1);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const url = String(fetcher.mock.calls[0]?.[0]);
  expect(url).toContain("https://api.jup.ag/tokens/v2/search?query=SOL");
});
function setup() {
  const t = convexTest(schema, modules);
  registerBetterAuth(t);
  registerLimiter(t);
  return t;
}
type Test = ReturnType<typeof setup>;
function key(n: number, size = 32) {
  return getBase58Decoder().decode(new Uint8Array(size).fill(n));
}
beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", issuer);
  vi.stubEnv("BETTER_AUTH_ENABLED", "true");
  vi.stubEnv("FORUM_SWAPS_ENABLED", "true");
  vi.stubEnv("FORUM_PROMOTIONS_ENABLED", "true");
  vi.stubEnv("FORUM_COMMERCE_TREASURY", treasury);
  vi.stubEnv("FORUM_COMMERCE_RPC_URL", "https://api.mainnet-beta.solana.com");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function actor(
  t: Test,
  n: number,
  options: { role?: "owner" | "reader"; link?: boolean } = {},
) {
  const now = Date.now(),
    wallet = key(n);
  const native = await t.run((ctx) =>
    ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: "user",
        data: {
          name: `Reader ${n}`,
          email: `reader-${n}@example.test`,
          emailVerified: true,
          createdAt: now,
          updatedAt: now,
        },
      },
    }),
  );
  const userId = await t.run(async (ctx) => {
    const id = await ctx.db.insert("users", {
      name: `Reader ${n}`,
      role: options.role ?? "reader",
    });
    await ctx.db.insert("betterAuthIdentityLinks", {
      authUserId: native._id,
      userId: id,
      linkedAt: now,
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
          createdAt: now,
          updatedAt: now,
          expiresAt: now + 86_400_000,
        },
      },
    }),
  );
  if (options.link !== false)
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
async function board(
  t: Test,
  slug = "crypto-test",
  viewAccess: "public" | "members" = "public",
) {
  return t.run((ctx) =>
    ctx.db.insert("forumCategories", {
      slug,
      name: slug,
      description: "Test",
      kind: "board",
      status: "active",
      viewAccess,
      position: 0,
      threadCount: 0,
      postCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}
async function thread(
  t: Test,
  userId: Id<"users">,
  categoryId: Id<"forumCategories">,
  n = 1,
  body = "$SYMF",
) {
  return t.run((ctx) =>
    ctx.db.insert("forumThreads", {
      categoryId,
      categorySlug: "crypto-test",
      slug: `test-${n}`,
      title: `Test ${n}`,
      body,
      authorId: userId,
      status: "active",
      pinned: false,
      replyCount: 0,
      viewCount: 0,
      lastPostAt: Date.now(),
      lastPostUserId: userId,
      searchText: "test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}
function installBalanceFetch(
  wallet: string,
  balanceRaw = "1000001",
  state = "initialized",
) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes("dexscreener"))
      return Response.json([
        {
          chainId: "solana",
          pairAddress: COMMERCE_POOL,
          baseToken: { address: COMMERCE_MINT },
          quoteToken: {
            address: "So11111111111111111111111111111111111111112",
          },
          priceUsd: "1",
          liquidity: { usd: 2000 },
          volume: { h1: 10 },
        },
      ]);
    const call = JSON.parse(String(init?.body));
    const result =
      call.method === "getAccountInfo"
        ? {
            value: {
              owner: TOKEN_2022_PROGRAM,
              data: {
                parsed: {
                  type: "mint",
                  info: {
                    isInitialized: true,
                    decimals: 6,
                    extensions: [
                      { extension: "metadataPointer" },
                      { extension: "tokenMetadata" },
                    ],
                  },
                },
              },
            },
          }
        : {
            value: [
              {
                account: {
                  owner: TOKEN_2022_PROGRAM,
                  data: {
                    parsed: {
                      type: "account",
                      info: {
                        mint: COMMERCE_MINT,
                        owner: wallet,
                        state,
                        tokenAmount: { amount: balanceRaw, decimals: 6 },
                      },
                    },
                  },
                },
              },
            ],
          };
    return Response.json({ jsonrpc: "2.0", id: 1, result });
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
async function reserve(
  t: Test,
  a: Awaited<ReturnType<typeof actor>>,
  threadId: Id<"forumThreads">,
) {
  return a.client.mutation(internal.forumPromotions.reserve, {
    wallet: a.wallet,
    threadId,
    tokenProgram: TOKEN_2022_PROGRAM,
    decimals: 6,
    reference: getBase58Decoder().decode(
      crypto.getRandomValues(new Uint8Array(32)),
    ),
  });
}
function chainReceipt(i: {
  wallet: string;
  treasury: string;
  mint: string;
  tokenProgram: string;
  treasuryAmountRaw: string;
  burnAmountRaw: string;
  reference: string;
  decimals: number;
}) {
  const source = key(252),
    destination = key(253);
  return {
    blockTime: Math.floor(Date.now() / 1000),
    meta: {
      err: null,
      preTokenBalances: [
        {
          accountIndex: 1,
          owner: i.wallet,
          mint: i.mint,
          programId: i.tokenProgram,
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 2,
          owner: i.treasury,
          mint: i.mint,
          programId: i.tokenProgram,
        },
      ],
    },
    transaction: {
      message: {
        accountKeys: [
          { pubkey: i.wallet, signer: true },
          { pubkey: source, signer: false },
          { pubkey: destination, signer: false },
        ],
        instructions: [
          {
            programId: i.tokenProgram,
            parsed: {
              type: "transferChecked",
              info: {
                authority: i.wallet,
                source,
                destination,
                mint: i.mint,
                tokenAmount: {
                  amount: i.treasuryAmountRaw,
                  decimals: i.decimals,
                },
              },
            },
          },
          {
            programId: i.tokenProgram,
            parsed: {
              type: "burnChecked",
              info: {
                authority: i.wallet,
                account: source,
                mint: i.mint,
                tokenAmount: { amount: i.burnAmountRaw, decimals: i.decimals },
              },
            },
          },
          {
            programId: PROMOTION_MEMO_PROGRAM,
            parsed: `SYMF-PROMOTION:${i.reference}`,
          },
        ],
      },
    },
  };
}
describe("commerce authorization and cached holder checks", () => {
  test("frozen SYMF does not grant a fee waiver and providers cannot redirect", async () => {
    const t = setup(),
      a = await actor(t, 91),
      fetcher = installBalanceFetch(a.wallet, "100000000000", "frozen");
    expect(
      await a.client.action(api.forumCommerce.refreshBenefit, {
        wallet: a.wallet,
      }),
    ).toMatchObject({ status: "verified", eligible: false, balanceRaw: "0" });
    expect(
      fetcher.mock.calls.every((call) => call[1]?.redirect === "error"),
    ).toBe(true);
  });
  test("only a current linked human wallet can trigger or read a benefit lookup", async () => {
    const t = setup(),
      a = await actor(t, 1),
      other = await actor(t, 2),
      fetcher = installBalanceFetch(a.wallet);
    await expect(
      t.action(api.forumCommerce.refreshBenefit, { wallet: a.wallet }),
    ).rejects.toThrow("Sign in");
    await expect(
      other.client.action(api.forumCommerce.refreshBenefit, {
        wallet: a.wallet,
      }),
    ).rejects.toThrow("Link and verify");
    expect(fetcher).not.toHaveBeenCalled();
    const benefit = await a.client.action(api.forumCommerce.refreshBenefit, {
      wallet: a.wallet,
    });
    expect(benefit).toMatchObject({
      status: "verified",
      eligible: true,
      balanceRaw: "1000001",
      priceUsd: "1",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      await a.client.action(api.forumCommerce.refreshBenefit, {
        wallet: a.wallet,
        refresh: true,
      }),
    ).toEqual(benefit);
    expect(fetcher).toHaveBeenCalledTimes(3);
    await expect(
      other.client.action(api.forumCommerce.refreshBenefit, {
        wallet: a.wallet,
      }),
    ).rejects.toThrow("Link and verify");
  });
  test("unavailable or suspicious token/price metadata never grants a waiver", async () => {
    const t = setup(),
      a = await actor(t, 3);
    installBalanceFetch(key(4));
    expect(
      await a.client.action(api.forumCommerce.refreshBenefit, {
        wallet: a.wallet,
      }),
    ).toMatchObject({
      eligible: false,
      status: "unavailable",
      balanceRaw: "0",
      priceUsd: null,
    });
    const records = await t.run((ctx) =>
      ctx.db.query("forumWalletBenefits").take(3),
    );
    expect(records).toHaveLength(1);
    expect(records[0]).not.toHaveProperty("error");
  });
  test("capability flags default off and missing treasury prevents all economic quotes", async () => {
    vi.stubEnv("FORUM_SWAPS_ENABLED", "");
    vi.stubEnv("FORUM_PROMOTIONS_ENABLED", "");
    const t = setup(),
      a = await actor(t, 4),
      b = await board(t),
      id = await thread(t, a.userId, b);
    expect(await t.query(api.forumCommerce.getConfig, {})).toMatchObject({
      swapsEnabled: false,
      promotionsEnabled: false,
      promotionBurnBps: 5000,
    });
    await expect(
      a.client.action(api.forumPromotions.quotePromotion, {
        wallet: a.wallet,
        threadId: id,
      }),
    ).rejects.toThrow("not enabled");
    const config = await t.query(api.forumCommerce.getConfig, {});
    expect(config).not.toHaveProperty("rpcUrl");
    expect(config).not.toHaveProperty("jupiterApiKey");
  });
});
describe("paid placements: capacity, receipts, ownership and moderation", () => {
  test("an empty linked wallet cannot reserve promotion inventory", async () => {
    const t = setup(),
      a = await actor(t, 92),
      b = await board(t),
      id = await thread(t, a.userId, b);
    installBalanceFetch(a.wallet, "0");
    await expect(
      a.client.action(api.forumPromotions.quotePromotion, {
        wallet: a.wallet,
        threadId: id,
      }),
    ).rejects.toThrow("full promotion amount");
    expect(
      await t.run((ctx) => ctx.db.query("forumPromotionIntents").take(1)),
    ).toEqual([]);
  });
  test("six finalized sponsors never create more than five concurrent public placements", async () => {
    const t = setup(),
      b = await board(t),
      paid = [];
    for (let n = 80; n < 86; n++) {
      const a = await actor(t, n),
        id = await thread(t, a.userId, b, n),
        i = await reserve(t, a, id);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ jsonrpc: "2.0", id: 1, result: chainReceipt(i) }),
        ),
      );
      paid.push(
        await a.client.action(api.forumPromotions.submitPromotion, {
          intentId: i.intentId,
          signature: key(n, 64),
        }),
      );
    }
    const now = Math.max(...paid.slice(0, 5).map((p) => p.startsAt)) + 1000;
    expect(
      await t.query(api.forumPromotions.listPromoted, {
        categorySlug: "crypto-test",
        now,
      }),
    ).toHaveLength(5);
    expect(paid[5].startsAt).toBeGreaterThan(now);
    expect(paid.every((p) => p.endsAt - p.startsAt === 86400000)).toBe(true);
  });
  test("concurrent reservations for one post cannot overbook; expired unpaid checkout releases only its lease", async () => {
    const t = setup(),
      a = await actor(t, 61),
      other = await actor(t, 62),
      b = await board(t),
      id = await thread(t, a.userId, b);
    const outcomes = await Promise.allSettled([
      reserve(t, a, id),
      reserve(t, other, id),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rows = await t.run((ctx) =>
      ctx.db.query("forumPromotionIntents").take(5),
    );
    expect(rows).toHaveLength(1);
    await t.run((ctx) =>
      ctx.db.patch("forumPromotionIntents", rows[0]._id, {
        checkoutExpiresAt: Date.now() - 1,
      }),
    );
    await t.mutation(internal.forumPromotions.expireCheckout, {
      intentId: rows[0]._id,
    });
    expect(
      (await t.run((ctx) => ctx.db.get("forumPromotionIntents", rows[0]._id)))
        ?.status,
    ).toBe("expired");
    await expect(
      reserve(t, rows[0].wallet === a.wallet ? other : a, id),
    ).resolves.toMatchObject({ status: "checkout" });
    expect(
      await t.run((ctx) => ctx.db.query("forumPromotionIntents").take(5)),
    ).toHaveLength(2);
  });
  test("preparation is consumed once and an ambiguous wallet outcome survives reload without payment replay", async () => {
    const t = setup(),
      a = await actor(t, 63),
      b = await board(t),
      id = await thread(t, a.userId, b),
      i = await reserve(t, a, id);
    await a.client.mutation(internal.forumPromotions.consumePreparation, {
      intentId: i.intentId,
    });
    await expect(
      a.client.mutation(internal.forumPromotions.consumePreparation, {
        intentId: i.intentId,
      }),
    ).rejects.toThrow("already requested");
    await a.client.mutation(internal.forumPromotions.savePreparation, {
      intentId: i.intentId,
      messageHash: "a".repeat(64),
    });
    await a.client.mutation(api.forumPromotions.beginWalletRequest, {
      intentId: i.intentId,
    });
    await expect(
      a.client.mutation(api.forumPromotions.beginWalletRequest, {
        intentId: i.intentId,
      }),
    ).rejects.toThrow("already started");
    await a.client.mutation(api.forumPromotions.markUnknown, {
      intentId: i.intentId,
    });
    expect(await a.client.query(api.forumPromotions.listMine, {})).toEqual([
      expect.objectContaining({
        status: "held",
        issue: "wallet_outcome_unknown",
        signature: null,
      }),
    ]);
    await t.run((ctx) =>
      ctx.db.patch("forumPromotionIntents", i.intentId, {
        checkoutExpiresAt: Date.now() - 1,
      }),
    );
    await t.mutation(internal.forumPromotions.expireCheckout, {
      intentId: i.intentId,
    });
    expect(
      await a.client.query(api.forumPromotions.getPromotion, {
        intentId: i.intentId,
      }),
    ).toMatchObject({ status: "held" });
    await expect(reserve(t, a, id)).rejects.toThrow("unresolved");
  });
  test("six independent checkouts reserve five lanes then queue; duplicate post reservation rolls back", async () => {
    const t = setup(),
      b = await board(t),
      intents = [];
    for (let n = 10; n < 16; n++) {
      const a = await actor(t, n),
        id = await thread(t, a.userId, b, n);
      intents.push(await reserve(t, a, id));
    }
    expect(
      Math.max(...intents.slice(0, 5).map((r) => r.startsAt)) -
        Math.min(...intents.slice(0, 5).map((r) => r.startsAt)),
    ).toBeLessThan(1000);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("forumPromotionIntents")
        .withIndex("by_categoryId_and_endsAt", (q) => q.eq("categoryId", b))
        .take(10),
    );
    expect(new Set(rows.slice(0, 5).map((r) => r.lane)).size).toBe(5);
    expect(intents[5].startsAt).toBeGreaterThanOrEqual(
      Math.min(...intents.slice(0, 5).map((r) => r.endsAt)),
    );
    const a = await actor(t, 16);
    await expect(reserve(t, a, intents[0].threadId)).rejects.toThrow("already");
    expect(
      (await t.run((ctx) => ctx.db.query("forumPromotionIntents").take(20)))
        .length,
    ).toBe(6);
  });
  test("only exact finalized treasury transfer plus burn activates; receipt is one-use and idempotent", async () => {
    const t = setup(),
      a = await actor(t, 20),
      other = await actor(t, 21),
      b = await board(t),
      id = await thread(t, a.userId, b),
      i = await reserve(t, a, id),
      signature = key(20, 64);
    const fetcher = vi.fn(async () =>
      Response.json({ jsonrpc: "2.0", id: 1, result: chainReceipt(i) }),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      other.client.query(api.forumPromotions.getPromotion, {
        intentId: i.intentId,
      }),
    ).rejects.toThrow();
    await expect(
      other.client.action(api.forumPromotions.submitPromotion, {
        intentId: i.intentId,
        signature,
      }),
    ).rejects.toThrow("not found");
    const paid = await a.client.action(api.forumPromotions.submitPromotion, {
      intentId: i.intentId,
      signature,
    });
    expect(paid.status).toBe("scheduled");
    expect(paid.endsAt - paid.startsAt).toBe(86_400_000);
    const entries = await t.query(api.forumPromotions.listPromoted, {
      categorySlug: "crypto-test",
      now: paid.startsAt,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ threadId: id, label: "Promoted" });
    expect(
      await a.client.action(api.forumPromotions.submitPromotion, {
        intentId: i.intentId,
        signature,
      }),
    ).toEqual(paid);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      a.client.action(api.forumPromotions.submitPromotion, {
        intentId: i.intentId,
        signature: key(21, 64),
      }),
    ).rejects.toThrow("cannot be replaced");
    const id2 = await thread(t, other.userId, b, 2),
      second = await reserve(t, other, id2);
    await expect(
      other.client.action(api.forumPromotions.submitPromotion, {
        intentId: second.intentId,
        signature,
      }),
    ).rejects.toThrow("already bound");
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", id, { status: "hidden" }),
    );
    expect(
      await t.query(api.forumPromotions.listPromoted, {
        categorySlug: "crypto-test",
        now: paid.startsAt,
      }),
    ).toEqual([]);
  });
  test("a missing finalized receipt stays held and the same signature can be reconciled without another payment", async () => {
    const t = setup(),
      a = await actor(t, 30),
      b = await board(t),
      id = await thread(t, a.userId, b),
      i = await reserve(t, a, id),
      signature = key(30, 64);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, result: null })),
    );
    expect(
      await a.client.action(api.forumPromotions.submitPromotion, {
        intentId: i.intentId,
        signature,
      }),
    ).toMatchObject({
      status: "held",
      signature,
      issue: "receipt_unavailable",
    });
    await expect(reserve(t, a, id)).rejects.toThrow();
    await expect(
      a.client.action(api.forumPromotions.submitPromotion, {
        intentId: i.intentId,
        signature: key(31, 64),
      }),
    ).rejects.toThrow("cannot be replaced");
    expect(
      await t.query(api.forumPromotions.listPromoted, {
        categorySlug: "crypto-test",
        now: Date.now(),
      }),
    ).toEqual([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ jsonrpc: "2.0", id: 1, result: chainReceipt(i) }),
      ),
    );
    expect(
      await a.client.action(api.forumPromotions.submitPromotion, {
        intentId: i.intentId,
        signature,
      }),
    ).toMatchObject({ status: "scheduled", signature });
  });
  test("private boards, hidden posts and inaccessible ancestors cannot be purchased or leaked", async () => {
    const t = setup(),
      a = await actor(t, 40),
      b = await board(t, "private", "members"),
      id = await thread(t, a.userId, b);
    await expect(reserve(t, a, id)).rejects.toThrow("active public");
    expect(
      await t.query(api.forumCommerce.resolveThreadTokens, { threadId: id }),
    ).toEqual([]);
    const publicBoard = await board(t, "crypto-test"),
      publicId = await thread(t, a.userId, publicBoard, 2);
    await t.run((ctx) =>
      ctx.db.patch("forumCategories", publicBoard, { parentCategoryId: b }),
    );
    await expect(reserve(t, a, publicId)).rejects.toThrow("active public");
    expect(
      await t.query(api.forumCommerce.resolveThreadTokens, {
        threadId: publicId,
      }),
    ).toEqual([]);
  });
  test("a verified payment cannot activate a post removed during checkout", async () => {
    const t = setup(),
      a = await actor(t, 50),
      b = await board(t),
      id = await thread(t, a.userId, b),
      i = await reserve(t, a, id),
      signature = key(50, 64);
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", id, { status: "deleted" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ jsonrpc: "2.0", id: 1, result: chainReceipt(i) }),
      ),
    );
    expect(
      await a.client.action(api.forumPromotions.submitPromotion, {
        intentId: i.intentId,
        signature,
      }),
    ).toMatchObject({
      status: "held",
      issue: "paid_content_no_longer_eligible",
    });
  });
});
describe("verified token discovery and one-shot swaps", () => {
  test("prepared wire limits count decoded bytes, not base64 characters", async () => {
    const t = setup(),
      a = await actor(t, 95);
    const seed = async () =>
      t.run((ctx) =>
        ctx.db.insert("forumSwapQuotes", {
          authUserId: a.authUserId,
          userId: a.userId,
          wallet: a.wallet,
          provider: "jupiter",
          quoteJson: "{}",
          treasury,
          createdAt: Date.now(),
          expiresAt: Date.now() + 25000,
          platformFeeBps: 25,
          status: "preparing",
        }),
      );
    const quoteId = await seed(),
      prepared = {
        quoteId,
        transactionBase64: btoa("x".repeat(4096)),
        messageHash: "c".repeat(64),
        lastValidBlockHeight: 100,
        estimatedNetworkFeeLamports: "5000",
        simulationSlot: 10,
        transactionVersion: 1 as const,
      };
    expect(prepared.transactionBase64.length).toBeGreaterThan(4096);
    await expect(
      a.client.mutation(internal.forumSwaps.prepared, prepared),
    ).resolves.toMatchObject({ transactionVersion: 1 });
    const oversized = await seed();
    await expect(
      a.client.mutation(internal.forumSwaps.prepared, {
        ...prepared,
        quoteId: oversized,
        transactionBase64: btoa("x".repeat(4097)),
      }),
    ).rejects.toThrow("wire size");
    expect(
      (await t.run((ctx) => ctx.db.get("forumSwapQuotes", oversized)))?.status,
    ).toBe("preparing");
  });
  test("one official linked mint is only a candidate until verification and private boards remain hidden", async () => {
    const t = setup(),
      a = await actor(t, 93),
      b = await board(t),
      id = await thread(t, a.userId, b),
      candidate = key(94);
    await t.run((ctx) =>
      ctx.db.patch("forumThreads", id, {
        body: `Token: https://pump.fun/coin/${candidate}`,
      }),
    );
    expect(
      await t.query(api.forumCommerce.getThreadMint, { threadId: id }),
    ).toBe(candidate);
    expect(
      await t.query(api.forumCommerce.resolveThreadTokens, { threadId: id }),
    ).toEqual([]);
    await t.run((ctx) =>
      ctx.db.patch("forumCategories", b, { viewAccess: "members" }),
    );
    expect(
      await t.query(api.forumCommerce.getThreadMint, { threadId: id }),
    ).toBeNull();
  });
  test("mapped public tokens require exact on-chain verification; blocked mints disappear and free-text ticker is not trusted", async () => {
    const t = setup(),
      a = await actor(t, 70, { role: "owner" }),
      b = await board(t),
      id = await thread(t, a.userId, b);
    await t.run(async (ctx) => {
      await ctx.db.patch("forumThreads", id, {
        body: "Community token $OTHER",
      });
      await ctx.db.insert("tokenAlphaTrackedTokens", {
        chain: "solana",
        mint: COMMERCE_MINT,
        threadId: id,
        lastUpdatedAt: Date.now(),
        createdAt: Date.now(),
      });
    });
    expect(
      await t.query(api.forumCommerce.getThreadMint, { threadId: id }),
    ).toBe(COMMERCE_MINT);
    expect(
      await t.query(api.forumCommerce.resolveThreadTokens, { threadId: id }),
    ).toEqual([]);
    const fetcher = installBalanceFetch(a.wallet);
    const resolved = await a.client.action(api.forumCommerce.resolveMint, {
      wallet: a.wallet,
      mint: COMMERCE_MINT,
    });
    expect(resolved).toMatchObject({
      mint: COMMERCE_MINT,
      decimals: 6,
      tokenProgram: TOKEN_2022_PROGRAM,
    });
    expect(
      await t.query(api.forumCommerce.resolveThreadTokens, { threadId: id }),
    ).toHaveLength(1);
    await a.client.action(api.forumCommerce.resolveMint, {
      wallet: a.wallet,
      mint: COMMERCE_MINT,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await a.client.mutation(api.forumCommerce.setTokenBlocked, {
      wallet: a.wallet,
      mint: COMMERCE_MINT,
      blocked: true,
    });
    expect(
      await t.query(api.forumCommerce.resolveThreadTokens, { threadId: id }),
    ).toEqual([]);
    expect(
      await t.query(api.forumCommerce.searchTokens, { search: COMMERCE_MINT }),
    ).toEqual([]);
    await expect(
      a.client.action(api.forumCommerce.resolveMint, {
        wallet: a.wallet,
        mint: COMMERCE_MINT,
      }),
    ).rejects.toThrow("unavailable");
  });
  test("saved quotes cannot be prepared twice or bypass an unresolved wallet request; histories are owner-only", async () => {
    const t = setup(),
      a = await actor(t, 71),
      other = await actor(t, 72),
      now = Date.now();
    const q = {
      id: "route",
      provider: "jupiter",
      request: {
        wallet: a.wallet,
        inputMint: "So11111111111111111111111111111111111111112",
        outputMint: COMMERCE_MINT,
        amountRaw: "1000000",
        slippageBps: 50,
        platformFeeBps: 25,
        supportsV1: false,
      },
      swapAmountRaw: "997500",
      platformFeeRaw: "2500",
      outputAmountRaw: "10000",
      minimumOutputAmountRaw: "9950",
      priceImpactBps: 1,
      createdAt: now,
      expiresAt: now + 25000,
      routeLabels: ["test"],
      opaque: {},
    };
    const [saved] = await a.client.mutation(internal.forumSwaps.saveQuotes, {
      wallet: a.wallet,
      quotesJson: JSON.stringify([q]),
    });
    await expect(
      other.client.mutation(internal.forumSwaps.consumeQuote, {
        quoteId: saved.quoteId,
      }),
    ).rejects.toThrow();
    await a.client.mutation(internal.forumSwaps.consumeQuote, {
      quoteId: saved.quoteId,
    });
    await expect(
      a.client.mutation(internal.forumSwaps.consumeQuote, {
        quoteId: saved.quoteId,
      }),
    ).rejects.toThrow("already used");
    await a.client.mutation(internal.forumSwaps.prepared, {
      quoteId: saved.quoteId,
      transactionBase64: "AA==",
      messageHash: "b".repeat(64),
      lastValidBlockHeight: 100,
      estimatedNetworkFeeLamports: "5000",
      simulationSlot: 10,
      transactionVersion: 0,
    });
    await a.client.mutation(api.forumSwaps.beginWalletRequest, {
      quoteId: saved.quoteId,
    });
    await expect(
      a.client.mutation(api.forumSwaps.beginWalletRequest, {
        quoteId: saved.quoteId,
      }),
    ).rejects.toThrow("already started");
    await a.client.mutation(api.forumSwaps.markUnknown, {
      quoteId: saved.quoteId,
    });
    const [fresh] = await a.client.mutation(internal.forumSwaps.saveQuotes, {
      wallet: a.wallet,
      quotesJson: JSON.stringify([q]),
    });
    await expect(
      a.client.mutation(internal.forumSwaps.consumeQuote, {
        quoteId: fresh.quoteId,
      }),
    ).rejects.toThrow("reconciliation");
    const mine = await a.client.query(api.forumSwaps.listMine, {});
    expect(mine).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          quoteId: saved.quoteId,
          status: "held",
          signature: null,
        }),
      ]),
    );
    expect(mine.every((row) => !("transactionBase64" in row))).toBe(true);
    expect(await other.client.query(api.forumSwaps.listMine, {})).toEqual([]);
    const signature = key(71, 64);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ jsonrpc: "2.0", id: 1, result: null })),
    );
    expect(
      await a.client.action(api.forumSwaps.confirm, {
        quoteId: saved.quoteId,
        signature,
      }),
    ).toMatchObject({ status: "held", signature });
    await expect(
      a.client.action(api.forumSwaps.confirm, {
        quoteId: saved.quoteId,
        signature: key(72, 64),
      }),
    ).rejects.toThrow("unresolved");
  });
});
