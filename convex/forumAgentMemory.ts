"use node";

import { RAG } from "@convex-dev/rag";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import {
  forumDayKey,
  openRouterDailyBudgetMicroUsd,
} from "../lib/ai-model-costs";
import { OPENROUTER_EMBEDDING_MODEL } from "../lib/ai-models";
import { embedRagQuery, embedRagText } from "./ragEmbeddings";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction, type ActionCtx } from "./_generated/server";
import { EMBEDDING_HEALTH_KEY } from "./aiRoutingControlData";

const EMBEDDING_MODEL = OPENROUTER_EMBEDDING_MODEL;
const EMBEDDING_TIMEOUT_MS = 12_000;
const MEMORY_NAMESPACE = "forum-editorial-v1";
const EMBEDDING_RETRY_DELAYS_MS = [30_000, 120_000] as const;
const MAX_EDITORIAL_MEMORY_RESULTS = 8;
const EDITORIAL_MEMORY_VALIDATION_BATCH_SIZE = 8;
// RAG entries are retained independently of forum moderation. Fetch more than
// the caller needs, then fail closed against the current forum visibility.
const EDITORIAL_MEMORY_CANDIDATE_LIMIT = 32;

type MemoryFilters = {
  category: string;
  authorKind: string;
  categoryAndAuthor: { category: string; authorKind: string };
};

type MemoryMetadata = {
  threadId: string;
  categorySlug: string;
  agentSlug: string;
  createdAt: number;
};

type CurrentMemoryThread = {
  threadId: Id<"forumThreads">;
  categorySlug: string;
  agentSlug: string;
  title: string;
  body: string;
};

type MemorySearchEntry = {
  entryId: string;
  metadata?: { threadId?: string };
  title?: string;
  text?: string;
};

/**
 * The RAG namespace is only an index, not an authorization boundary. A forum
 * thread can become hidden or inherit a private parent after it was embedded,
 * so every candidate is re-authorized from the primary database before any
 * text is returned to an editorial prompt.
 */
export async function selectCurrentPublicMemoryEntries(
  entries: readonly MemorySearchEntry[],
  scores: ReadonlyMap<string, number>,
  readThreads: (
    threadIds: readonly Id<"forumThreads">[],
  ) => Promise<(CurrentMemoryThread | null)[]>,
  limit = MAX_EDITORIAL_MEMORY_RESULTS,
) {
  const seenThreadIds = new Set<string>();
  const candidates = entries.flatMap((entry) => {
    const threadId = entry.metadata?.threadId;
    if (threadId === undefined || seenThreadIds.has(threadId)) return [];
    seenThreadIds.add(threadId);
    return [{ entry, threadId: threadId as Id<"forumThreads"> }];
  });
  const selected: {
    threadId: Id<"forumThreads">;
    categorySlug: string;
    agentSlug: string;
    title: string;
    text: string;
    score: number;
  }[] = [];
  const boundedCandidates = candidates.slice(
    0,
    EDITORIAL_MEMORY_CANDIDATE_LIMIT,
  );
  for (
    let offset = 0;
    offset < boundedCandidates.length && selected.length < limit;
    offset += EDITORIAL_MEMORY_VALIDATION_BATCH_SIZE
  ) {
    const batch = boundedCandidates.slice(
      offset,
      offset + EDITORIAL_MEMORY_VALIDATION_BATCH_SIZE,
    );
    const threads = await readThreads(batch.map(({ threadId }) => threadId));
    for (const [index, { entry }] of batch.entries()) {
      const thread = threads[index] ?? null;
      if (thread === null) continue;
      // Return the live primary-record content rather than the stored
      // embedding chunk: edits and moderation take effect immediately.
      selected.push({
        threadId: thread.threadId,
        categorySlug: thread.categorySlug,
        agentSlug: thread.agentSlug,
        title: thread.title,
        text: thread.body,
        score: scores.get(entry.entryId) ?? 0,
      });
      if (selected.length >= limit) break;
    }
  }
  return selected;
}

function platform(apiKey: string) {
  const openRouter = createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": "https://forum.symbaiex.com",
      "X-OpenRouter-Title": "SYMBiEX Forum Agents",
    },
  });
  const embeddingModel = openRouter.embeddingModel(EMBEDDING_MODEL);
  const rag = new RAG<MemoryFilters, MemoryMetadata>(components.rag, {
    embeddingDimension: 1536,
    textEmbeddingModel: embeddingModel,
    filterNames: ["category", "authorKind", "categoryAndAuthor"],
  });
  return { rag, embeddingModel };
}

function requireApiKey() {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");
  return apiKey;
}

