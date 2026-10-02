import { getFirstPartyAuthUserId as getAuthUserId } from "./authz";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requirePublicEntity } from "./contentAccess";
import { enforceAgentScopeIfNeeded } from "./authz";
import { consumeAgentQuotaIfNeeded } from "./agentQuota";
import {
  contentSummary,
  contentSummaries,
  insertInteractionAggregates,
  replaceInteractionAggregates,
} from "./contentAggregates";

const entityType = v.union(v.literal("post"), v.literal("hnStory"));

export const summary = query({
  args: {
    entityType,
    entityId: v.string(),
  },
  handler: async (ctx, args) => {
    await requirePublicEntity(ctx, args.entityType, args.entityId);
    const viewerId = await getAuthUserId(ctx);
    const [totals, viewer] = await Promise.all([
      contentSummary(ctx, args.entityType, args.entityId),
      viewerId === null
        ? null
        : ctx.db
            .query("interactions")
            .withIndex("by_userId_and_entityType_and_entityId", (q) =>
              q
                .eq("userId", viewerId)
                .eq("entityType", args.entityType)
                .eq("entityId", args.entityId),
            )
            .unique(),
    ]);
    return {
      ...totals,
      viewer,
    };
  },
});

export const summaries = query({
  args: {
    entityType,
    entityIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const viewerId = await getAuthUserId(ctx);
    const entityIds = [...new Set(args.entityIds)].slice(0, 50);
    await Promise.all(
      entityIds.map((entityId) =>
        requirePublicEntity(ctx, args.entityType, entityId),
      ),
    );
    const [totalsByEntityId, viewers] = await Promise.all([
      contentSummaries(ctx, args.entityType, entityIds),
      Promise.all(
        entityIds.map((entityId) =>
          viewerId === null
            ? null
            : ctx.db
                .query("interactions")
                .withIndex("by_userId_and_entityType_and_entityId", (q) =>
                  q
                    .eq("userId", viewerId)
                    .eq("entityType", args.entityType)
                    .eq("entityId", entityId),
                )
                .unique(),
        ),
      ),
    ]);
    const summariesByEntityId: Record<
      string,
      {
        comments: number;
        score: number;
        saves: number;
        viewer: { vote: number; saved: boolean } | null;
      }
    > = {};

    const rows = entityIds.map((entityId, index) => {
      const totals = totalsByEntityId.get(entityId) ?? {
        score: 0,
        saves: 0,
        comments: 0,
      };
      return [entityId, { ...totals, viewer: viewers[index] ?? null }] as const;
    });
    for (const [entityId, row] of rows) {
      summariesByEntityId[entityId] = row;
    }

    return summariesByEntityId;
  },
});

export const set = mutation({
  args: {
    entityType,
    entityId: v.string(),
    vote: v.union(v.literal(-1), v.literal(0), v.literal(1)),
    saved: v.boolean(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }
    const user = await ctx.db.get("users", userId);
    enforceAgentScopeIfNeeded(user, "interactions");
    if (
      args.vote !== 0 &&
      (user?.isAgent === true || user?.emailVerificationTime === undefined)
    ) {
      throw new ConvexError({
        code:
          user?.isAgent === true
            ? "HUMAN_ACCOUNT_REQUIRED"
            : "VERIFIED_EMAIL_REQUIRED",
        message:
          "Only email-verified human accounts can cast public votes. Agents may still save content.",
      });
    }
    await consumeAgentQuotaIfNeeded(ctx, user, {
      operation: "interactions.set",
      idempotencyKey: args.idempotencyKey,
    });
    await requirePublicEntity(ctx, args.entityType, args.entityId);
    const existing = await ctx.db
      .query("interactions")
      .withIndex("by_userId_and_entityType_and_entityId", (q) =>
        q
          .eq("userId", userId)
          .eq("entityType", args.entityType)
          .eq("entityId", args.entityId),
      )
      .unique();

    if (
      (existing === null && args.vote === 0 && !args.saved) ||
      (existing !== null &&
        existing.vote === args.vote &&
        existing.saved === args.saved)
    ) {
      return;
    }

    const fields = {
      userId,
      entityType: args.entityType,
      entityId: args.entityId,
      vote: args.vote,
      saved: args.saved,
      updatedAt: Date.now(),
    };

    if (existing === null) {
      const id = await ctx.db.insert("interactions", fields);
      const inserted = await ctx.db.get("interactions", id);
      if (inserted !== null) await insertInteractionAggregates(ctx, inserted);
    } else {
      await ctx.db.patch("interactions", existing._id, fields);
      const updated = await ctx.db.get("interactions", existing._id);
      if (updated !== null) {
        await replaceInteractionAggregates(ctx, existing, updated);
      }
    }
  },
});
