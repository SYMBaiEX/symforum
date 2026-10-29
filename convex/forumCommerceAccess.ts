import { ConvexError } from "convex/values";
import { components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { betterAuthUser } from "./betterAuthPrincipal";
import { isSolanaAddress } from "../lib/forum-commerce";

export async function commerceActor(
  ctx: QueryCtx | MutationCtx,
  wallet?: string,
) {
  const native = await betterAuthUser(ctx);
  if (!native) throw new ConvexError("Sign in to continue.");
  const mapping = await ctx.db
    .query("betterAuthIdentityLinks")
    .withIndex("by_authUserId", (q) => q.eq("authUserId", native._id))
    .unique();
  const profile = mapping ? await ctx.db.get("users", mapping.userId) : null;
  if (
    !profile ||
    profile.isAgent === true ||
    profile.forumBannedAt !== undefined ||
    // Read-only ownership queries need no clock. Every spending/network write
    // rechecks suspension in its mutation, where wall-clock reads are safe.
    ("scheduler" in ctx && (profile.forumSuspendedUntil ?? 0) > Date.now())
  )
    throw new ConvexError("This account cannot use commerce.");
  if (wallet !== undefined) {
    if (!isSolanaAddress(wallet))
      throw new ConvexError("Invalid wallet address.");
    const accounts = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: "account",
        where: [
          { field: "userId", value: native._id },
          { field: "providerId", value: "solana" },
          { field: "accountId", value: wallet },
        ],
        paginationOpts: { numItems: 2, cursor: null },
      },
    );
    if (
      !accounts.isDone ||
      accounts.page.length !== 1 ||
      accounts.page[0].accountId !== wallet
    )
      throw new ConvexError(
        "Link and verify this wallet in Account connections first.",
      );
  }
  return { authUserId: native._id, userId: profile._id, profile };
}

/** Promotion inventory is public only: no member/staff boards or private ancestors. */
export async function publicCommerceThread(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"forumThreads">,
) {
  const thread = await ctx.db.get("forumThreads", threadId);
  if (!thread || thread.status !== "active") return null;
  let categoryId: Id<"forumCategories"> | undefined = thread.categoryId;
  const seen = new Set<string>();
  for (let depth = 0; categoryId && depth < 8; depth++) {
    if (seen.has(categoryId)) return null;
    seen.add(categoryId);
    const category: Doc<"forumCategories"> | null = await ctx.db.get(
      "forumCategories",
      categoryId,
    );
    if (
      !category ||
      category.status !== "active" ||
      (category.viewAccess !== undefined && category.viewAccess !== "public")
    )
      return null;
    if (depth === 0 && category.kind === "section") return null;
    categoryId = category.parentCategoryId;
  }
  return categoryId ? null : thread;
}
