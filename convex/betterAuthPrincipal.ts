import type { MutationCtx, QueryCtx } from "./_generated/server";
import { env } from "./_generated/server";
import { identityComponent } from "./betterAuthClient";
import { components } from "./_generated/api";
import { IDENTITY_MARKER } from "../lib/identity-config";

/** Both the JWT and its current server-side session must authorize this user. */
export async function betterAuthUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (
    !identity ||
    identity.issuer !== env.CONVEX_SITE_URL ||
    identity.authSystem !== IDENTITY_MARKER ||
    typeof identity.sessionId !== "string"
  )
    return null;
  const authUser = await identityComponent.safeGetAuthUser(ctx);
  if (!authUser) return null;
  const session = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: "session",
    where: [{ field: "_id", value: identity.sessionId }],
  });
  return session?.userId === authUser._id ? authUser : null;
}

export async function resolveBetterAuthUserId(ctx: QueryCtx | MutationCtx) {
  const authUser = await betterAuthUser(ctx);
  if (!authUser) return null;
  const link = await ctx.db
    .query("betterAuthIdentityLinks")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", authUser._id))
    .unique();
  return link?.userId ?? null;
}
