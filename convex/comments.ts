import { getFirstPartyAuthUserId as getAuthUserId } from "./authz";
import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requirePublicEntity } from "./contentAccess";
import { enforceAgentScopeIfNeeded } from "./authz";
import { consumeAgentQuotaIfNeeded } from "./agentQuota";
import { components } from "./_generated/api";
import {
  insertCommentAggregate,
  replaceCommentAggregate,
} from "./contentAggregates";

const entityType = v.union(
  v.literal("post"),
  v.literal("hnStory"),
  v.literal("portfolioProject"),
);

const COMMENT_LIMIT = 500;
const COMMENT_MIN_LENGTH = 2;
const COMMENT_MAX_LENGTH = 1200;
const RATE_LIMIT_MS = 2_500;
const DUPLICATE_WINDOW_MS = 15_000;
const commentRateLimiter = new RateLimiter(components.rateLimiter, {
  commentsPerAccount: {
    kind: "token bucket",
    rate: 10,
    period: HOUR,
    capacity: 5,
  },
  commentsGlobal: {
    kind: "token bucket",
    rate: 120,
    period: HOUR,
    capacity: 30,
    shards: 6,
  },
});
type CommentStatus = NonNullable<Doc<"comments">["status"]>;
type UserDoc = Doc<"users">;

export const list = query({
  args: {
    entityType,
    entityId: v.string(),
  },
  returns: v.array(
    v.object({
      _id: v.id("comments"),
      _creationTime: v.number(),
      userId: v.id("users"),
      entityType,
      entityId: v.string(),
      parentId: v.optional(v.id("comments")),
      body: v.string(),
      status: v.union(
        v.literal("active"),
        v.literal("deleted"),
        v.literal("hidden"),
      ),
      updatedAt: v.number(),
      deletedAt: v.optional(v.number()),
      createdAt: v.number(),
      author: v.string(),
      viewerCanDelete: v.boolean(),
      viewerCanModerate: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    await requirePublicEntity(ctx, args.entityType, args.entityId);

    const rows = await ctx.db
      .query("comments")
      .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
        q.eq("entityType", args.entityType).eq("entityId", args.entityId),
      )
      .order("asc")
      .take(COMMENT_LIMIT);
    const viewerId = await getAuthUserId(ctx);
    const userIds = uniqueCommentUserIds(
      rows.map((comment) => comment.userId),
      viewerId,
    );
    const usersById = new Map(
      await Promise.all(
        userIds.map(
          async (userId) =>
            [userId, await ctx.db.get("users", userId)] as const,
        ),
      ),
    );
    const viewer = viewerId === null ? null : usersById.get(viewerId);
    const viewerCanModerate = canModerate(viewer);

    return rows.map((comment) => {
      const status = commentStatus(comment);
      const isVisible = status === "active";
      const user = usersById.get(comment.userId);
      return {
        _id: comment._id,
        _creationTime: comment._creationTime,
        userId: comment.userId,
        entityType: comment.entityType,
        entityId: comment.entityId,
        parentId: comment.parentId,
        body: isVisible ? comment.body : "",
        status,
        updatedAt: comment.updatedAt ?? comment.createdAt,
        deletedAt: comment.deletedAt,
        createdAt: comment.createdAt,
        author: isVisible
          ? (user?.username ?? user?.name ?? "SYM-UNKNOWN")
          : "Deleted",
        viewerCanDelete:
          isVisible &&
          (viewerCanModerate ||
            (viewerId !== null && comment.userId === viewerId)),
        viewerCanModerate,
      };
    });
  },
});

export const add = mutation({
  args: {
    entityType,
    entityId: v.string(),
    parentId: v.optional(v.id("comments")),
    body: v.string(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireSignedInUserId(ctx);
    const user = await ctx.db.get("users", userId);
    const [accountCapacity, globalCapacity] = await Promise.all([
      commentRateLimiter.limit(ctx, "commentsPerAccount", { key: userId }),
      commentRateLimiter.limit(ctx, "commentsGlobal", { key: "global" }),
    ]);
    if (!accountCapacity.ok || !globalCapacity.ok) {
      throw new ConvexError({
        code: "COMMENT_RATE_LIMITED",
        message: "Commenting is temporarily rate limited. Please try later.",
        retryAfter: Math.max(
          accountCapacity.ok ? 0 : accountCapacity.retryAfter,
          globalCapacity.ok ? 0 : globalCapacity.retryAfter,
        ),
      });
    }
    await requirePublicEntity(ctx, args.entityType, args.entityId);

    const body = args.body.trim();
    if (body.length < COMMENT_MIN_LENGTH || body.length > COMMENT_MAX_LENGTH) {
      throw new ConvexError({
        code: "INVALID_COMMENT",
        message: `Comment must be between ${COMMENT_MIN_LENGTH} and ${COMMENT_MAX_LENGTH} characters.`,
      });
    }

    let parentId: Id<"comments"> | undefined;
    if (args.parentId !== undefined) {
      const parent = await ctx.db.get("comments", args.parentId);
      if (
        parent === null ||
        parent.entityType !== args.entityType ||
        parent.entityId !== args.entityId ||
        commentStatus(parent) !== "active"
      ) {
        throw new ConvexError({
          code: "INVALID_REPLY_TARGET",
          message: "That reply target is no longer available.",
        });
      }
      parentId = args.parentId;
    }

    const recent = await ctx.db
      .query("comments")
      .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId))
      .order("desc")
      .take(5);
    const now = Date.now();
    const lastComment = recent[0];
    if (
      lastComment !== undefined &&
      now - lastComment.createdAt < RATE_LIMIT_MS
    ) {
      throw new ConvexError({
        code: "COMMENT_RATE_LIMITED",
        message: "Give the thread a breath, then try again.",
      });
    }
    const duplicate = recent.find(
      (comment) =>
        commentStatus(comment) === "active" &&
        comment.entityType === args.entityType &&
        comment.entityId === args.entityId &&
        comment.body.trim() === body &&
        now - comment.createdAt < DUPLICATE_WINDOW_MS,
    );
    if (duplicate !== undefined) {
      throw new ConvexError({
        code: "DUPLICATE_COMMENT",
        message: "That comment already landed.",
      });
    }

    await consumeAgentQuotaIfNeeded(ctx, user, {
      operation: "comments.add",
      idempotencyKey: args.idempotencyKey,
    });

    const commentId = await ctx.db.insert("comments", {
      userId,
      entityType: args.entityType,
      entityId: args.entityId,
      ...(parentId !== undefined ? { parentId } : {}),
      body,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const inserted = await ctx.db.get("comments", commentId);
    if (inserted !== null) await insertCommentAggregate(ctx, inserted);
  },
});

export const softDelete = mutation({
  args: {
    commentId: v.id("comments"),
  },
  handler: async (ctx, args) => {
    const userId = await requireSignedInUserId(ctx);
    const user = await ctx.db.get("users", userId);
    if (user === null) {
      throw new ConvexError({
        code: "AUTH_REQUIRED",
        message: "Sign in with a SYM handle to manage the thread.",
      });
    }

    const comment = await ctx.db.get("comments", args.commentId);
    if (comment === null) {
      return { deleted: false };
    }
    const moderator = canModerate(user);
    if (!moderator && comment.userId !== userId) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "You can only delete your own comments.",
      });
    }
    if (commentStatus(comment) === "deleted") {
      return { deleted: true };
    }

    const now = Date.now();
    await ctx.db.patch("comments", comment._id, {
      body: "",
      status: "deleted",
      updatedAt: now,
      deletedAt: now,
      deletedBy: userId,
      moderationReason: moderator ? "admin_delete" : "author_delete",
    });
    const updated = await ctx.db.get("comments", comment._id);
    if (updated !== null) {
      await replaceCommentAggregate(ctx, comment, updated);
    }
    await recordModerationLog(ctx, {
      actorUserId: userId,
      comment,
      eventType: moderator ? "comment_admin_deleted" : "comment_author_deleted",
      message: moderator
        ? "Comment soft-deleted by moderator"
        : "Comment soft-deleted by author",
      now,
    });

    return { deleted: true };
  },
});

