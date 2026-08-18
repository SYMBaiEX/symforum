import { TableAggregate } from "@convex-dev/aggregate";
import { v } from "convex/values";
import { components } from "./_generated/api";
import type { DataModel, Doc } from "./_generated/dataModel";
import {
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const INTERACTION_MIGRATION_KEY = "interaction-aggregates-v1";
const COMMENT_MIGRATION_KEY = "comment-aggregates-v1";

function entityNamespace(doc: { entityType: string; entityId: string }) {
  return `${doc.entityType}:${doc.entityId}`;
}

export const interactionScores = new TableAggregate<{
  Namespace: string;
  Key: null;
  DataModel: DataModel;
  TableName: "interactions";
}>(components.interactionScores, {
  namespace: entityNamespace,
  sortKey: () => null,
  sumValue: (doc) => doc.vote,
});

export const interactionSaves = new TableAggregate<{
  Namespace: string;
  Key: null;
  DataModel: DataModel;
  TableName: "interactions";
}>(components.interactionSaves, {
  namespace: entityNamespace,
  sortKey: () => null,
  sumValue: (doc) => (doc.saved ? 1 : 0),
});

export const commentCounts = new TableAggregate<{
  Namespace: string;
  Key: null;
  DataModel: DataModel;
  TableName: "comments";
}>(components.commentCounts, {
  namespace: entityNamespace,
  sortKey: () => null,
  sumValue: (doc) => ((doc.status ?? "active") === "active" ? 1 : 0),
});

export async function insertInteractionAggregates(
  ctx: MutationCtx,
  doc: Doc<"interactions">,
) {
  await Promise.all([
    interactionScores.insertIfDoesNotExist(ctx, doc),
    interactionSaves.insertIfDoesNotExist(ctx, doc),
  ]);
}

export async function replaceInteractionAggregates(
  ctx: MutationCtx,
  oldDoc: Doc<"interactions">,
  newDoc: Doc<"interactions">,
) {
  await Promise.all([
    interactionScores.replaceOrInsert(ctx, oldDoc, newDoc),
    interactionSaves.replaceOrInsert(ctx, oldDoc, newDoc),
  ]);
}

export async function deleteInteractionAggregates(
  ctx: MutationCtx,
  doc: Doc<"interactions">,
) {
  await Promise.all([
    interactionScores.deleteIfExists(ctx, doc),
    interactionSaves.deleteIfExists(ctx, doc),
  ]);
}

export async function insertCommentAggregate(
  ctx: MutationCtx,
  doc: Doc<"comments">,
) {
  await commentCounts.insertIfDoesNotExist(ctx, doc);
}

export async function replaceCommentAggregate(
  ctx: MutationCtx,
  oldDoc: Doc<"comments">,
  newDoc: Doc<"comments">,
) {
  await commentCounts.replaceOrInsert(ctx, oldDoc, newDoc);
}

export async function contentSummary(
  ctx: QueryCtx,
  entityType: "post" | "hnStory",
  entityId: string,
) {
  const namespace = entityNamespace({ entityType, entityId });
  const [interactionReady, commentReady] = await Promise.all([
    migrationComplete(ctx, INTERACTION_MIGRATION_KEY),
    migrationComplete(ctx, COMMENT_MIGRATION_KEY),
  ]);
  const [score, saves] = interactionReady
    ? await Promise.all([
        interactionScores.sum(ctx, { namespace }),
        interactionSaves.sum(ctx, { namespace }),
      ])
    : await legacyInteractions(ctx, entityType, entityId);
  const comments = commentReady
    ? await commentCounts.sum(ctx, { namespace })
    : await legacyComments(ctx, entityType, entityId);
  return { score, saves, comments };
}

export const backfillContentAggregates = internalMutation({
  args: {
    phase: v.union(v.literal("interactions"), v.literal("comments")),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 200));
    const key =
      args.phase === "interactions"
        ? INTERACTION_MIGRATION_KEY
        : COMMENT_MIGRATION_KEY;
    const state = await ctx.db
      .query("optimizationMigrations")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (state?.status === "completed") {
      return { processed: 0, cursor: null, done: true };
    }
    const page =
      args.phase === "interactions"
        ? await ctx.db.query("interactions").paginate({
            cursor: args.cursor ?? null,
            numItems: limit,
          })
        : await ctx.db.query("comments").paginate({
            cursor: args.cursor ?? null,
            numItems: limit,
          });
    if (args.phase === "interactions") {
      for (const doc of page.page as Doc<"interactions">[]) {
        await Promise.all([
          interactionScores.insertIfDoesNotExist(ctx, doc),
          interactionSaves.insertIfDoesNotExist(ctx, doc),
        ]);
      }
    } else {
      for (const doc of page.page as Doc<"comments">[]) {
        await commentCounts.insertIfDoesNotExist(ctx, doc);
      }
    }
    const now = Date.now();
    const processed = (state?.processed ?? 0) + page.page.length;
    const fields = {
      key,
      status: page.isDone ? ("completed" as const) : ("running" as const),
      processed,
      updatedAt: now,
      ...(page.isDone ? { completedAt: now } : {}),
    };
    if (state === null) {
      await ctx.db.insert("optimizationMigrations", fields);
    } else {
      await ctx.db.patch("optimizationMigrations", state._id, fields);
    }
    return {
      processed: page.page.length,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

async function migrationComplete(ctx: QueryCtx, key: string) {
  const state = await ctx.db
    .query("optimizationMigrations")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  return state?.status === "completed";
}

async function legacyInteractions(
  ctx: QueryCtx,
  entityType: "post" | "hnStory",
  entityId: string,
) {
  const rows = await ctx.db
    .query("interactions")
    .withIndex("by_entityType_and_entityId", (q) =>
      q.eq("entityType", entityType).eq("entityId", entityId),
    )
    .take(1_000);
  return [
    rows.reduce((total, row) => total + row.vote, 0),
    rows.filter((row) => row.saved).length,
  ] as const;
}

async function legacyComments(
  ctx: QueryCtx,
  entityType: "post" | "hnStory",
  entityId: string,
) {
  const rows = await ctx.db
    .query("comments")
    .withIndex("by_entityType_and_entityId_and_createdAt", (q) =>
      q.eq("entityType", entityType).eq("entityId", entityId),
    )
    .take(1_000);
  return rows.filter((row) => (row.status ?? "active") === "active").length;
}
