import type { UserIdentity } from "convex/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { WORKOS_AGENT_RESOURCE } from "../lib/workos-config";

type DatabaseCtx = QueryCtx | MutationCtx;

/** Resolve a WorkOS Agent Registration token to its pre-existing SYMBaiEX agent. */
export async function resolveWorkOSAgentRegistration(
  ctx: DatabaseCtx,
  identity: UserIdentity,
  issuer: string,
) {
  if (
    identity.issuer !== issuer ||
    !/^agent_reg_[A-Za-z0-9]+$/.test(identity.subject)
  )
    return null;

  const audience = identity.aud;
  if (
    audience !== WORKOS_AGENT_RESOURCE &&
    !(
      Array.isArray(audience) &&
      audience.length === 1 &&
      audience[0] === WORKOS_AGENT_RESOURCE
    )
  )
    return null;

  const scope = identity.scope;
  if (
    typeof scope !== "string" ||
    !scope.split(/\s+/).filter(Boolean).includes("evidence")
  )
    return null;

  const actorValue = identity.act;
  if (
    actorValue === null ||
    typeof actorValue !== "object" ||
    Array.isArray(actorValue)
  )
    return null;
  const actorSubject = actorValue.sub;
  if (typeof actorSubject !== "string" || actorSubject.length > 128) return null;

  const link = await ctx.db
    .query("workosAgentRegistrations")
    .withIndex("by_registrationId", (q) =>
      q.eq("registrationId", identity.subject),
    )
    .unique();
  if (
    !link ||
    link.status !== "active" ||
    link.ownerWorkosUserId !== actorSubject
  )
    return null;

  const [owner, agent, workosIdentityLink] = await Promise.all([
    ctx.db.get("users", link.ownerUserId),
    ctx.db.get("agentIdentities", link.agentIdentityId),
    ctx.db
      .query("authIdentityLinks")
      .withIndex("by_workosUserId", (q) =>
        q.eq("workosUserId", actorSubject),
      )
      .unique(),
  ]);
  if (
    !owner ||
    owner.isAgent === true ||
    owner.isAnonymous === true ||
    !workosIdentityLink ||
    workosIdentityLink.userId !== owner._id ||
    !agent ||
    agent.ownerUserId !== owner._id ||
    agent.status !== "active" ||
    !agent.scopes.includes("evidence")
  )
    return null;

  const agentUser: Doc<"users"> | null = await ctx.db.get("users", agent.userId);
  if (
    !agentUser ||
    agentUser.isAgent !== true ||
    agentUser.agentStatus !== "active" ||
    agentUser.agentKeyVersion !== agent.keyVersion ||
    !agentUser.agentScopes?.includes("evidence")
  )
    return null;

  // WorkOS scopes and the owner's local grant are both required. The resulting
  // identity is evidence-only even if the local agent has other capabilities.
  return {
    ...agentUser,
    role: "reader" as const,
    agentScopes: ["evidence" as const],
  };
}
