import { ConvexError, v } from "convex/values";
import { action, internalMutation, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { commerceActor } from "./forumCommerceAccess";
import {
  parseDiscoveredTokens,
  type DiscoveredToken,
} from "../lib/swap-token-discovery";

const token = v.object({
  mint: v.string(),
  symbol: v.string(),
  name: v.string(),
  decimals: v.number(),
  tokenProgram: v.string(),
  icon: v.union(v.string(), v.null()),
  verified: v.boolean(),
});

export const search = action({
  args: { wallet: v.string(), search: v.string() },
  returns: v.array(token),
  handler: async (ctx, args): Promise<DiscoveredToken[]> => {
    const value = args.search.trim();
    if (value.length > 64 || (value.length > 0 && value.length < 2)) return [];
    const key = value ? `search:${value}` : "top:24h";
    const cached = await ctx.runMutation(internal.forumTokenDiscovery.reserve, {
      wallet: args.wallet,
      key,
    });
    if (cached !== null)
      return parseDiscoveredTokens(
        JSON.parse(cached).map((t: DiscoveredToken) => ({
          ...t,
          id: t.mint,
          isVerified: t.verified,
        })),
      );
    try {
      const url = value
        ? `https://api.jup.ag/tokens/v2/search?query=${encodeURIComponent(value)}`
        : "https://api.jup.ag/tokens/v2/toporganicscore/24h?limit=60";
      const response = await fetch(url, {
        headers: env.JUPITER_API_KEY
          ? { "x-api-key": env.JUPITER_API_KEY }
          : {},
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Provider unavailable.");
      const body = await response.text();
      if (body.length > 500000) throw new Error("Response too large.");
      const result = parseDiscoveredTokens(JSON.parse(body));
      await ctx.runMutation(internal.forumTokenDiscovery.save, {
        key,
        payload: JSON.stringify(result),
      });
      return result;
    } catch {
      // Brief negative caching prevents a failing provider being hammered by reopening the modal.
      await ctx.runMutation(internal.forumTokenDiscovery.save, {
        key,
        payload: "[]",
        failed: true,
      });
      throw new ConvexError(
        "Token search is unavailable. Use the listed tokens or an exact mint.",
      );
    }
  },
});
export const reserve = internalMutation({
  args: { wallet: v.string(), key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { wallet, key }) => {
    await commerceActor(ctx, wallet);
    const row = await ctx.db
      .query("forumTokenDiscoveryCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row && row.expiresAt > Date.now()) return row.payload;
    if (row && row.leaseUntil > Date.now())
      throw new ConvexError("Token search is loading. Try again shortly.");
    await ctx.runMutation(internal.forumCommerce.reserveNetwork, {
      wallet,
      cost: 1,
    });
    const next = {
      key,
      payload: "[]",
      expiresAt: 0,
      leaseUntil: Date.now() + 12000,
    };
    if (row) await ctx.db.replace("forumTokenDiscoveryCache", row._id, next);
    else await ctx.db.insert("forumTokenDiscoveryCache", next);
    return null;
  },
});
export const save = internalMutation({
  args: {
    key: v.string(),
    payload: v.string(),
    failed: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { key, payload, failed }) => {
    if (payload.length > 100000) throw new Error("Invalid token cache.");
    const row = await ctx.db
      .query("forumTokenDiscoveryCache")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (row)
      await ctx.db.patch("forumTokenDiscoveryCache", row._id, {
        payload,
        expiresAt: Date.now() + (failed ? 30000 : 300000),
        leaseUntil: 0,
      });
    if (row)
      await ctx.scheduler.runAfter(
        600000,
        internal.forumTokenDiscovery.expire,
        { id: row._id },
      );
    return null;
  },
});
export const expire = internalMutation({
  args: { id: v.id("forumTokenDiscoveryCache") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get("forumTokenDiscoveryCache", id);
    if (row && row.expiresAt <= Date.now() && row.leaseUntil <= Date.now())
      await ctx.db.delete("forumTokenDiscoveryCache", id);
    return null;
  },
});
