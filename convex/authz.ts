import { getAuthUserId } from "@convex-dev/auth/server";
import type { Auth } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { env } from "./_generated/server";
import {
  workosAgentRegistrationConfig,
  workosConfig,
} from "../lib/workos-config";
import { resolveOAuthAgent } from "./agentOAuthPrincipal";
import { resolveWorkOSAgentRegistration } from "./workosAgentRegistrationPrincipal";
import { resolveServiceAuthAgent } from "./agentServiceAuthPrincipal";
import {
  serviceAuthEnabled,
  SERVICE_AUTH_ISSUER,
} from "../lib/agent-service-auth-config";

type DatabaseCtx = QueryCtx | MutationCtx;

export type SiteRole = NonNullable<Doc<"users">["role"]>;

/** Capabilities that can be granted to a hardware-backed agent identity. */
export const AGENT_SCOPES = [
  "forum",
  "newsletter",
  "interactions",
  "comments",
  "evidence",
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

const WORKOS_AUTHKIT_ISSUER = "https://api.workos.com/";

export function isWorkOSAuthKitIdentity(identity: {
  issuer: string;
} | null | undefined) {
  return (
    identity?.issuer === WORKOS_AUTHKIT_ISSUER ||
    identity?.issuer.startsWith(`${WORKOS_AUTHKIT_ISSUER}user_management/`) ===
      true
  );
}

export const agentScopeValidator = v.union(
  v.literal("forum"),
  v.literal("newsletter"),
  v.literal("interactions"),
  v.literal("comments"),
  v.literal("evidence"),
);

/** Whether a user is an enrolled agent whose key has not been revoked. */
export function isActiveAgentUser(
  user: Doc<"users"> | null | undefined,
): user is Doc<"users"> & {
  isAgent: true;
  agentStatus: "active";
  agentScopes: AgentScope[];
} {
  return (
    user?.isAgent === true &&
    user.agentStatus === "active" &&
    Array.isArray(user.agentScopes)
  );
}

export function hasAgentScope(
  user: Doc<"users"> | null | undefined,
  scope: AgentScope,
) {
  return isActiveAgentUser(user) && user.agentScopes.includes(scope);
}

/** Require an active agent identity with the requested explicit capability. */
export function requireAgentScope(
  user: Doc<"users"> | null | undefined,
  scope: AgentScope,
) {
  if (!hasAgentScope(user, scope)) {
    throw new ConvexError({
      code: "AGENT_SCOPE_DENIED",
      message: `An active agent identity with the ${scope} scope is required.`,
    });
  }
  return user;
}

/** Keep human accounts unchanged while constraining enrolled agent accounts. */
export function enforceAgentScopeIfNeeded(
  user: Doc<"users"> | null | undefined,
  scope: AgentScope,
) {
  if (user?.isAgent === true) {
    return requireAgentScope(user, scope);
  }
  return user;
}

export function hasSiteAdminAccess(user: Doc<"users"> | null | undefined) {
  return user?.role === "owner" || user?.role === "admin";
}

/** Only Convex Auth may interpret a token subject as a first-party user ID. */
export async function getFirstPartyAuthUserId(ctx: DatabaseCtx & { auth: Auth }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  if (identity.issuer === env.CONVEX_SITE_URL) {
    return await getAuthUserId(ctx);
  }
  if (!isWorkOSAuthKitIdentity(identity)) return null;
  const link = await ctx.db
    .query("authIdentityLinks")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  return link?.userId ?? null;
}

export async function getCurrentUser(ctx: DatabaseCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.issuer === SERVICE_AUTH_ISSUER) {
    return serviceAuthEnabled(env)
      ? await resolveServiceAuthAgent(ctx, identity)
      : null;
  }
  const workos = workosConfig(env);
  const workosAgentRegistration = workosAgentRegistrationConfig(env);
  const workosResourceIssuer =
    workos?.issuer ?? workosAgentRegistration?.issuer;
  if (identity && workosResourceIssuer === identity.issuer) {
    if (identity.subject.startsWith("agent_reg_")) {
      return workosAgentRegistration
        ? await resolveWorkOSAgentRegistration(
            ctx,
            identity,
            workosAgentRegistration.issuer,
          )
        : null;
    }
    if (workos) {
      return await resolveOAuthAgent(ctx, identity, workos.issuer);
    }
  }
  // Standalone Connect also uses the owner's local ID as its subject. The issuer
  // boundary must hold even when Connect is disabled or its configuration changes.
  const userId = await getFirstPartyAuthUserId(ctx);
  if (userId === null) {
    return null;
  }
  return await ctx.db.get("users", userId);
}

export async function requireAuthenticatedUser(ctx: DatabaseCtx) {
  const user = await getCurrentUser(ctx);
  if (user === null) {
    throw new ConvexError({
      code: "AUTH_REQUIRED",
      message: "Sign in to continue.",
    });
  }
  return user;
}

export async function requireSiteAdmin(ctx: DatabaseCtx) {
  const user = await requireAuthenticatedUser(ctx);
  if (!hasSiteAdminAccess(user)) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Administrator access is required.",
    });
  }
  return user;
}

export async function requireOwner(ctx: DatabaseCtx) {
  const user = await requireAuthenticatedUser(ctx);
  if (user.role !== "owner") {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "Owner access is required.",
    });
  }
  return user;
}
