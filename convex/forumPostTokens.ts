import { v } from "convex/values";
import {
  env,
  internalAction,
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { publicCommerceThread } from "./forumCommerceAccess";
import {
  commerceConfig,
  postMintCandidate,
  postHasMintReference,
  isSolanaAddress,
  TOKEN_PROGRAM,
  TOKEN_2022_PROGRAM,
} from "../lib/forum-commerce";
import { commerceMint } from "./forumCommerceRpc";
import { providerFetch } from "./forumProviderFetch";
import { commerceLimiter } from "./forumCommerce";
import { commerceToken } from "./forumCommerceSchema";

export async function postTokenCandidate(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"forumThreads">,
) {
  const thread = await publicCommerceThread(ctx, threadId);
  if (!thread) return null;
  const text = `${thread.title}\n${thread.body}`;
  let mint = postMintCandidate(text);
  if (!mint) {
    // Legacy canonical scout bindings remain authoritative when the post has
    // no explicit competing mint references. Ambiguous new links never choose.
    if (postHasMintReference(text)) return null;
    const mapped = await ctx.db
      .query("tokenAlphaTrackedTokens")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .take(2);
    mint =
      mapped.length === 1 && isSolanaAddress(mapped[0].mint)
        ? mapped[0].mint
        : null;
  }
  if (!mint) return null;
  const blocked = await ctx.db
    .query("forumTradeTokens")
    .withIndex("by_mint", (q) => q.eq("mint", mint))
    .unique();
  return blocked?.status === "blocked" ? null : mint;
}

/** Called by accepted thread writes, never by mounting a visitor's browser. */
export async function queueThreadTokenCheck(
  ctx: MutationCtx,
  threadId: Id<"forumThreads">,
) {
  if (!commerceConfig(env).rpcUrl) return;
  const mint = await postTokenCandidate(ctx, threadId);
  if (!mint) return;
  const old = await ctx.db
    .query("forumPostTokenChecks")
    .withIndex("by_mint", (q) => q.eq("mint", mint))
    .unique();
  if (old && (old.expiresAt > Date.now() || old.leaseUntil > Date.now()))
    return;
  const paced = await commerceLimiter.limit(ctx, "commercePostMintSpacing", {
    key: "public-posts",
    reserve: true,
  });
  if (!paced.ok) return;
  const delay = paced.retryAfter ?? 0;
  const generation = (old?.generation ?? 0) + 1;
  const next = {
    mint,
    threadId,
    generation,
    status: "checking" as const,
    checkedAt: Date.now(),
    expiresAt: 0,
    leaseUntil: Date.now() + delay + 120_000,
    started: false,
    token: undefined,
  };
  if (old) await ctx.db.patch("forumPostTokenChecks", old._id, next);
  else await ctx.db.insert("forumPostTokenChecks", next);
  await ctx.scheduler.runAfter(delay, internal.forumPostTokens.verify, {
    mint,
    generation,
  });
  await ctx.scheduler.runAfter(
    delay + 120_000,
    internal.forumPostTokens.expireCheck,
    { mint, generation },
  );
}

export const expireCheck = internalMutation({
  args: { mint: v.string(), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("forumPostTokenChecks")
      .withIndex("by_mint", (q) => q.eq("mint", args.mint))
      .unique();
    if (
      row?.generation === args.generation &&
      row.status === "checking" &&
      row.leaseUntil <= Date.now()
    )
      await ctx.db.patch("forumPostTokenChecks", row._id, {
        status: "unavailable",
        token: undefined,
        leaseUntil: 0,
        expiresAt: Date.now() + 900_000,
      });
    return null;
  },
});

export const claim = internalMutation({
  args: { mint: v.string(), generation: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("forumPostTokenChecks")
      .withIndex("by_mint", (q) => q.eq("mint", args.mint))
      .unique();
    if (
      !row ||
      row.generation !== args.generation ||
      row.started ||
      row.leaseUntil <= Date.now() ||
      (await postTokenCandidate(ctx, row.threadId)) !== args.mint
    )
      return false;
    // A bounded portion of the shared, provider-metered network allowance.
    if (
      !(
        await commerceLimiter.limit(ctx, "commercePostMintDaily", {
          key: "public-posts",
        })
      ).ok ||
      !(
        await commerceLimiter.limit(ctx, "commerceNetworkDaily", { key: "all" })
      ).ok
    ) {
      await ctx.db.patch("forumPostTokenChecks", row._id, {
        status: "unavailable",
        leaseUntil: 0,
        expiresAt: Date.now() + 3_600_000,
      });
      return false;
    }
    await ctx.db.patch("forumPostTokenChecks", row._id, { started: true });
    return true;
  },
});
export const finish = internalMutation({
  args: {
    mint: v.string(),
    generation: v.number(),
    token: v.optional(commerceToken),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("forumPostTokenChecks")
      .withIndex("by_mint", (q) => q.eq("mint", args.mint))
      .unique();
    if (!row || row.generation !== args.generation || !row.started) return null;
    const allowed = (await postTokenCandidate(ctx, row.threadId)) === args.mint;
    const t = args.token;
    const token =
      allowed &&
      t &&
      t.mint === args.mint &&
      Number.isSafeInteger(t.decimals) &&
      t.decimals >= 0 &&
      t.decimals <= 18 &&
      [TOKEN_PROGRAM, TOKEN_2022_PROGRAM].includes(t.tokenProgram) &&
      t.name.length <= 100 &&
      t.symbol.length <= 12
        ? t
        : undefined;
    await ctx.db.patch("forumPostTokenChecks", row._id, {
      status: token ? "verified" : "unavailable",
      token,
      checkedAt: Date.now(),
      leaseUntil: 0,
      expiresAt: Date.now() + (token ? 3_600_000 : 900_000),
    });
    return null;
  },
});
export const verify = internalAction({
  args: { mint: v.string(), generation: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!(await ctx.runMutation(internal.forumPostTokens.claim, args)))
      return null;
    let token;
    try {
      const url = commerceConfig(env).rpcUrl;
      if (!url) throw Error("RPC unavailable");
      const value = await commerceMint(
        url,
        args.mint,
        providerFetch(ctx, { rpcUrls: [url] }),
      );
      token = {
        mint: args.mint,
        decimals: value.decimals,
        tokenProgram: value.tokenProgram,
        symbol: /^[A-Za-z][A-Za-z0-9]{0,11}$/.test(value.symbol)
          ? value.symbol
          : args.mint.slice(0, 6),
        name:
          value.name.trim() ||
          `${args.mint.slice(0, 6)}…${args.mint.slice(-4)}`,
      };
    } catch {
      /* Unverified tokens never become selectable for swaps. */
    }
    await ctx.runMutation(internal.forumPostTokens.finish, { ...args, token });
    return null;
  },
});
export const status = query({
  args: { threadId: v.id("forumThreads") },
  returns: v.union(
    v.null(),
    v.object({
      mint: v.string(),
      status: v.union(
        v.literal("checking"),
        v.literal("verified"),
        v.literal("unavailable"),
      ),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const mint = await postTokenCandidate(ctx, threadId);
    if (!mint) return null;
    const row = await ctx.db
      .query("forumPostTokenChecks")
      .withIndex("by_mint", (q) => q.eq("mint", mint))
      .unique();
    return { mint, status: row?.status ?? ("checking" as const) };
  },
});
/** One bounded operator page for existing public posts, no model or transaction. */
export const backfillRecent = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("forumThreads")
      .withIndex("by_status_and_lastPostAt", (q) => q.eq("status", "active"))
      .order("desc")
      .take(100);
    for (const row of rows) await queueThreadTokenCheck(ctx, row._id);
    return rows.length;
  },
});