export async function searchEditorialMemory(
  ctx: ActionCtx,
  args: {
    agentSlug: string;
    query: string;
    categorySlug?: string;
    runKey: string;
  },
) {
  const startedAt = Date.now();
  const { rag, embeddingModel } = platform(requireApiKey());
  const reservation = await reserveEmbeddingCall(ctx, args.query);
  if (!reservation.accepted) return [];
  let result: Awaited<ReturnType<typeof rag.search>>;
  let inputTokens = 0;
  try {
    const embedded = await embedRagQuery(
      embeddingModel,
      args.query,
      AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    );
    inputTokens = embedded.inputTokens;
    result = await rag.search(ctx, {
      namespace: MEMORY_NAMESPACE,
      query: embedded.embedding,
      filters:
        args.categorySlug === undefined
          ? []
          : [{ name: "category", value: args.categorySlug }],
      limit: EDITORIAL_MEMORY_CANDIDATE_LIMIT,
      vectorScoreThreshold: 0.58,
      searchType: "vector",
      chunkContext: { before: 1, after: 1 },
    });
    await ctx.runMutation(
      internal.aiRoutingControlData.recordOperationalState,
      {
        key: EMBEDDING_HEALTH_KEY,
        healthy: true,
        provider: "openrouter",
        model: EMBEDDING_MODEL,
        detail: `Semantic search ready; ${result.entries.length} entries matched.`,
      },
    );
  } catch (error) {
    await markEmbeddingCallFailed(ctx, reservation.reservationKey);
    await recordEmbeddingFailure(ctx, error);
    return [];
  }
  const scores = new Map<string, number>();
  for (const match of result.results) {
    scores.set(
      match.entryId,
      Math.max(scores.get(match.entryId) ?? 0, match.score),
    );
  }
  await ctx.runMutation(internal.forumAgentEditorialData.recordUsage, {
    runKey: args.runKey,
    reservationKey: reservation.reservationKey,
    agentSlug: args.agentSlug,
    stage: "embedding",
    model: EMBEDDING_MODEL,
    categorySlug: args.categorySlug,
    inputTokens,
    durationMs: Date.now() - startedAt,
  });
  return await selectCurrentPublicMemoryEntries(
    result.entries,
    scores,
    async (threadIds) =>
      await ctx.runQuery(
        internal.forumAgentEditorialData.readThreadsForMemory,
        { threadIds: [...threadIds] },
      ),
  );
}

