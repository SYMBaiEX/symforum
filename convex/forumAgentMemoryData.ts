import { RAG, defaultChunker } from "@convex-dev/rag";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";
import { components, internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { sha256Base64Url } from "./agentIdentityCrypto";

const LEASE_MS = 120_000;
const MAX_INDEX_ATTEMPT = 2;
const NAMESPACE = "forum-editorial-v1";
const sourceValidator = v.object({
  threadId: v.id("forumThreads"),
  categorySlug: v.string(),
  agentSlug: v.string(),
  title: v.string(),
  body: v.string(),
  createdAt: v.number(),
});
type Source = Infer<typeof sourceValidator>;
async function contentHash(source: Source, model: string) {
  return await sha256Base64Url(
    JSON.stringify([
      NAMESPACE,
      model,
      source.threadId,
      source.title,
      source.body,
      source.categorySlug,
      source.agentSlug,
      source.createdAt,
    ]),
  );
}
async function clearLease(
  ctx: MutationCtx,
  row: Doc<"forumAgentMemoryIndexes">,
  cancelRecovery = true,
) {
  if (cancelRecovery && row.leaseRecoveryId)
    await ctx.scheduler.cancel(row.leaseRecoveryId);
  await ctx.db.patch("forumAgentMemoryIndexes", row._id, {
    leaseToken: undefined,
    leaseHash: undefined,
    leaseModel: undefined,
    leaseExpiresAt: undefined,
    leaseAttempt: undefined,
    leaseRecoveryId: undefined,
    followupScheduled: false,
  });
}
const claimResult = v.union(
  v.object({
    claimed: v.literal(false),
    reason: v.union(
      v.literal("hidden"),
      v.literal("unchanged"),
      v.literal("busy"),
      v.literal("chunk-limit"),
      v.literal("retry-limit"),
    ),
  }),
  v.object({
    claimed: v.literal(true),
    source: sourceValidator,
    contentHash: v.string(),
  }),
);
export const claimIndex = internalMutation({
  args: {
    threadId: v.id("forumThreads"),
    model: v.string(),
    token: v.string(),
    attempt: v.optional(v.number()),
  },
  returns: claimResult,
  handler: async (ctx, args): Promise<Infer<typeof claimResult>> => {
    const attempt = args.attempt ?? 0;
    if (
      !Number.isInteger(attempt) ||
      attempt < 0 ||
      attempt > MAX_INDEX_ATTEMPT
    )
      return { claimed: false, reason: "retry-limit" };
    const live = await ctx.runQuery(
      internal.forumAgentEditorialData.readThreadForMemory,
      { threadId: args.threadId },
    );
    if (!live) return { claimed: false, reason: "hidden" };
    const source: Source = {
      threadId: live.threadId,
      categorySlug: live.categorySlug,
      agentSlug: live.agentSlug,
      title: live.title,
      body: live.body,
      createdAt: live.createdAt,
    };
    // RAG's all-chunks transaction path is strictly below its batch size (100).
    // Hold explicitly rather than truncate content or start a provider request.
    if (defaultChunker(`${source.title}\n\n${source.body}`).length >= 100)
      return { claimed: false, reason: "chunk-limit" };
    const hash = await contentHash(source, args.model);
    const row = await ctx.db
      .query("forumAgentMemoryIndexes")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    const now = Date.now();
    if (row?.leaseToken && (row.leaseExpiresAt ?? 0) > now) {
      if (row.leaseHash !== hash && !row.followupScheduled) {
        await ctx.db.patch("forumAgentMemoryIndexes", row._id, {
          followupScheduled: true,
        });
      }
      return { claimed: false, reason: "busy" };
    }
    if (row?.completedHash === hash)
      return { claimed: false, reason: "unchanged" };
    // Recover hard-terminated actions. Normal completion cancels this mutation
    // before it executes; recovery can admit at most two further attempts.
    if (row?.leaseRecoveryId) await ctx.scheduler.cancel(row.leaseRecoveryId);
    const leaseRecoveryId = await ctx.scheduler.runAfter(
      LEASE_MS,
      memoryIndexFunctions.recover,
      {
        threadId: args.threadId,
        token: args.token,
        attempt,
      },
    );
    const lease = {
      leaseRecoveryId,
      leaseAttempt: attempt,
      leaseToken: args.token,
      leaseHash: hash,
      leaseModel: args.model,
      leaseExpiresAt: now + LEASE_MS,
      followupScheduled: false,
    };
    if (row) await ctx.db.patch("forumAgentMemoryIndexes", row._id, lease);
    else
      await ctx.db.insert("forumAgentMemoryIndexes", {
        threadId: args.threadId,
        ...lease,
      });
    return { claimed: true, source, contentHash: hash };
  },
});
const commitResult = v.object({
  committed: v.boolean(),
  created: v.boolean(),
  reason: v.string(),
});
export const commitIndex = internalMutation({
  args: {
    threadId: v.id("forumThreads"),
    token: v.string(),
    contentHash: v.string(),
    chunks: v.array(
      v.object({ text: v.string(), embedding: v.array(v.number()) }),
    ),
  },
  returns: commitResult,
  handler: async (ctx, args): Promise<Infer<typeof commitResult>> => {
    const row = await ctx.db
      .query("forumAgentMemoryIndexes")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (
      !row ||
      row.leaseToken !== args.token ||
      row.leaseHash !== args.contentHash ||
      !row.leaseModel ||
      (row.leaseExpiresAt ?? 0) <= Date.now()
    )
      return { committed: false, created: false, reason: "lost-lease" };
    const source = await ctx.runQuery(
      internal.forumAgentEditorialData.readThreadForMemory,
      { threadId: args.threadId },
    );
    if (
      !source ||
      (await contentHash(source, row.leaseModel)) !== args.contentHash
    ) {
      await clearLease(ctx, row);
      if (source)
        await ctx.scheduler.runAfter(
          0,
          internal.forumAgentMemory.indexForumThread,
          { threadId: args.threadId },
        );
      return {
        committed: false,
        created: false,
        reason: source ? "changed" : "hidden",
      };
    }
    const texts = defaultChunker(`${source.title}\n\n${source.body}`);
    if (
      args.chunks.length >= 100 ||
      args.chunks.length !== texts.length ||
      args.chunks.some(
        (chunk, index) =>
          chunk.text !== texts[index] ||
          chunk.embedding.length !== 1536 ||
          chunk.embedding.some((n) => !Number.isFinite(n)),
      )
    )
      throw new Error("Invalid pre-embedded forum memory chunks");
    // This provider supplies model identity only. Every vector is required
    // above: the mutation never asks the provider to compute an embedding.
    const embeddingModel = createOpenAICompatible({
      name: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
    }).embeddingModel(row.leaseModel);
    const rag = new RAG(components.rag, {
      embeddingDimension: 1536,
      textEmbeddingModel: embeddingModel,
      filterNames: ["category", "authorKind", "categoryAndAuthor"],
    });
    const result = await rag.add(ctx, {
      namespace: NAMESPACE,
      key: `forum-thread:${source.threadId}`,
      contentHash: args.contentHash,
      title: source.title,
      chunks: args.chunks,
      metadata: {
        threadId: source.threadId,
        categorySlug: source.categorySlug,
        agentSlug: source.agentSlug,
        createdAt: source.createdAt,
      },
      filterValues: [
        { name: "category", value: source.categorySlug },
        { name: "authorKind", value: source.agentSlug },
        {
          name: "categoryAndAuthor",
          value: {
            category: source.categorySlug,
            authorKind: source.agentSlug,
          },
        },
      ],
      importance: source.agentSlug === "human" ? 1.15 : 1,
    });
    if (result.status !== "ready")
      throw new Error(`Forum memory is not ready: ${result.status}`);
    await clearLease(ctx, row);
    await ctx.db.patch("forumAgentMemoryIndexes", row._id, {
      completedHash: args.contentHash,
    });
    return { committed: true, created: result.created, reason: "ready" };
  },
});
export const releaseIndex = internalMutation({
  args: { threadId: v.id("forumThreads"), token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("forumAgentMemoryIndexes")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (row?.leaseToken === args.token) {
      await clearLease(ctx, row);
      if (row.followupScheduled) {
        const source = await ctx.runQuery(
          internal.forumAgentEditorialData.readThreadForMemory,
          { threadId: args.threadId },
        );
        if (
          source &&
          row.leaseModel &&
          (await contentHash(source, row.leaseModel)) !== row.leaseHash
        )
          await ctx.scheduler.runAfter(
            0,
            internal.forumAgentMemory.indexForumThread,
            { threadId: args.threadId },
          );
      }
    }
    return null;
  },
});

export const recoverLease = internalMutation({
  args: {
    threadId: v.id("forumThreads"),
    token: v.string(),
    attempt: v.number(),
  },
  returns: v.object({ recovered: v.boolean(), retryScheduled: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ recovered: boolean; retryScheduled: boolean }> => {
    const row = await ctx.db
      .query("forumAgentMemoryIndexes")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (
      !row ||
      row.leaseToken !== args.token ||
      row.leaseAttempt !== args.attempt ||
      (row.leaseExpiresAt ?? 0) > Date.now()
    )
      return { recovered: false, retryScheduled: false };
    const source = await ctx.runQuery(
      internal.forumAgentEditorialData.readThreadForMemory,
      { threadId: args.threadId },
    );
    const changed =
      source !== null &&
      row.leaseModel !== undefined &&
      (await contentHash(source, row.leaseModel)) !== row.leaseHash;
    await clearLease(ctx, row, false);
    // A new content generation receives its own budget; abandoned retries of
    // identical content stop after attempt 2. Hidden sources remain unindexed.
    const retryScheduled =
      source !== null && (changed || args.attempt < MAX_INDEX_ATTEMPT);
    if (retryScheduled)
      await ctx.scheduler.runAfter(
        0,
        internal.forumAgentMemory.indexForumThread,
        { threadId: args.threadId, attempt: changed ? 0 : args.attempt + 1 },
      );
    return { recovered: true, retryScheduled };
  },
});

// Typed references work before the next generated API refresh.
export const memoryIndexFunctions = {
  recover: makeFunctionReference<
    "mutation",
    { threadId: Source["threadId"]; token: string; attempt: number },
    { recovered: boolean; retryScheduled: boolean }
  >("forumAgentMemoryData:recoverLease"),
  claim: makeFunctionReference<
    "mutation",
    {
      threadId: Source["threadId"];
      model: string;
      token: string;
      attempt?: number;
    },
    Infer<typeof claimResult>
  >("forumAgentMemoryData:claimIndex"),
  commit: makeFunctionReference<
    "mutation",
    {
      threadId: Source["threadId"];
      token: string;
      contentHash: string;
      chunks: { text: string; embedding: number[] }[];
    },
    Infer<typeof commitResult>
  >("forumAgentMemoryData:commitIndex"),
  release: makeFunctionReference<
    "mutation",
    { threadId: Source["threadId"]; token: string },
    null
  >("forumAgentMemoryData:releaseIndex"),
};
