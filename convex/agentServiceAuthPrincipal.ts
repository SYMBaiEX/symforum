import type { UserIdentity } from "convex/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { serviceRegistrationAgent } from "./agentServiceAuth";
import {
  SERVICE_AUTH_ISSUER,
  SERVICE_AUTH_TOKEN_ID,
  SERVICE_AUTH_TOKEN_KIND,
} from "../lib/agent-service-auth-config";

/** Convex has already verified the dedicated RS256 signature, MCP audience and expiry. */
export async function resolveServiceAuthAgent(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity,
) {
  if (
    identity.issuer !== SERVICE_AUTH_ISSUER ||
    identity[SERVICE_AUTH_TOKEN_KIND] !== "access"
  )
    return null;
  const jti = identity[SERVICE_AUTH_TOKEN_ID];
  const id = ctx.db.normalizeId("agentServiceRegistrations", identity.subject);
  if (!id || typeof jti !== "string") return null;
  const token = await ctx.db
    .query("agentServiceTokens")
    .withIndex("by_jti", (q) => q.eq("jti", jti))
    .unique();
  if (!token || token.registrationId !== id || token.revokedAt !== undefined)
    return null;
  const registration = await ctx.db.get("agentServiceRegistrations", id);
  if (
    !registration ||
    !registration.approvalExpiresAt ||
    token.expiresAt > registration.approvalExpiresAt
  )
    return null;
  return await serviceRegistrationAgent(ctx, registration);
}
