import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

type DatabaseCtx = QueryCtx | MutationCtx;

export type SiteRole = NonNullable<Doc<"users">["role"]>;

export function hasSiteAdminAccess(user: Doc<"users"> | null | undefined) {
  return user?.role === "owner" || user?.role === "admin";
}

export async function getCurrentUser(ctx: DatabaseCtx) {
  const userId = await getAuthUserId(ctx);
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
