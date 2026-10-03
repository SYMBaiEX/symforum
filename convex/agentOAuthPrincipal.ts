import type { UserIdentity } from "convex/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import {
  WORKOS_GRANT_CLAIM,
  WORKOS_PLUGIN_GRANT_CLAIM,
  WORKOS_PLUGIN_RESOURCE_CLAIM,
  WORKOS_PLUGIN_KIND_CLAIM,
  WORKOS_AGENT_RESOURCE,
} from "../lib/workos-config";

/** Runs only after Convex has verified issuer, RS256 signature, expiry and audience. */
export async function resolveOAuthAgent(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity,
  issuer: string,
) {
  if (identity.issuer !== issuer || !identity.subject) return null;
  // Reject plugin and cross-resource tokens before looking up evidence grants.
  if (
    identity[WORKOS_PLUGIN_GRANT_CLAIM] ||
    identity[WORKOS_PLUGIN_RESOURCE_CLAIM] ||
    identity[WORKOS_PLUGIN_KIND_CLAIM]
  )
    return null;
  const audience = identity.aud;
  if (
    audience !== undefined &&
    audience !== WORKOS_AGENT_RESOURCE &&
    !(
      Array.isArray(audience) &&
      audience.length === 1 &&
      audience[0] === WORKOS_AGENT_RESOURCE
    )
  )
    return null;
  const grantValue = identity[WORKOS_GRANT_CLAIM];
  if (typeof grantValue !== "string") return null;
  const grantId = ctx.db.normalizeId("agentOAuthGrants", grantValue);
  if (!grantId) return null;
  const grant = await ctx.db.get("agentOAuthGrants", grantId);
  if (
    !grant ||
    grant.status !== "active" ||
    grant.issuer !== issuer ||
    grant.subject !== identity.subject ||
    grant.subject !== grant.ownerUserId
  )
    return null;
  // OAuth identity scopes are not SYMBaiEX permissions. The signed consent
  // grant and current database records below authorize evidence access.
  const agent = await ctx.db.get("agentIdentities", grant.agentIdentityId);
  if (
    !agent ||
    agent.status !== "active" ||
    agent.ownerUserId !== grant.ownerUserId ||
    agent.keyVersion !== grant.keyVersion ||
    !agent.scopes.includes("evidence")
  )
    return null;
  const [user, owner] = await Promise.all([
    ctx.db.get("users", agent.userId),
    ctx.db.get("users", grant.ownerUserId),
  ]);
  if (
    !owner ||
    owner.isAgent ||
    !user ||
    user.isAgent !== true ||
    user.agentStatus !== "active" ||
    user.agentKeyVersion !== grant.keyVersion ||
    !user.agentScopes?.includes("evidence")
  )
    return null;
  // An API grant can never inherit owner/admin roles or the agent's posting scopes.
  return {
    ...user,
    role: "reader" as const,
    agentScopes: ["evidence" as const],
  };
}
