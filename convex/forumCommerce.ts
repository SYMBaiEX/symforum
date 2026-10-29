import { ConvexError, v } from "convex/values";
import { RateLimiter } from "@convex-dev/rate-limiter";
import {
  action,
  env,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { components, internal } from "./_generated/api";
import { commerceActor, publicCommerceThread } from "./forumCommerceAccess";
import { commerceBenefit, commerceMint } from "./forumCommerceRpc";
import {
  commerceConfig,
  COMMERCE_MINT,
  BENEFIT_TTL_MS,
  isSolanaAddress,
  linkedMintCandidate,
} from "../lib/forum-commerce";

export const commerceLimiter = new RateLimiter(components.rateLimiter, {
  commerceQuoteAdmission: {
    kind: "token bucket",
    rate: 1,
    period: 1200,
    capacity: 1,
  },
  commerceJupiter: { kind: "token bucket", rate: 1, period: 1200, capacity: 1 },
  commerceJupiterKeyless: {
    kind: "token bucket",
    rate: 1,
    period: 2400,
    capacity: 1,
  },
  commerceNetworkDaily: {
    kind: "fixed window",
    rate: 1000,
    period: 86_400_000,
    start: 0,
  },
  commerceActorNetwork: {
    kind: "token bucket",
    rate: 12,
    period: 60_000,
    capacity: 4,
  },
  commerceCheckout: {
    kind: "token bucket",
    rate: 6,
    period: 3_600_000,
    capacity: 2,
  },
});
const benefitValidator = v.object({
  wallet: v.string(),
  eligible: v.boolean(),
  status: v.union(
    v.literal("checking"),
    v.literal("verified"),
    v.literal("unavailable"),
  ),
  balanceRaw: v.string(),
  decimals: v.number(),
  priceUsd: v.union(v.string(), v.null()),
  checkedAt: v.number(),
  expiresAt: v.number(),
});
const tokenValidator = v.object({
  mint: v.string(),
  symbol: v.string(),
  name: v.string(),
  decimals: v.number(),
  tokenProgram: v.string(),
});
export const getConfig = query({
  args: {},
  returns: v.object({
    swapsEnabled: v.boolean(),
    promotionsEnabled: v.boolean(),
    treasury: v.union(v.string(), v.null()),
    platformFeeBps: v.number(),
    promotionAmountRaw: v.string(),
    promotionDurationMs: v.number(),
    promotionBurnBps: v.number(),
    holderThresholdUsd: v.number(),
    holderCacheTtlMs: v.number(),
    maxPromotedPerBoard: v.number(),
    symfMint: v.string(),
  }),
  handler: async () => {
    const c = commerceConfig(env);
    return {
      swapsEnabled: c.swapsEnabled,
      promotionsEnabled: c.promotionsEnabled,
      treasury: c.treasury,
      platformFeeBps: c.platformFeeBps,
      promotionAmountRaw: c.promotionAmountRaw,
      promotionDurationMs: c.promotionDurationMs,
      promotionBurnBps: c.promotionBurnBps,
      holderThresholdUsd: c.holderThresholdUsd,
      holderCacheTtlMs: c.holderCacheTtlMs,
      maxPromotedPerBoard: c.maxPromotedPerBoard,
      symfMint: COMMERCE_MINT,
    };
  },
});
export const authorizeWallet = internalQuery({
  args: { wallet: v.string() },
  returns: v.object({ authUserId: v.string(), userId: v.id("users") }),
  handler: async (ctx, { wallet }) => {
    const { authUserId, userId } = await commerceActor(ctx, wallet);
    return { authUserId, userId };
  },
});
/** Own verified identity only. A browser connection never proves account ownership. */
export const getWalletSession = query({
  args: {},
  returns: v.object({ authUserId: v.string(), wallets: v.array(v.string()) }),
  handler: async (ctx) => {
    const actor = await commerceActor(ctx);
    const accounts = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: "account",
        where: [
          { field: "userId", value: actor.authUserId },
          { field: "providerId", value: "solana" },
        ],
        paginationOpts: { numItems: 50, cursor: null },
      },
    );
    // Fail closed rather than silently choosing from a partial ownership list.
    if (!accounts.isDone)
      throw new ConvexError("Open Account connections to select a wallet.");
    return {
      authUserId: actor.authUserId,
      wallets: accounts.page
        .map((a: { accountId: string }) => a.accountId)
        .filter(isSolanaAddress),
    };
  },
});
export const reserveNetwork = internalMutation({
  args: {
    wallet: v.string(),
    cost: v.number(),
    jupiter: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { wallet, cost, jupiter }) => {
    const actor = await commerceActor(ctx, wallet);
    if (!Number.isSafeInteger(cost) || cost < 1 || cost > 10)
      throw new ConvexError("Invalid request cost.");
    if (jupiter) {
      const gate = await commerceLimiter.limit(
        ctx,
        env.JUPITER_API_KEY ? "commerceJupiter" : "commerceJupiterKeyless",
        {
          key: "shared-key",
        },
      );
      if (!gate.ok)
        throw new ConvexError(
          "Routing is busy within the free-tier limit. Wait a few seconds before trying again.",
        );
    }
    const perActor = await commerceLimiter.limit(ctx, "commerceActorNetwork", {
      key: actor.authUserId,
    });
    const daily = await commerceLimiter.limit(ctx, "commerceNetworkDaily", {
      key: "all",
      count: cost,
    });
    if (!perActor.ok || !daily.ok)
      throw new ConvexError("Free-tier data budget reached. Try later.");
    return null;
  },
});
export const reserveBenefit = internalMutation({
  args: { wallet: v.string(), refresh: v.boolean() },
  returns: v.object({ fetch: v.boolean(), benefit: benefitValidator }),
  handler: async (ctx, { wallet, refresh }) => {
    await commerceActor(ctx, wallet);
    const now = Date.now(),
      old = await ctx.db
        .query("forumWalletBenefits")
        .withIndex("by_wallet", (q) => q.eq("wallet", wallet))
        .unique();
    const view = (r: NonNullable<typeof old>) => ({
      wallet: r.wallet,
      eligible: r.eligible,
      status: r.status,
      balanceRaw: r.balanceRaw,
      decimals: r.decimals,
      priceUsd: r.priceUsd ?? null,
      checkedAt: r.checkedAt,
      expiresAt: r.expiresAt,
    });
    if (
      old &&
      (old.leaseUntil > now ||
        (old.expiresAt > now && (!refresh || now - old.checkedAt < 15_000)))
    )
      return { fetch: false, benefit: view(old) };
    const next = {
      wallet,
      status: "checking" as const,
      balanceRaw: "0",
      decimals: 6,
      eligible: false,
      checkedAt: now,
      expiresAt: now + 15_000,
      leaseUntil: now + 45_000,
    };
    if (old) await ctx.db.replace("forumWalletBenefits", old._id, next);
    else await ctx.db.insert("forumWalletBenefits", next);
    return {
      fetch: true,
      benefit: {
        wallet,
        status: next.status,
        balanceRaw: next.balanceRaw,
        decimals: next.decimals,
        eligible: false,
        checkedAt: now,
        expiresAt: next.expiresAt,
        priceUsd: null,
      },
    };
  },
});
export const saveBenefit = internalMutation({
  args: {
    wallet: v.string(),
    checkedAt: v.number(),
    balanceRaw: v.string(),
    decimals: v.number(),
    priceUsd: v.optional(v.string()),
    eligible: v.boolean(),
    success: v.boolean(),
  },
  returns: benefitValidator,
  handler: async (ctx, args) => {
    await commerceActor(ctx, args.wallet);
    const row = await ctx.db
      .query("forumWalletBenefits")
      .withIndex("by_wallet", (q) => q.eq("wallet", args.wallet))
      .unique();
    if (!row || row.checkedAt !== args.checkedAt)
      throw new ConvexError("Benefit request superseded.");
    const now = Date.now();
    const value = {
      wallet: args.wallet,
      status: args.success ? ("verified" as const) : ("unavailable" as const),
      balanceRaw: args.success ? args.balanceRaw : "0",
      decimals: args.decimals,
      priceUsd: args.success ? args.priceUsd : undefined,
      eligible: args.success && args.eligible,
      checkedAt: now,
      expiresAt: now + (args.success ? BENEFIT_TTL_MS : 15_000),
      leaseUntil: 0,
    };
    await ctx.db.replace("forumWalletBenefits", row._id, value);
    return {
      wallet: value.wallet,
      status: value.status,
      balanceRaw: value.balanceRaw,
      decimals: value.decimals,
      eligible: value.eligible,
      checkedAt: value.checkedAt,
      expiresAt: value.expiresAt,
      priceUsd: value.priceUsd ?? null,
    };
  },
});
export type CommerceBenefit = {
  wallet: string;
  eligible: boolean;
  status: "checking" | "verified" | "unavailable";
  balanceRaw: string;
  decimals: number;
  priceUsd: string | null;
  checkedAt: number;
  expiresAt: number;
};
export async function refreshBenefitForActor(
  ctx: ActionCtx,
  args: { wallet: string; refresh?: boolean },
): Promise<CommerceBenefit> {
  const saved: {
    fetch: boolean;
    benefit: {
      wallet: string;
      eligible: boolean;
      status: "checking" | "verified" | "unavailable";
      balanceRaw: string;
      decimals: number;
      priceUsd: string | null;
      checkedAt: number;
      expiresAt: number;
    };
  } = await ctx.runMutation(internal.forumCommerce.reserveBenefit, {
    wallet: args.wallet,
    refresh: args.refresh === true,
  });
  if (!saved.fetch) return saved.benefit;
  const config = commerceConfig(env);
  let proof: {
      balanceRaw: string;
      decimals: number;
      priceUsd?: string;
      eligible: boolean;
    } = { balanceRaw: "0", decimals: 6, eligible: false },
    success = false;
  try {
    if (!config.rpcUrl) throw new Error("RPC unavailable.");
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet: args.wallet,
      cost: 3,
    });
    proof = await commerceBenefit(config.rpcUrl, args.wallet);
    success = true;
  } catch {
    /* No private provider errors or wallet history are stored. */
  }
  return await ctx.runMutation(internal.forumCommerce.saveBenefit, {
    wallet: args.wallet,
    checkedAt: saved.benefit.checkedAt,
    ...proof,
    success,
  });
}
export const refreshBenefit = action({
  args: { wallet: v.string(), refresh: v.optional(v.boolean()) },
  returns: benefitValidator,
  handler: refreshBenefitForActor,
});

