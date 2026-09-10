import { ConvexError, v } from "convex/values";
import { internalMutation, mutation, query, env } from "./_generated/server";
import { requireAuthenticatedUser } from "./authz";
import { sha256Base64Url } from "./agentIdentityCrypto";
import { workosConfig } from "../lib/workos-config";

export const listMyConnections = query({
  args: {},
  handler: async (ctx) => {
    const owner = await requireAuthenticatedUser(ctx);
    if (owner.isAgent) throw new ConvexError("A human account is required.");
    const grants = await ctx.db
      .query("agentOAuthGrants")
      .withIndex("by_ownerUserId_and_status", (q) =>
        q.eq("ownerUserId", owner._id).eq("status", "active"),
      )
      .order("desc")
      .take(50);
    return await Promise.all(
      grants.map(async (grant) => {
        const agent = await ctx.db.get(
          "agentIdentities",
          grant.agentIdentityId,
        );
        return {
          id: grant._id,
          agentId: agent?.agentId ?? "Removed agent",
          createdAt: grant.createdAt,
          usable:
            agent?.status === "active" && agent.keyVersion === grant.keyVersion,
        };
      }),
    );
  },
});

export const revokeConnection = mutation({
  args: { grantId: v.id("agentOAuthGrants") },
  handler: async (ctx, { grantId }) => {
    const owner = await requireAuthenticatedUser(ctx);
    const grant = await ctx.db.get("agentOAuthGrants", grantId);
    if (owner.isAgent || !grant || grant.ownerUserId !== owner._id) {
      throw new ConvexError("Connection not found.");
    }
    if (grant.status !== "revoked")
      await ctx.db.patch("agentOAuthGrants", grantId, {
        status: "revoked",
        revokedAt: Date.now(),
      });
    return null;
  },
});

export const prepareConnection = internalMutation({
  args: { agentId: v.string(), externalAuthId: v.string() },
  handler: async (ctx, { agentId, externalAuthId }) => {
    const config = workosConfig(env);
    if (!config || !env.WORKOS_API_KEY)
      throw new ConvexError("OAuth connections are unavailable.");
    if (!/^[A-Za-z0-9_-]{16,160}$/.test(externalAuthId))
      throw new ConvexError("Invalid authorization request.");
    const owner = await requireAuthenticatedUser(ctx);
    if (owner.isAgent) throw new ConvexError("A human account is required.");
    const agent = await ctx.db
      .query("agentIdentities")
      .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
      .unique();
    if (
      !agent ||
      agent.ownerUserId !== owner._id ||
      agent.status !== "active" ||
      !agent.scopes.includes("evidence")
    ) {
      throw new ConvexError(
        "Select an active agent you own with evidence access.",
      );
    }
    const email = owner.contactEmail || owner.email;
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.endsWith(".local")
    ) {
      throw new ConvexError(
        "Add your contact email in your profile before connecting.",
      );
    }
    const externalAuthHash = await sha256Base64Url(externalAuthId);
    if (
      await ctx.db
        .query("agentOAuthGrants")
        .withIndex("by_externalAuthHash", (q) =>
          q.eq("externalAuthHash", externalAuthHash),
        )
        .unique()
    ) {
      throw new ConvexError(
        "This authorization request was already used. Restart from your client.",
      );
    }
    const recent = await ctx.db
      .query("agentOAuthGrants")
      .withIndex("by_ownerUserId_and_createdAt", (q) =>
        q.eq("ownerUserId", owner._id).gt("createdAt", Date.now() - 60_000),
      )
      .take(5);
    const active = await ctx.db
      .query("agentOAuthGrants")
      .withIndex("by_ownerUserId_and_status", (q) =>
        q.eq("ownerUserId", owner._id).eq("status", "active"),
      )
      .take(50);
    if (recent.length >= 5 || active.length >= 50) {
      throw new ConvexError(
        "Connection limit reached. Wait a minute or disconnect an unused application.",
      );
    }
    const grantId = await ctx.db.insert("agentOAuthGrants", {
      ownerUserId: owner._id,
      agentIdentityId: agent._id,
      issuer: config.issuer,
      externalAuthHash,
      keyVersion: agent.keyVersion,
      status: "pending",
      createdAt: Date.now(),
    });
    return { grantId, ownerId: owner._id, email, agentId: agent.agentId };
  },
});

export const finishConnection = internalMutation({
  args: { grantId: v.id("agentOAuthGrants"), subject: v.optional(v.string()) },
  handler: async (ctx, { grantId, subject }) => {
    const owner = await requireAuthenticatedUser(ctx);
    const grant = await ctx.db.get("agentOAuthGrants", grantId);
    if (
      !grant ||
      grant.ownerUserId !== owner._id ||
      owner.isAgent ||
      grant.status !== "pending"
    ) {
      throw new ConvexError("Connection not found.");
    }
    const agent = await ctx.db.get("agentIdentities", grant.agentIdentityId);
    const activeConnections = await ctx.db
      .query("agentOAuthGrants")
      .withIndex("by_ownerUserId_and_status", (q) =>
        q.eq("ownerUserId", owner._id).eq("status", "active"),
      )
      .take(50);
    const active = Boolean(
      subject?.startsWith("user_") &&
      agent?.status === "active" &&
      agent.ownerUserId === owner._id &&
      agent.keyVersion === grant.keyVersion &&
      agent.scopes.includes("evidence") &&
      activeConnections.length < 50 &&
      grant.createdAt > Date.now() - 10 * 60_000,
    );
    await ctx.db.patch(
      "agentOAuthGrants",
      grantId,
      active
        ? {
            subject,
            status: "active",
            activatedAt: Date.now(),
          }
        : { status: "revoked", revokedAt: Date.now() },
    );
    return active;
  },
});