async function indexThread(
  ctx: ActionCtx,
  threadId: Id<"forumThreads">,
  attempt = 0,
) {
  const source = await ctx.runQuery(
    internal.forumAgentEditorialData.readThreadForMemory,
    { threadId },
  );
  if (source === null) return { status: "skipped" as const };
  const agentSlug = source.agentSlug === "human" ? "suki" : source.agentSlug;
  const startedAt = Date.now();
  const { rag, embeddingModel } = platform(requireApiKey());
  const text = [source.title, source.body].join("\n\n");
  const reservation = await reserveEmbeddingCall(ctx, text);
  if (!reservation.accepted)
    return { status: "skipped" as const, reason: "budget" as const };
  let result: Awaited<ReturnType<typeof rag.add>>;
  let inputTokens = 0;
  try {
    const embedded = await embedRagText(
      embeddingModel,
      text,
      AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    );
    inputTokens = embedded.inputTokens;
    result = await rag.add(ctx, {
      namespace: MEMORY_NAMESPACE,
      key: `forum-thread:${source.threadId}`,
      title: source.title,
      chunks: embedded.chunks,
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
  } catch (error) {
    await markEmbeddingCallFailed(ctx, reservation.reservationKey);
    await recordEmbeddingFailure(ctx, error);
    if (attempt < EMBEDDING_RETRY_DELAYS_MS.length) {
      await ctx.scheduler.runAfter(
        EMBEDDING_RETRY_DELAYS_MS[attempt],
        internal.forumAgentMemory.indexForumThread,
        { threadId, attempt: attempt + 1 },
      );
    }
    return {
      status: "failed" as const,
      retryScheduled: attempt < EMBEDDING_RETRY_DELAYS_MS.length,
    };
  }
  await ctx.runMutation(internal.aiRoutingControlData.recordOperationalState, {
    key: EMBEDDING_HEALTH_KEY,
    healthy: true,
    provider: "openrouter",
    model: EMBEDDING_MODEL,
    detail: `Indexed forum thread ${source.threadId}; ${result.status}.`,
  });
  await ctx.runMutation(internal.forumAgentEditorialData.recordUsage, {
    runKey: `index:${source.threadId}`,
    reservationKey: reservation.reservationKey,
    agentSlug,
    stage: "embedding",
    model: EMBEDDING_MODEL,
    categorySlug: source.categorySlug,
    inputTokens,
    durationMs: Date.now() - startedAt,
  });
  return { status: result.status, created: result.created };
}

export const indexForumThread = internalAction({
  args: {
    threadId: v.id("forumThreads"),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    await indexThread(ctx, args.threadId, args.attempt ?? 0),
});

export const checkEmbeddingHealth = internalAction({
  args: {},
  handler: async (ctx) => {
    const startedAt = Date.now();
    let reservationKey: string | undefined;
    try {
      const { rag, embeddingModel } = platform(requireApiKey());
      await rag.getOrCreateNamespace(ctx, {
        namespace: MEMORY_NAMESPACE,
        status: "ready",
      });
      const query = "forum editorial semantic retrieval health check";
      const reservation = await reserveEmbeddingCall(ctx, query);
      if (!reservation.accepted)
        return { healthy: false, skipped: "daily_budget" };
      reservationKey = reservation.reservationKey;
      const embedded = await embedRagQuery(
        embeddingModel,
        query,
        AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
      );
      const result = await rag.search(ctx, {
        namespace: MEMORY_NAMESPACE,
        query: embedded.embedding,
        limit: 1,
        vectorScoreThreshold: 0,
        searchType: "vector",
      });
      await ctx.runMutation(
        internal.aiRoutingControlData.recordOperationalState,
        {
          key: EMBEDDING_HEALTH_KEY,
          healthy: true,
          provider: "openrouter",
          model: EMBEDDING_MODEL,
          detail: `Embedding search is available; ${result.entries.length} entries available.`,
        },
      );
      await ctx.runMutation(internal.forumAgentEditorialData.recordUsage, {
        runKey: `embedding-health:${randomUUID()}`,
        reservationKey: reservation.reservationKey,
        agentSlug: "suki",
        stage: "embedding",
        model: EMBEDDING_MODEL,
        inputTokens: embedded.inputTokens,
        durationMs: Date.now() - startedAt,
      });
      return {
        healthy: true,
        model: EMBEDDING_MODEL,
        entries: result.entries.length,
        embeddingTokens: embedded.inputTokens,
      };
    } catch (error) {
      if (reservationKey !== undefined)
        await markEmbeddingCallFailed(ctx, reservationKey);
      const detail = safeError(error);
      await recordEmbeddingFailure(ctx, error);
      return { healthy: false, detail };
    }
  },
});

async function reserveEmbeddingCall(ctx: ActionCtx, text: string) {
  const reservationKey = `forum-embedding:${randomUUID()}`;
  try {
    const reservation = await ctx.runMutation(
      internal.aiRoutingControlData.reserveModelCall,
      {
        reservationKey,
        model: EMBEDDING_MODEL,
        dayKey: forumDayKey(Date.now()),
        estimatedInputTokens: Math.max(1, text.length * 2),
        estimatedOutputTokens: 0,
        budgetLimitMicroUsd: openRouterDailyBudgetMicroUsd(
          env.OPENROUTER_DAILY_BUDGET_USD,
        ),
      },
    );
    return reservation.accepted
      ? { accepted: true as const, reservationKey }
      : { accepted: false as const, reason: reservation.reason };
  } catch {
    // Memory is an enhancement. If the shared spend ledger is unavailable,
    // fail closed without making an unmetered embedding request.
    return { accepted: false as const, reason: "reservation_unavailable" };
  }
}

async function markEmbeddingCallFailed(ctx: ActionCtx, reservationKey: string) {
  await ctx.runMutation(internal.aiRoutingControlData.markModelCallFailed, {
    reservationKey,
  });
}

export const backfillForumMemory = internalAction({
  args: {
    cursor: v.optional(v.string()),
    restart: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ indexed: number; done: boolean }> => {
    const state =
      args.cursor === undefined && !args.restart
        ? await ctx.runQuery(
            internal.forumAgentEditorialData.readEmbeddingBackfillState,
            {},
          )
        : null;
    if (
      args.cursor === undefined &&
      !args.restart &&
      (state?.completedAt ?? 0) > 0 &&
      state?.cursor === undefined
    ) {
      return { indexed: 0, done: true };
    }
    const cursor = args.cursor ?? state?.cursor;
    const page: {
      threadIds: Id<"forumThreads">[];
      continueCursor: string;
      isDone: boolean;
    } = await ctx.runQuery(
      internal.forumAgentEditorialData.readForumThreadsForBackfill,
      cursor === undefined ? {} : { cursor },
    );
    for (const threadId of page.threadIds) await indexThread(ctx, threadId, 0);
    await ctx.runMutation(
      internal.forumAgentEditorialData.writeEmbeddingBackfillState,
      {
        cursor: page.isDone ? undefined : page.continueCursor,
        completed: page.isDone,
      },
    );
    if (!page.isDone) {
      await ctx.scheduler.runAfter(
        1_000,
        internal.forumAgentMemory.backfillForumMemory,
        {
          cursor: page.continueCursor,
        },
      );
    }
    return { indexed: page.threadIds.length, done: page.isDone };
  },
});

async function recordEmbeddingFailure(ctx: ActionCtx, error: unknown) {
  await ctx.runMutation(internal.aiRoutingControlData.recordOperationalState, {
    key: EMBEDDING_HEALTH_KEY,
    healthy: false,
    provider: "openrouter",
    model: EMBEDDING_MODEL,
    detail: safeError(error),
    pauseUntil: Date.now() + 15 * 60_000,
  });
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 240);
}
