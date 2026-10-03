import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { getFirstPartyAuthUserId } from "./authz";
import {
  FORUM_PLUGIN_RESOURCE,
  type ForumPluginCapability,
} from "../lib/forum-plugin-contract";
import {
  workosPluginConfig,
  WORKOS_PLUGIN_GRANT_CLAIM,
  WORKOS_PLUGIN_RESOURCE_CLAIM,
  WORKOS_PLUGIN_KIND_CLAIM,
  WORKOS_GRANT_CLAIM,
} from "../lib/workos-config";

export type ForumPluginPrincipal = {
  owner: Doc<"users">;
  actor: Doc<"users">;
  credentialAgent: Doc<"agentIdentities">;
  connection: Doc<"forumPluginConnections">;
  capabilities: ForumPluginCapability[];
  policyVersion: number;
  authMode: "browser" | "oauth";
};
type DatabaseCtx = QueryCtx | MutationCtx;
const verifiedOAuthContext = Symbol("verified-forum-plugin-oauth");
export const verifiedOAuthPrincipalValidator = v.object({
  issuer: v.string(),
  subject: v.string(),
  grantId: v.id("forumPluginConnections"),
});
export type VerifiedOAuthPrincipal = {
  issuer: string;
  subject: string;
  grantId: Id<"forumPluginConnections">;
};
/** Only internal functions receive these claims from the HTTP JWT verifier.
 * Never register a public function accepting verifiedOAuthPrincipal.
 */
export function withVerifiedPluginOAuth<C extends DatabaseCtx>(
  ctx: C,
  principal: VerifiedOAuthPrincipal,
  verifiedResource: typeof FORUM_PLUGIN_RESOURCE,
): C {
  if (verifiedResource !== FORUM_PLUGIN_RESOURCE)
    throw new ConvexError("Invalid verified forum resource.");
  return Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, {
    [verifiedOAuthContext]: true,
    auth: {
      getUserIdentity: async () => ({
        tokenIdentifier: `${principal.issuer}|${principal.subject}`,
        issuer: principal.issuer,
        subject: principal.subject,
        [WORKOS_PLUGIN_GRANT_CLAIM]: principal.grantId,
        [WORKOS_PLUGIN_RESOURCE_CLAIM]: verifiedResource,
        [WORKOS_PLUGIN_KIND_CLAIM]: "forum-plugin",
      }),
    },
  });
}

export type PluginPrincipalOptions = {
  connectionId?: Id<"forumPluginConnections">;
  /** Internal HTTP entrypoints set this only after signature and raw JWT audience verification. */
  verifiedResource?: typeof FORUM_PLUGIN_RESOURCE;
};

export async function requirePluginOwner(ctx: DatabaseCtx) {
  const userId = await getFirstPartyAuthUserId(ctx);
  const owner = userId ? await ctx.db.get("users", userId) : null;
  if (!owner || owner.isAgent)
    throw new ConvexError(
      "Sign in with your human account to manage agent access.",
    );
  return owner;
}

