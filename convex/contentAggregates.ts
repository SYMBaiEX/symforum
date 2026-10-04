import { TableAggregate } from "@convex-dev/aggregate";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { internal } from "./_generated/api";
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
  const readiness = await contentAggregateReadiness(ctx);
  return await contentSummaryWithReadiness(
    ctx,
    entityType,
    entityId,
    readiness,
  );
}

/** Reuse migration readiness when a single query summarizes several entities. */
export async function contentSummaries(
  ctx: QueryCtx,
  entityType: "post" | "hnStory",
  entityIds: readonly string[],
) {
  const uniqueEntityIds = [...new Set(entityIds)];
  if (uniqueEntityIds.length === 0) return new Map();
  const readiness = await contentAggregateReadiness(ctx);
  const aggregateQueries = uniqueEntityIds.map((entityId) => ({
    namespace: entityNamespace({ entityType, entityId }),
  }));
  const [interactionCounts, comments] = await Promise.all([
    readiness.interactionReady
      ? Promise.all([
          interactionScores.sumBatch(ctx, aggregateQueries),
          interactionSaves.sumBatch(ctx, aggregateQueries),
        ]).then(([scores, saves]) =>
          uniqueEntityIds.map((_, index) => ({
            score: scores[index] ?? 0,
            saves: saves[index] ?? 0,
          })),
        )
      : Promise.all(
          uniqueEntityIds.map(async (entityId) => {
            const [score, saves] = await legacyInteractions(
              ctx,
              entityType,
              entityId,
            );
            return { score, saves };
          }),
        ),
    readiness.commentReady
      ? commentCounts.sumBatch(ctx, aggregateQueries)
      : Promise.all(
          uniqueEntityIds.map((entityId) =>
            legacyComments(ctx, entityType, entityId),
          ),
        ),
  ]);
  return new Map(
    uniqueEntityIds.map((entityId, index) => [
      entityId,
      {
        score: interactionCounts[index]?.score ?? 0,
        saves: interactionCounts[index]?.saves ?? 0,
        comments: comments[index] ?? 0,
      },
    ]),
  );
}

async function contentSummaryWithReadiness(
  ctx: QueryCtx,
  entityType: "post" | "hnStory",
  entityId: string,
  readiness: { interactionReady: boolean; commentReady: boolean },
) {
  const namespace = entityNamespace({ entityType, entityId });
  const [score, saves] = readiness.interactionReady
    ? await Promise.all([
        interactionScores.sum(ctx, { namespace }),
        interactionSaves.sum(ctx, { namespace }),
      ])
    : await legacyInteractions(ctx, entityType, entityId);
  const comments = readiness.commentReady
    ? await commentCounts.sum(ctx, { namespace })
    : await legacyComments(ctx, entityType, entityId);
  return { score, saves, comments };
}

export async function contentAggregateReadiness(ctx: QueryCtx) {
  const [interactionReady, commentReady] = await Promise.all([
    migrationComplete(ctx, INTERACTION_MIGRATION_KEY),
    migrationComplete(ctx, COMMENT_MIGRATION_KEY),
  ]);
  return { interactionReady, commentReady };
}

/** Read multiple save counts through the existing aggregate when backfilled. */
export async function interactionSaveCounts(
  ctx: QueryCtx,
  entityType: "hnStory",
  entityIds: readonly string[],
) {
  const uniqueEntityIds = [...new Set(entityIds)];
  if (uniqueEntityIds.length === 0) return new Map<string, number>();

  const aggregateReady = await migrationComplete(
    ctx,
    INTERACTION_MIGRATION_KEY,
  );
  const counts = aggregateReady
    ? await interactionSaves.sumBatch(
        ctx,
        uniqueEntityIds.map((entityId) => ({
          namespace: entityNamespace({ entityType, entityId }),
        })),
      )
    : await Promise.all(
        uniqueEntityIds.map(async (entityId) => {
          const rows = await ctx.db
            .query("interactions")
            .withIndex("by_entityType_and_entityId", (q) =>
              q.eq("entityType", entityType).eq("entityId", entityId),
            )
            .take(1_000);
          return rows.filter((row) => row.saved).length;
        }),
      );
  return new Map(
    uniqueEntityIds.map((entityId, index) => [entityId, counts[index] ?? 0]),
  );
}

export const backfillContentAggregates = internalMutation({
  args: {
    phase: v.optional(
      v.union(v.literal("interactions"), v.literal("comments")),
    ),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    phase: v.union(v.literal("interactions"), v.literal("comments")),
    processed: v.number(),
    cursor: v.union(v.string(), v.null()),
    done: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const phase = args.phase ?? (await nextBackfillPhase(ctx));
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 200));
    const key =
      phase === "interactions"
        ? INTERACTION_MIGRATION_KEY
        : COMMENT_MIGRATION_KEY;
    const state = await ctx.db
      .query("optimizationMigrations")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (state?.status === "completed") {
      return { phase, processed: 0, cursor: null, done: true };
    }
    // Persisted state wins over caller input so a retry cannot rewind a
    // partially completed migration.
    const cursor = state?.cursor ?? args.cursor ?? null;
    const page =
      phase === "interactions"
        ? await ctx.db.query("interactions").paginate({
            cursor,
            numItems: limit,
          })
        : await ctx.db.query("comments").paginate({
            cursor,
            numItems: limit,
          });
    if (phase === "interactions") {
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
      phase,
      cursor: page.isDone ? undefined : page.continueCursor,
      scheduledAt: page.isDone ? undefined : now,
      updatedAt: now,
      ...(page.isDone ? { completedAt: now } : {}),
    };
    if (state === null) {
      await ctx.db.insert("optimizationMigrations", fields);
    } else {
      await ctx.db.patch("optimizationMigrations", state._id, fields);
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.contentAggregates.backfillContentAggregates,
        {
          phase,
          limit,
        },
      );
    } else if (phase === "interactions") {
      // Move to the next phase without requiring a human to notice the first
      // phase completed. Existing callers may still invoke either phase.
      await ctx.scheduler.runAfter(
        0,
        internal.contentAggregates.backfillContentAggregates,
        {
          phase: "comments",
          limit,
        },
      );
    }
    return {
      phase,
      processed: page.page.length,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
    };
  },
});

async function nextBackfillPhase(ctx: MutationCtx) {
  const interactions = await ctx.db
    .query("optimizationMigrations")
    .withIndex("by_key", (q) => q.eq("key", INTERACTION_MIGRATION_KEY))
    .unique();
  return interactions?.status === "completed"
    ? ("comments" as const)
    : ("interactions" as const);
}

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
