import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";

const USERNAME_PATTERN = /^sym-\d{1,8}$|^[a-z0-9][a-z0-9_-]{2,31}$/;

function normalizeUsername(value: string) {
  const usernameNormalized = value.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(usernameNormalized)) {
    throw new Error("Invalid username");
  }
  return usernameNormalized;
}

function publicUserProfile(user: Doc<"users">) {
  return {
    _creationTime: user._creationTime,
    username: user.username ?? user.name ?? "SYM-UNKNOWN",
    usernameNormalized:
      user.usernameNormalized ??
      (user.username ?? user.name ?? "").toLowerCase(),
    bio: user.bio,
    role: user.role,
    usernameSource: user.usernameSource,
    onboardedAt: user.onboardedAt,
  };
}

async function recentComments(ctx: QueryCtx, userId: Id<"users">) {
  const rows = await ctx.db
    .query("comments")
    .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
    .order("desc")
    .take(20);
  return rows
    .filter((comment) => (comment.status ?? "active") === "active")
    .slice(0, 5);
}

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not signed in");
    }
    const user = await ctx.db.get(userId);
    if (user === null) {
      throw new Error("User was deleted");
    }
    return user;
  },
});

export const maybeViewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }
    return await ctx.db.get(userId);
  },
});

export const publicProfile = query({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    let usernameNormalized: string;
    try {
      usernameNormalized = normalizeUsername(args.username);
    } catch {
      return null;
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_usernameNormalized", (q) =>
        q.eq("usernameNormalized", usernameNormalized),
      )
      .unique();

    if (user === null) {
      return null;
    }

    const viewerId = await getAuthUserId(ctx);
    const comments = await recentComments(ctx, user._id);

    return {
      user: publicUserProfile(user),
      isCurrentUser: viewerId === user._id,
      recentComments: comments.map((comment) => ({
        _id: comment._id,
        entityType: comment.entityType,
        entityId: comment.entityId,
        body: comment.body,
        createdAt: comment.createdAt,
      })),
    };
  },
});