async function requireSignedInUserId(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError({
      code: "AUTH_REQUIRED",
      message: "Sign in with a SYM handle to join the thread.",
    });
  }
  const user = await ctx.db.get("users", userId);
  enforceAgentScopeIfNeeded(user, "comments");
  return userId;
}

function commentStatus(
  comment: Pick<Doc<"comments">, "status">,
): CommentStatus {
  return comment.status ?? "active";
}

function canModerate(user: UserDoc | null | undefined) {
  return user?.role === "owner" || user?.role === "admin";
}

export function uniqueCommentUserIds(
  commentUserIds: readonly Id<"users">[],
  viewerId: Id<"users"> | null,
) {
  const userIds = new Set(commentUserIds);
  if (viewerId !== null) {
    userIds.add(viewerId);
  }
  return [...userIds];
}

async function recordModerationLog(
  ctx: MutationCtx,
  args: {
    actorUserId: Id<"users">;
    comment: Doc<"comments">;
    eventType: string;
    message: string;
    now: number;
  },
) {
  await ctx.db.insert("systemLogs", {
    createdAt: args.now,
    updatedAt: args.now,
    lastSeenAt: args.now,
    occurrences: 1,
    level: "info",
    status: "open",
    source: "convex",
    scope: "comments",
    eventType: args.eventType,
    message: args.message,
    fingerprint: `${args.eventType}:${args.comment._id}`,
    actorUserId: args.actorUserId,
    entityType: args.comment.entityType,
    entityId: args.comment.entityId,
    metadataJson: JSON.stringify({
      commentId: args.comment._id,
      parentId: args.comment.parentId ?? null,
      commentAuthorUserId: args.comment.userId,
    }),
  });
}