export const builtinTokens = [
  {
    mint: "So11111111111111111111111111111111111111112",
    symbol: "SOL",
    name: "Solana",
    decimals: 9,
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  },
  {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  },
  {
    mint: COMMERCE_MINT,
    symbol: "SYMF",
    name: "SYMBaiEX Forum",
    decimals: 6,
    tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  },
];
type TradeToken = (typeof builtinTokens)[number];
async function mappedMint(
  ctx: QueryCtx,
  threadId: import("./_generated/dataModel").Id<"forumThreads">,
) {
  if (!(await publicCommerceThread(ctx, threadId))) return null;
  const rows = await ctx.db
    .query("tokenAlphaTrackedTokens")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .take(2);
  if (rows.length !== 1 || !isSolanaAddress(rows[0].mint)) return null;
  const blocked = await ctx.db
    .query("forumTradeTokens")
    .withIndex("by_mint", (q) => q.eq("mint", rows[0].mint))
    .unique();
  return blocked?.status === "blocked" ? null : rows[0];
}
export const getThreadMint = query({
  args: { threadId: v.id("forumThreads") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { threadId }) => {
    const mapped = await mappedMint(ctx, threadId);
    if (mapped) return mapped.mint;
    const thread = await publicCommerceThread(ctx, threadId);
    if (!thread) return null;
    const candidate = linkedMintCandidate(`${thread.title}\n${thread.body}`);
    if (!candidate) return null;
    const blocked = await ctx.db
      .query("forumTradeTokens")
      .withIndex("by_mint", (q) => q.eq("mint", candidate))
      .unique();
    return blocked?.status === "blocked" ? null : candidate;
  },
});
export const cachedMint = internalQuery({
  args: { mint: v.string(), now: v.number() },
  returns: v.union(tokenValidator, v.null()),
  handler: async (ctx, { mint, now }) => {
    const blocked = await ctx.db
      .query("forumTradeTokens")
      .withIndex("by_mint", (q) => q.eq("mint", mint))
      .unique();
    if (blocked?.status === "blocked")
      throw new ConvexError("This token is unavailable.");
    const row = await ctx.db
      .query("forumVerifiedMints")
      .withIndex("by_mint", (q) => q.eq("mint", mint))
      .unique();
    return row && row.expiresAt > now
      ? {
          mint: row.mint,
          symbol: row.symbol,
          name: row.name,
          decimals: row.decimals,
          tokenProgram: row.tokenProgram,
        }
      : null;
  },
});
export const saveVerifiedMint = internalMutation({
  args: { wallet: v.string(), token: tokenValidator },
  returns: tokenValidator,
  handler: async (ctx, { wallet, token }) => {
    await commerceActor(ctx, wallet);
    const row = await ctx.db
      .query("forumVerifiedMints")
      .withIndex("by_mint", (q) => q.eq("mint", token.mint))
      .unique();
    const next = {
      ...token,
      verifiedAt: Date.now(),
      expiresAt: Date.now() + 600000,
    };
    const id = row ? row._id : await ctx.db.insert("forumVerifiedMints", next);
    if (row) await ctx.db.replace("forumVerifiedMints", row._id, next);
    await ctx.scheduler.runAfter(
      600000,
      internal.forumCommerce.expireVerifiedMint,
      { id, verifiedAt: next.verifiedAt },
    );
    return token;
  },
});
export const expireVerifiedMint = internalMutation({
  args: { id: v.id("forumVerifiedMints"), verifiedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, verifiedAt }) => {
    const row = await ctx.db.get("forumVerifiedMints", id);
    if (row && row.verifiedAt === verifiedAt && row.expiresAt <= Date.now())
      await ctx.db.delete("forumVerifiedMints", id);
    return null;
  },
});
export const resolveMint = action({
  args: { wallet: v.string(), mint: v.string() },
  returns: tokenValidator,
  handler: async (ctx, { wallet, mint }): Promise<TradeToken> => {
    await ctx.runQuery(internal.forumCommerce.authorizeWallet, { wallet });
    if (!isSolanaAddress(mint)) throw new ConvexError("Invalid mint.");
    const cached = await ctx.runQuery(internal.forumCommerce.cachedMint, {
      mint,
      now: Date.now(),
    });
    if (cached) return cached;
    const builtin = builtinTokens.find((t) => t.mint === mint);
    if (builtin && builtin.symbol === "SOL") return builtin;
    const config = commerceConfig(env);
    if (!config.rpcUrl) throw new ConvexError("Commerce RPC unavailable.");
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet,
      cost: 1,
    });
    try {
      const verified = await commerceMint(config.rpcUrl, mint);
      return await ctx.runMutation(internal.forumCommerce.saveVerifiedMint, {
        wallet,
        token: {
          mint,
          decimals: verified.decimals,
          tokenProgram: verified.tokenProgram,
          symbol:
            builtin?.symbol ??
            (/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(verified.symbol)
              ? verified.symbol
              : mint.slice(0, 6)),
          name:
            builtin?.name ??
            (verified.name.trim() || `${mint.slice(0, 6)}…${mint.slice(-4)}`),
        },
      });
    } catch {
      throw new ConvexError("This token mint could not be safely verified.");
    }
  },
});
export const searchTokens = query({
  args: { search: v.optional(v.string()) },
  returns: v.array(tokenValidator),
  handler: async (ctx, { search }) => {
    const value = (search ?? "").trim();
    if (value.length > 64) return [];
    const symbol = value.replace(/^\$/, " ").trim().toUpperCase();
    if (isSolanaAddress(value)) {
      const exact = await ctx.db
        .query("forumTradeTokens")
        .withIndex("by_mint", (q) => q.eq("mint", value))
        .unique();
      if (exact?.status === "blocked") return [];
      const cached = await ctx.db
        .query("forumVerifiedMints")
        .withIndex("by_mint", (q) => q.eq("mint", value))
        .unique();
      const token =
        builtinTokens.find((t) => t.mint === value) ??
        (exact?.status === "active" ? exact : cached);
      return token
        ? [
            {
              mint: token.mint,
              symbol: token.symbol,
              name: token.name,
              decimals: token.decimals,
              tokenProgram: token.tokenProgram,
            },
          ]
        : [];
    }
    const listed = await ctx.db
      .query("forumTradeTokens")
      .withIndex("by_status_and_symbolNormalized", (q) =>
        q.eq("status", "active"),
      )
      .take(100);
    const builtinAllowed = [];
    for (const token of builtinTokens) {
      const row = await ctx.db
        .query("forumTradeTokens")
        .withIndex("by_mint", (q) => q.eq("mint", token.mint))
        .unique();
      if (row?.status !== "blocked") builtinAllowed.push(token);
    }
    const tokens = [
      ...builtinAllowed,
      ...listed
        .filter((t) => !builtinTokens.some((b) => b.mint === t.mint))
        .map(({ mint, symbol, name, decimals, tokenProgram }) => ({
          mint,
          symbol,
          name,
          decimals,
          tokenProgram,
        })),
    ];
    return tokens
      .filter(
        (t) =>
          !value ||
          t.mint === value ||
          t.symbol.toUpperCase().startsWith(symbol) ||
          t.name.toLowerCase().includes(value.toLowerCase()),
      )
      .slice(0, 20);
  },
});
export const resolveThreadTokens = query({
  args: { threadId: v.id("forumThreads") },
  returns: v.array(tokenValidator),
  handler: async (ctx, { threadId }) => {
    const thread = await publicCommerceThread(ctx, threadId);
    if (!thread) return [];
    const text = `${thread.title}\n${thread.body}`.slice(0, 100_000),
      symbols = [
        ...new Set(
          [...text.matchAll(/\$([A-Za-z][A-Za-z0-9]{0,11})\b/g)].map((m) =>
            m[1].toUpperCase(),
          ),
        ),
      ].slice(0, 8);
    const result: typeof builtinTokens = [];
    const mapped = await mappedMint(ctx, threadId);
    if (mapped) {
      const verified = await ctx.db
        .query("forumVerifiedMints")
        .withIndex("by_mint", (q) => q.eq("mint", mapped.mint))
        .unique();
      if (verified)
        result.push({
          mint: verified.mint,
          symbol: mapped.latestSnapshot?.symbol ?? verified.symbol,
          name: mapped.latestSnapshot?.name ?? verified.name,
          decimals: verified.decimals,
          tokenProgram: verified.tokenProgram,
        });
    }
    for (const symbol of symbols) {
      const builtin = builtinTokens.find((t) => t.symbol === symbol);
      const matches = await ctx.db
        .query("forumTradeTokens")
        .withIndex("by_symbolNormalized_and_status", (q) =>
          q.eq("symbolNormalized", symbol).eq("status", "active"),
        )
        .take(2);
      if (builtin) {
        const state = await ctx.db
          .query("forumTradeTokens")
          .withIndex("by_mint", (q) => q.eq("mint", builtin.mint))
          .unique();
        if (
          state?.status !== "blocked" &&
          matches.every((m) => m.mint === builtin.mint)
        )
          result.push(builtin);
      } else if (matches.length === 1) {
        const { mint, symbol, name, decimals, tokenProgram } = matches[0];
        result.push({ mint, symbol, name, decimals, tokenProgram });
      }
    }
    // An exact curated mint in the post can resolve without a ticker; arbitrary
    // names and unaudited addresses never become purchasable automatically.
    for (const mint of [
      ...new Set(
        [...text.matchAll(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g)].map((m) => m[0]),
      ),
    ].slice(0, 8)) {
      if (result.some((t) => t.mint === mint)) continue;
      const builtin = builtinTokens.find((t) => t.mint === mint);
      const row = await ctx.db
        .query("forumTradeTokens")
        .withIndex("by_mint", (q) => q.eq("mint", mint))
        .unique();
      if (row?.status === "blocked") continue;
      if (builtin) result.push(builtin);
      else if (row?.status === "active") {
        const { mint, symbol, name, decimals, tokenProgram } = row;
        result.push({ mint, symbol, name, decimals, tokenProgram });
      }
    }
    return result.slice(0, 8);
  },
});
export const setTokenBlocked = mutation({
  args: { wallet: v.string(), mint: v.string(), blocked: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await commerceActor(ctx, args.wallet);
    if (!["owner", "admin"].includes(actor.profile.role ?? ""))
      throw new ConvexError("Administrator required.");
    const row = await ctx.db
      .query("forumTradeTokens")
      .withIndex("by_mint", (q) => q.eq("mint", args.mint))
      .unique();
    if (row)
      await ctx.db.patch("forumTradeTokens", row._id, {
        status: args.blocked ? "blocked" : "active",
        updatedAt: Date.now(),
        verifiedBy: actor.userId,
      });
    else {
      const token = builtinTokens.find((t) => t.mint === args.mint);
      if (!token) throw new ConvexError("Bind and verify this token first.");
      await ctx.db.insert("forumTradeTokens", {
        ...token,
        symbolNormalized: token.symbol,
        status: args.blocked ? "blocked" : "active",
        proofUrl: "https://forum.symbaiex.com",
        updatedAt: Date.now(),
        verifiedBy: actor.userId,
      });
    }
    return null;
  },
});
export const bindToken = action({
  args: {
    wallet: v.string(),
    mint: v.string(),
    symbol: v.string(),
    name: v.string(),
    projectHost: v.optional(v.string()),
    proofUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await ctx.runQuery(internal.forumCommerce.authorizeAdmin, {
      wallet: args.wallet,
    });
    if (!isSolanaAddress(args.mint)) throw new ConvexError("Invalid mint.");
    const config = commerceConfig(env);
    if (!config.rpcUrl) throw new ConvexError("Commerce RPC not configured.");
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet: args.wallet,
      cost: 1,
    });
    const mint = await commerceMint(config.rpcUrl, args.mint);
    await ctx.runMutation(internal.forumCommerce.saveToken, {
      ...args,
      decimals: mint.decimals,
      tokenProgram: mint.tokenProgram,
      verifiedBy: actor.userId,
    });
    return null;
  },
});
export const authorizeAdmin = internalQuery({
  args: { wallet: v.string() },
  returns: v.object({ userId: v.id("users") }),
  handler: async (ctx, { wallet }) => {
    const actor = await commerceActor(ctx, wallet);
    if (!["owner", "admin"].includes(actor.profile.role ?? ""))
      throw new ConvexError("Administrator required.");
    return { userId: actor.userId };
  },
});
export const saveToken = internalMutation({
  args: {
    wallet: v.string(),
    mint: v.string(),
    symbol: v.string(),
    name: v.string(),
    projectHost: v.optional(v.string()),
    proofUrl: v.string(),
    decimals: v.number(),
    tokenProgram: v.string(),
    verifiedBy: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await commerceActor(ctx, args.wallet);
    if (
      actor.userId !== args.verifiedBy ||
      !["owner", "admin"].includes(actor.profile.role ?? "")
    )
      throw new ConvexError("Administrator required.");
    const symbol = args.symbol.replace(/^\$/, " ").trim().toUpperCase();
    if (
      !/^[A-Z][A-Z0-9]{0,11}$/.test(symbol) ||
      args.name.trim().length < 1 ||
      args.name.length > 80
    )
      throw new ConvexError("Invalid token metadata.");
    const proof = new URL(args.proofUrl);
    if (
      proof.protocol !== "https:" ||
      proof.username ||
      proof.password ||
      args.proofUrl.length > 500
    )
      throw new ConvexError("An official HTTPS source is required.");
    const projectHost = args.projectHost?.trim().toLowerCase();
    if (projectHost && !/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(projectHost))
      throw new ConvexError("Invalid project host.");
    const old = await ctx.db
      .query("forumTradeTokens")
      .withIndex("by_mint", (q) => q.eq("mint", args.mint))
      .unique();
    const value = {
      mint: args.mint,
      symbol,
      symbolNormalized: symbol,
      name: args.name.trim(),
      decimals: args.decimals,
      tokenProgram: args.tokenProgram,
      projectHost,
      proofUrl: proof.toString(),
      status: "active" as const,
      verifiedBy: actor.userId,
      updatedAt: Date.now(),
    };
    if (old) await ctx.db.replace("forumTradeTokens", old._id, value);
    else await ctx.db.insert("forumTradeTokens", value);
    return null;
  },
});
