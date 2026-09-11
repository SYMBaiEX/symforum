import { getFirstPartyAuthUserId as getAuthUserId } from "./authz";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  FORUM_PRESENCE_ROOM,
  forumPresenceComponent,
} from "./forumPresenceComponent";

const MIN_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 5 * 60_000;

export const heartbeat = mutation({
  args: {
    roomId: v.string(),
    userId: v.string(),
    sessionId: v.string(),
    interval: v.number(),
  },
  handler: async (ctx, args) => {
    if (args.roomId !== FORUM_PRESENCE_ROOM) {
      throw new ConvexError({
        code: "INVALID_PRESENCE_ROOM",
        message: "Forum presence is limited to the public forum room.",
      });
    }
    const userId = await getAuthUserId(ctx);
    const user = userId === null ? null : await ctx.db.get("users", userId);
    if (user === null || !isTrustedForumUser(user)) {
      throw new ConvexError({
        code: "FORUM_TRUST_REQUIRED",
        message: "Trusted forum access is required for presence.",
      });
    }
    if (args.userId !== String(user._id)) {
      throw new ConvexError({
        code: "PRESENCE_IDENTITY_MISMATCH",
        message: "Presence identity must match the authenticated account.",
      });
    }
    const interval = Math.max(
      MIN_INTERVAL_MS,
      Math.min(MAX_INTERVAL_MS, Math.floor(args.interval)),
    );
    return await forumPresenceComponent.heartbeat(
      ctx,
      FORUM_PRESENCE_ROOM,
      String(user._id),
      args.sessionId.slice(0, 300),
      interval,
    );
  },
});

export const list = query({
  args: { roomToken: v.string() },
  handler: async (ctx, args) => {
    return await forumPresenceComponent.list(ctx, args.roomToken, 120);
  },
});

export const disconnect = mutation({
  args: { sessionToken: v.string() },
  handler: async (ctx, args) => {
    // Deliberately token-authorized: the React hook also calls this through
    // sendBeacon while the page is unloading and auth may already be gone.
    return await forumPresenceComponent.disconnect(ctx, args.sessionToken);
  },
});

function isTrustedForumUser(user: {
  role?: string;
  forumTrustedAt?: number;
  forumTrustRevokedAt?: number;
  forumBannedAt?: number;
  forumSuspendedUntil?: number;
}) {
  if (user.role === "owner" || user.role === "admin") return true;
  if (user.forumBannedAt !== undefined) return false;
  if (
    user.forumSuspendedUntil !== undefined &&
    user.forumSuspendedUntil > Date.now()
  ) {
    return false;
  }
  return (
    user.forumTrustedAt !== undefined && user.forumTrustRevokedAt === undefined
  );
}