export async function resolvePluginPrincipal(
  ctx: DatabaseCtx,
  options: PluginPrincipalOptions = {},
): Promise<ForumPluginPrincipal | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  let connectionId = options.connectionId;
  let authMode: "browser" | "oauth";
  const ownerId = await getFirstPartyAuthUserId(ctx);
  if (ownerId) {
    if (!connectionId) return null;
    authMode = "browser";
  } else {
    const config = workosPluginConfig(env);
    if (
      !config ||
      identity.issuer !== config.issuer ||
      identity[WORKOS_GRANT_CLAIM]
    )
      return null;
    // Plugin JWTs are verified separately at the HTTP boundary; they are never
    // admitted by Convex's legacy evidence audience provider. The isolated auth
    // facade carries server-owned proof when registered JWT claims are absent.
    if (
      identity[WORKOS_PLUGIN_RESOURCE_CLAIM] !== FORUM_PLUGIN_RESOURCE ||
      identity[WORKOS_PLUGIN_KIND_CLAIM] !== "forum-plugin"
    )
      return null;
    const audience = identity.aud;
    if (
      audience === undefined &&
      (options.verifiedResource !== FORUM_PLUGIN_RESOURCE ||
        !(ctx as DatabaseCtx & { [verifiedOAuthContext]?: boolean })[
          verifiedOAuthContext
        ])
    )
      return null;
    if (
      audience !== undefined &&
      audience !== FORUM_PLUGIN_RESOURCE &&
      !(
        Array.isArray(audience) &&
        audience.length === 1 &&
        audience[0] === FORUM_PLUGIN_RESOURCE
      )
    )
      return null;
    const grantClaim = identity[WORKOS_PLUGIN_GRANT_CLAIM];
    if (typeof grantClaim !== "string") return null;
    const grantId = ctx.db.normalizeId("forumPluginConnections", grantClaim);
    if (!grantId || (connectionId && connectionId !== grantId)) return null;
    connectionId = grantId;
    authMode = "oauth";
  }
  if (!connectionId) return null;
  const connection = await ctx.db.get("forumPluginConnections", connectionId);
  if (
    !connection ||
    connection.kind !== "forum-plugin" ||
    connection.resource !== FORUM_PLUGIN_RESOURCE ||
    connection.status !== "active" ||
    connection.transport !== authMode
  )
    return null;
  if (authMode === "browser" && connection.ownerUserId !== ownerId) return null;
  if (
    authMode === "oauth" &&
    (connection.issuer !== identity.issuer ||
      connection.subject !== identity.subject ||
      connection.subject !== connection.ownerUserId)
  )
    return null;
  const [owner, actor, credentialAgent] = await Promise.all([
    ctx.db.get("users", connection.ownerUserId),
    ctx.db.get("users", connection.actorUserId),
    ctx.db.get("agentIdentities", connection.credentialAgentIdentityId),
  ]);
  if (
    !owner ||
    owner.isAgent ||
    !actor ||
    !credentialAgent ||
    credentialAgent.status !== "active" ||
    credentialAgent.ownerUserId !== owner._id ||
    credentialAgent.keyVersion !== connection.keyVersion ||
    !credentialAgent.scopes.includes("forum")
  )
    return null;
  const credentialUser = await ctx.db.get("users", credentialAgent.userId);
  if (
    !credentialUser ||
    credentialUser.isAgent !== true ||
    credentialUser.agentStatus !== "active" ||
    credentialUser.agentKeyVersion !== connection.keyVersion ||
    !credentialUser.agentScopes?.includes("forum")
  )
    return null;
  if (
    connection.actorMode === "human"
      ? actor._id !== owner._id
      : actor._id !== credentialAgent.userId ||
        !actor.isAgent ||
        actor.agentStatus !== "active"
  )
    return null;
  const capabilities = await effectivePluginCapabilities(
    ctx,
    owner,
    connection.capabilities,
    connection.capabilityCeiling,
  );
  return {
    owner,
    actor,
    credentialAgent,
    connection,
    capabilities,
    policyVersion: connection.policyVersion,
    authMode,
  };
}

export async function requirePluginPrincipal(
  ctx: DatabaseCtx,
  options: PluginPrincipalOptions = {},
) {
  const principal = await resolvePluginPrincipal(ctx, options);
  if (!principal)
    throw new ConvexError({
      code: "PLUGIN_AUTH_REQUIRED",
      message: "Connect an active SYMBaiEX forum profile.",
    });
  return principal;
}
export function requirePluginCapability(
  principal: ForumPluginPrincipal,
  capability: ForumPluginCapability,
) {
  if (!principal.capabilities.includes(capability))
    throw new ConvexError({
      code: "PLUGIN_CAPABILITY_DENIED",
      message: `The connection does not permit ${capability}.`,
    });
}

/** Current owner rights constrain consent; permissions never come from OAuth scopes. */
export async function effectivePluginCapabilities(
  ctx: DatabaseCtx,
  owner: Doc<"users">,
  granted: ForumPluginCapability[],
  ceiling: ForumPluginCapability[],
): Promise<ForumPluginCapability[]> {
  const siteAdmin = owner.role === "owner" || owner.role === "admin";
  const forumAdmin = siteAdmin || owner.forumRole === "admin";
  let canModerate = forumAdmin || owner.forumRole === "moderator";
  if (!canModerate && granted.includes("moderate")) {
    const assignments = await ctx.db
      .query("forumCategoryModerators")
      .withIndex("by_userId", (q) => q.eq("userId", owner._id))
      .take(1);
    canModerate = assignments.length > 0;
  }
  return granted.filter((cap) => {
    if (!ceiling.includes(cap)) return false;
    if (cap === "moderate") return canModerate;
    if (cap === "administer") return forumAdmin;
    if (cap === "accounts") return owner.role === "owner";
    return true;
  });
}
