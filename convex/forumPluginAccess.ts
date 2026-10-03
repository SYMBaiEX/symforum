import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  env,
  type MutationCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { createOAuthOnlyAgent } from "./agentIdentity";
import { sha256Base64Url } from "./agentIdentityCrypto";
import {
  requirePluginOwner,
  resolvePluginPrincipal,
} from "./forumPluginPrincipal";
import {
  pluginCapabilityValidator,
  pluginConnectionOptions,
} from "./forumPluginSchema";
import {
  FORUM_PLUGIN_RESOURCE,
  type ForumPluginCapability,
} from "../lib/forum-plugin-contract";
import { workosPluginConfig } from "../lib/workos-config";

const actingAsValidator = v.object({
  userId: v.id("users"),
  username: v.string(),
  isAgent: v.boolean(),
});
const projectionValidator = schema.doc("forumPluginConnections").extend({
  actingAs: actingAsValidator,
  credentialAgentId: v.string(),
});
function projection(
  connection: Doc<"forumPluginConnections">,
  actor: Doc<"users"> | null,
  credential: Doc<"agentIdentities"> | null,
) {
  return {
    ...connection,
    actingAs: {
      userId: connection.actorUserId,
      username: actor?.username ?? actor?.name ?? "Removed profile",
      isAgent: actor?.isAgent === true,
    },
    credentialAgentId: credential?.agentId ?? "Removed agent",
  };
}
function normalizeCapabilities(capabilities: ForumPluginCapability[]) {
  const unique = [...new Set(capabilities)];
  if (unique.length !== capabilities.length || !unique.includes("read"))
    throw new ConvexError(
      "Choose unique capabilities including forum browsing.",
    );
  return unique;
}
async function selectCredential(
  ctx: MutationCtx,
  owner: Doc<"users">,
  agentId?: string,
) {
  const credential =
    agentId === undefined
      ? await createOAuthOnlyAgent(ctx, owner)
      : await ctx.db
          .query("agentIdentities")
          .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
          .unique();
  const user = credential ? await ctx.db.get("users", credential.userId) : null;
  if (
    !credential ||
    credential.ownerUserId !== owner._id ||
    credential.status !== "active" ||
    !credential.scopes.includes("forum") ||
    !user?.isAgent ||
    user.agentStatus !== "active" ||
    user.agentKeyVersion !== credential.keyVersion ||
    !user.agentScopes?.includes("forum")
  )
    throw new ConvexError("Select an active forum agent profile you own.");
  return credential;
}
async function checkConnectionLimits(ctx: MutationCtx, owner: Doc<"users">) {
  const [active, recent] = await Promise.all([
    ctx.db
      .query("forumPluginConnections")
      .withIndex("by_ownerUserId_and_status", (q) =>
        q.eq("ownerUserId", owner._id).eq("status", "active"),
      )
      .take(50),
    ctx.db
      .query("forumPluginConnections")
      .withIndex("by_ownerUserId_and_createdAt", (q) =>
        q.eq("ownerUserId", owner._id).gt("createdAt", Date.now() - 60_000),
      )
      .take(5),
  ]);
  if (active.length >= 50 || recent.length >= 5)
    throw new ConvexError(
      "Connection limit reached. Wait a minute or disconnect an unused application.",
    );
}
export const listMyAgents = query({
  args: {},
  returns: v.array(
    v.object({
      agentId: v.string(),
      userId: v.id("users"),
      status: v.union(v.literal("active"), v.literal("revoked")),
      credentialKind: v.union(v.literal("oauth"), v.literal("ed25519")),
    }),
  ),
  handler: async (ctx) => {
    const owner = await requirePluginOwner(ctx);
    const agents = await ctx.db
      .query("agentIdentities")
      .withIndex("by_ownerUserId", (q) => q.eq("ownerUserId", owner._id))
      .take(50);
    return agents
      .filter((agent) => agent.scopes.includes("forum"))
      .map((agent) => ({
        agentId: agent.agentId,
        userId: agent.userId,
        status: agent.status,
        credentialKind: agent.credentialKind ?? "ed25519",
      }));
  },
});
export const listMyConnections = query({
  args: {},
  returns: v.array(projectionValidator),
  handler: async (ctx) => {
    const owner = await requirePluginOwner(ctx);
    const connections = await ctx.db
      .query("forumPluginConnections")
      .withIndex("by_ownerUserId_and_createdAt", (q) =>
        q.eq("ownerUserId", owner._id),
      )
      .order("desc")
      .take(50);
    return await Promise.all(
      connections.map(async (connection) =>
        projection(
          connection,
          await ctx.db.get("users", connection.actorUserId),
          await ctx.db.get(
            "agentIdentities",
            connection.credentialAgentIdentityId,
          ),
        ),
      ),
    );
  },
});
export const createBrowserConnection = mutation({
  args: pluginConnectionOptions,
  returns: v.object({ connectionId: v.id("forumPluginConnections") }),
  handler: async (ctx, args) => {
    const owner = await requirePluginOwner(ctx);
    await checkConnectionLimits(ctx, owner);
    const capabilities = normalizeCapabilities(args.capabilities);
    const credential = await selectCredential(ctx, owner, args.agentId);
    const now = Date.now();
    const connectionId = await ctx.db.insert("forumPluginConnections", {
      ownerUserId: owner._id,
      credentialAgentIdentityId: credential._id,
      actorUserId: args.actorMode === "human" ? owner._id : credential.userId,
      actorMode: args.actorMode,
      transport: "browser",
      kind: "forum-plugin",
      resource: FORUM_PLUGIN_RESOURCE,
      issuer: env.CONVEX_SITE_URL,
      subject: owner._id,
      keyVersion: credential.keyVersion,
      capabilities,
      capabilityCeiling: capabilities,
      executionMode: args.executionMode,
      policyVersion: 1,
      status: "active",
      createdAt: now,
      updatedAt: now,
      activatedAt: now,
    });
    return { connectionId };
  },
});
export const updateConnection = mutation({
  args: {
    connectionId: v.id("forumPluginConnections"),
    ...v.object(pluginConnectionOptions).partial().fields,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const owner = await requirePluginOwner(ctx);
    const connection = await ctx.db.get(
      "forumPluginConnections",
      args.connectionId,
    );
    if (
      !connection ||
      connection.ownerUserId !== owner._id ||
      connection.status !== "active"
    )
      throw new ConvexError("Connection not found.");
    const capabilities = args.capabilities
      ? normalizeCapabilities(args.capabilities)
      : connection.capabilities;
    if (capabilities.some((cap) => !connection.capabilityCeiling.includes(cap)))
      throw new ConvexError(
        "Expanded access requires renewed consent. Create a new connection.",
      );
    const credential = args.agentId
      ? await selectCredential(ctx, owner, args.agentId)
      : await ctx.db.get(
          "agentIdentities",
          connection.credentialAgentIdentityId,
        );
    if (
      !credential ||
      credential.status !== "active" ||
      credential.ownerUserId !== owner._id ||
      !credential.scopes.includes("forum")
    )
      throw new ConvexError("Select an active forum agent profile you own.");
    if (
      credential._id === connection.credentialAgentIdentityId &&
      credential.keyVersion !== connection.keyVersion
    )
      throw new ConvexError(
        "The credential changed. Create a new connection with renewed consent.",
      );
    const actorMode = args.actorMode ?? connection.actorMode;
    // A fixed OAuth grant remains bound to its credential; changing it requires renewed consent.
    if (
      connection.transport === "oauth" &&
      credential._id !== connection.credentialAgentIdentityId
    )
      throw new ConvexError(
        "Changing the OAuth credential requires renewed consent.",
      );
    await ctx.db.patch("forumPluginConnections", connection._id, {
      capabilities,
      actorMode,
      actorUserId: actorMode === "human" ? owner._id : credential.userId,
      credentialAgentIdentityId: credential._id,
      keyVersion: credential.keyVersion,
      executionMode: args.executionMode ?? connection.executionMode,
      policyVersion: connection.policyVersion + 1,
      updatedAt: Date.now(),
    });
    // Outstanding proposals are invalidated by their immutable policyVersion;
    // approval rechecks this rather than rewriting an unbounded proposal queue.
    return null;
  },
});
export const revokeConnection = mutation({
  args: { connectionId: v.id("forumPluginConnections") },
  returns: v.null(),
  handler: async (ctx, { connectionId }) => {
    const owner = await requirePluginOwner(ctx);
    const connection = await ctx.db.get("forumPluginConnections", connectionId);
    if (!connection || connection.ownerUserId !== owner._id)
      throw new ConvexError("Connection not found.");
    if (connection.status !== "revoked")
      await ctx.db.patch("forumPluginConnections", connectionId, {
        status: "revoked",
        revokedAt: Date.now(),
        updatedAt: Date.now(),
        policyVersion: connection.policyVersion + 1,
      });
    return null;
  },
});
export const getBrowserContext = query({
  args: { connectionId: v.id("forumPluginConnections") },
  returns: v.union(
    v.object({
      connectionId: v.id("forumPluginConnections"),
      actorMode: pluginConnectionOptions.actorMode,
      actingAs: actingAsValidator,
      capabilities: v.array(pluginCapabilityValidator),
      capabilityCeiling: v.array(pluginCapabilityValidator),
      executionMode: pluginConnectionOptions.executionMode,
      policyVersion: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await requirePluginOwner(ctx);
    const principal = await resolvePluginPrincipal(ctx, args);
    if (!principal || principal.authMode !== "browser") return null;
    return {
      connectionId: principal.connection._id,
      actorMode: principal.connection.actorMode,
      actingAs: projection(
        principal.connection,
        principal.actor,
        principal.credentialAgent,
      ).actingAs,
      capabilities: principal.capabilities,
      capabilityCeiling: principal.connection.capabilityCeiling,
      executionMode: principal.connection.executionMode,
      policyVersion: principal.policyVersion,
    };
  },
});
export const prepareConnection = internalMutation({
  args: { externalAuthId: v.string(), ...pluginConnectionOptions },
  returns: v.object({
    grantId: v.id("forumPluginConnections"),
    ownerId: v.id("users"),
    email: v.string(),
    actorLabel: v.string(),
  }),
  handler: async (ctx, args) => {
    const owner = await requirePluginOwner(ctx);
    const config = workosPluginConfig(env);
    if (!config || !env.WORKOS_API_KEY)
      throw new ConvexError("OAuth connections are unavailable.");
    if (!/^[A-Za-z0-9_-]{16,160}$/.test(args.externalAuthId))
      throw new ConvexError("Invalid authorization request.");
    const email = owner.contactEmail || owner.email;
    if (
      !email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.endsWith(".local")
    )
      throw new ConvexError("Add a contact email before connecting.");
    const externalAuthHash = await sha256Base64Url(args.externalAuthId);
    if (
      await ctx.db
        .query("forumPluginConnections")
        .withIndex("by_externalAuthHash", (q) =>
          q.eq("externalAuthHash", externalAuthHash),
        )
        .unique()
    )
      throw new ConvexError(
        "This authorization request was already used. Restart from your client.",
      );
    await checkConnectionLimits(ctx, owner);
    const capabilities = normalizeCapabilities(args.capabilities);
    const credential = await selectCredential(ctx, owner, args.agentId);
    const now = Date.now();
    const grantId = await ctx.db.insert("forumPluginConnections", {
      ownerUserId: owner._id,
      credentialAgentIdentityId: credential._id,
      actorUserId: args.actorMode === "human" ? owner._id : credential.userId,
      actorMode: args.actorMode,
      transport: "oauth",
      kind: "forum-plugin",
      resource: FORUM_PLUGIN_RESOURCE,
      issuer: config.issuer,
      externalAuthHash,
      keyVersion: credential.keyVersion,
      capabilities,
      capabilityCeiling: capabilities,
      executionMode: args.executionMode,
      policyVersion: 1,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return {
      grantId,
      ownerId: owner._id,
      email,
      actorLabel:
        args.actorMode === "human"
          ? (owner.username ?? owner.name ?? "Your profile")
          : credential.agentId,
    };
  },
});
export const finishConnection = internalMutation({
  args: {
    grantId: v.id("forumPluginConnections"),
    subject: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const owner = await requirePluginOwner(ctx);
    const connection = await ctx.db.get("forumPluginConnections", args.grantId);
    if (
      !connection ||
      connection.ownerUserId !== owner._id ||
      connection.status !== "pending"
    )
      throw new ConvexError("Connection not found.");
    const credential = await ctx.db.get(
      "agentIdentities",
      connection.credentialAgentIdentityId,
    );
    const credentialUser = credential
      ? await ctx.db.get("users", credential.userId)
      : null;
    const activeConnections = await ctx.db
      .query("forumPluginConnections")
      .withIndex("by_ownerUserId_and_status", (q) =>
        q.eq("ownerUserId", owner._id).eq("status", "active"),
      )
      .take(50);
    const config = workosPluginConfig(env);
    const active = Boolean(
      config?.issuer === connection.issuer &&
      activeConnections.length < 50 &&
      credentialUser?.isAgent &&
      credentialUser.agentStatus === "active" &&
      credentialUser.agentKeyVersion === connection.keyVersion &&
      credentialUser.agentScopes?.includes("forum") &&
      args.subject === owner._id &&
      credential?.status === "active" &&
      credential.ownerUserId === owner._id &&
      credential.keyVersion === connection.keyVersion &&
      credential.scopes.includes("forum") &&
      connection.createdAt > Date.now() - 10 * 60_000,
    );
    const now = Date.now();
    await ctx.db.patch(
      "forumPluginConnections",
      connection._id,
      active
        ? {
            subject: args.subject,
            status: "active",
            activatedAt: now,
            updatedAt: now,
          }
        : { status: "revoked", revokedAt: now, updatedAt: now },
    );
    return active;
  },
});
