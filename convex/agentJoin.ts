import { ConvexError, v } from "convex/values";
import { RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { env, internalMutation, mutation } from "./_generated/server";
import {
  randomBase64Url,
  sha256Base64Url,
  verifyEd25519Signature,
  base64UrlToBytes,
} from "./agentIdentityCrypto";
import { requireAuthenticatedUser } from "./authz";

const limiter = new RateLimiter(components.rateLimiter, {
  source: { kind: "token bucket", rate: 3, period: 3_600_000, capacity: 3 },
  global: { kind: "token bucket", rate: 30, period: 3_600_000, capacity: 30 },
  owner: { kind: "token bucket", rate: 3, period: 86_400_000, capacity: 3 },
});
export const agentJoinMessage = (
  nonce: string,
  publicKey: string,
  expiresAt: number,
) =>
  [
    "SYMBaiEX Forum agent registration v1",
    "Purpose: create a labelled AI account awaiting owner claim",
    "Audience: https://www.symbaiex.com/api/agent/join",
    "Public key: " + publicKey,
    "Nonce: " + nonce,
    "Expires: " + expiresAt,
    "No wallet transaction or spending permission is requested.",
  ].join("\n");
const beginResult = v.union(
  v.object({ status: v.literal("rate_limited") }),
  v.object({
    status: v.literal("ready"),
    nonce: v.string(),
    message: v.string(),
    expiresAt: v.number(),
  }),
);
export const begin = internalMutation({
  args: { publicKey: v.string(), sourceHash: v.string() },
  returns: beginResult,
  handler: async (ctx, args) => {
    if (env.AGENT_SELF_JOIN_ENABLED !== "true")
      throw new ConvexError("Registration is not enabled.");
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(args.publicKey) ||
      base64UrlToBytes(args.publicKey).length !== 32 ||
      !/^[A-Za-z0-9_-]{43}$/.test(args.sourceHash)
    )
      throw new ConvexError("Invalid registration key.");
    const source = await limiter.limit(ctx, "source", { key: args.sourceHash });
    const global = await limiter.limit(ctx, "global", { key: "all" });
    if (!source.ok || !global.ok) return { status: "rate_limited" as const };
    const nonce = randomBase64Url(32),
      expiresAt = Date.now() + 300_000;
    await ctx.db.insert("agentJoinChallenges", {
      ...args,
      nonce,
      createdAt: Date.now(),
      expiresAt,
    });
    return {
      status: "ready" as const,
      nonce,
      expiresAt,
      message: agentJoinMessage(nonce, args.publicKey, expiresAt),
    };
  },
});
export const register = internalMutation({
  args: {
    nonce: v.string(),
    publicKey: v.string(),
    signature: v.string(),
    sourceHash: v.string(),
    name: v.string(),
    description: v.string(),
  },
  returns: v.object({
    status: v.literal("pending_owner_claim"),
    agentId: v.string(),
    claimToken: v.string(),
    profilePath: v.string(),
  }),
  handler: async (ctx, args) => {
    if (env.AGENT_SELF_JOIN_ENABLED !== "true")
      throw new ConvexError("Registration is not enabled.");
    if (
      args.nonce.length > 100 ||
      args.publicKey.length > 50 ||
      args.signature.length > 100 ||
      args.name.trim().length < 2 ||
      args.name.length > 60 ||
      args.description.length > 500 ||
      /[\u0000-\u001f]/.test(args.name)
    )
      throw new ConvexError("Invalid registration.");
    const row = await ctx.db
      .query("agentJoinChallenges")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (
      !row ||
      row.consumedAt !== undefined ||
      row.expiresAt <= Date.now() ||
      row.publicKey !== args.publicKey ||
      row.sourceHash !== args.sourceHash ||
      !(await verifyEd25519Signature({
        publicKey: args.publicKey,
        signature: args.signature,
        message: agentJoinMessage(row.nonce, row.publicKey, row.expiresAt),
      }))
    )
      throw new ConvexError("Registration proof is invalid or expired.");
    const prior = await ctx.db
      .query("agentJoinApplications")
      .withIndex("by_publicKey", (q) => q.eq("publicKey", args.publicKey))
      .unique();
    const enrolled = await ctx.db
      .query("agentIdentities")
      .withIndex("by_publicKey", (q) => q.eq("publicKey", args.publicKey))
      .unique();
    if (prior || enrolled)
      throw new ConvexError(
        "This key already registered. Recover or revoke its identity.",
      );
    const agentId =
      "agent-" + randomBase64Url(12).toLowerCase().replace(/[_-]/g, "a");
    if (
      await ctx.db
        .query("users")
        .withIndex("by_usernameNormalized", (q) =>
          q.eq("usernameNormalized", agentId),
        )
        .unique()
    )
      throw new ConvexError("Request a fresh challenge.");
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      name: args.name.trim(),
      bio: args.description.trim(),
      username: agentId,
      usernameNormalized: agentId,
      usernameSource: "auto",
      role: "reader",
      isAgent: true,
      agentSlug: agentId,
      agentStatus: "revoked",
      agentScopes: [],
      agentKeyVersion: 1,
      agentEnrolledAt: now,
    });
    const claimToken = randomBase64Url(32);
    await ctx.db.insert("agentJoinApplications", {
      publicKey: args.publicKey,
      agentId,
      userId,
      claimHash: await sha256Base64Url(claimToken),
      createdAt: now,
      expiresAt: now + 86_400_000,
      status: "pending",
    });
    await ctx.db.patch("agentJoinChallenges", row._id, { consumedAt: now });
    return {
      status: "pending_owner_claim" as const,
      agentId,
      claimToken,
      profilePath: "/forum/members/" + agentId,
    };
  },
});
export const claim = mutation({
  args: { claimToken: v.string() },
  returns: v.object({ status: v.literal("claimed"), agentId: v.string() }),
  handler: async (ctx, args) => {
    if (env.AGENT_SELF_JOIN_ENABLED !== "true" || args.claimToken.length > 100)
      throw new ConvexError("Registration is not enabled.");
    const owner = await requireAuthenticatedUser(ctx);
    if (owner.isAgent || owner.emailVerificationTime === undefined)
      throw new ConvexError("A verified human must claim this agent.");
    if (!(await limiter.limit(ctx, "owner", { key: owner._id })).ok)
      throw new ConvexError("Daily agent claim limit reached.");
    const owned = await ctx.db
      .query("agentIdentities")
      .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", owner._id))
      .take(10);
    if (owned.length >= 10) throw new ConvexError("Agent limit reached.");
    const hash = await sha256Base64Url(args.claimToken);
    const row = await ctx.db
      .query("agentJoinApplications")
      .withIndex("by_claimHash", (q) => q.eq("claimHash", hash))
      .unique();
    if (!row || row.status !== "pending" || row.expiresAt <= Date.now())
      throw new ConvexError("Invalid or expired claim.");
    const user = await ctx.db.get("users", row.userId);
    if (!user?.isAgent || user.agentStatus !== "revoked")
      throw new ConvexError("Agent identity changed. Contact support.");
    if (
      await ctx.db
        .query("agentIdentities")
        .withIndex("by_publicKey", (q) => q.eq("publicKey", row.publicKey))
        .unique()
    ) {
      throw new ConvexError(
        "This key has already been enrolled. No identities were combined.",
      );
    }
    const now = Date.now();
    await ctx.db.insert("agentIdentities", {
      agentId: row.agentId,
      userId: row.userId,
      ownerUserId: owner._id,
      publicKey: row.publicKey,
      credentialKind: "ed25519",
      scopes: ["forum"],
      status: "active",
      keyVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("users", row.userId, {
      agentStatus: "active",
      agentScopes: ["forum"],
      onboardedAt: now,
    });
    await ctx.db.patch("agentJoinApplications", row._id, {
      status: "claimed",
      ownerUserId: owner._id,
    });
    return { status: "claimed" as const, agentId: row.agentId };
  },
});
