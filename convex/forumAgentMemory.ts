"use node";

import { RAG } from "@convex-dev/rag";
import { createGateway } from "@ai-sdk/gateway-v3";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { env, internalAction, type ActionCtx } from "./_generated/server";
import { EMBEDDING_HEALTH_KEY } from "./aiRoutingControlData";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const MEMORY_NAMESPACE = "forum-editorial-v1";
const EMBEDDING_RETRY_DELAYS_MS = [30_000, 120_000] as const;

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

function platform(apiKey: string) {
  const gateway = createGateway({ apiKey });
  const embeddingModel = gateway.embeddingModel(EMBEDDING_MODEL);
  const rag = new RAG<MemoryFilters, MemoryMetadata>(components.rag, {
    embeddingDimension: 1536,
    textEmbeddingModel: embeddingModel,
    filterNames: ["category", "authorKind", "categoryAndAuthor"],
  });
  return { rag };
}

function requireApiKey() {
  const apiKey = env.AI_GATEWAY_API_KEY?.trim();
  if (!apiKey) throw new Error("AI_GATEWAY_API_KEY is not configured.");
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
  const { rag } = platform(requireApiKey());
  let result: Awaited<ReturnType<typeof rag.search>>;
  try {
    result = await rag.search(ctx, {
      namespace: MEMORY_NAMESPACE,
      query: args.query,
      filters:
        args.categorySlug === undefined
          ? []
          : [{ name: "category", value: args.categorySlug }],
      limit: 8,
      vectorScoreThreshold: 0.58,
      searchType: "vector",
      chunkContext: { before: 1, after: 1 },
    });
    await ctx.runMutation(
      internal.aiRoutingControlData.recordOperationalState,
      {
        key: EMBEDDING_HEALTH_KEY,
        healthy: true,
        provider: "gateway",
        model: EMBEDDING_MODEL,
        detail: `Semantic search ready; ${result.entries.length} entries matched.`,
      },
    );
  } catch (error) {
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
    agentSlug: args.agentSlug,
    stage: "embedding",
    model: EMBEDDING_MODEL,
    categorySlug: args.categorySlug,
    inputTokens: result.usage.tokens,
    durationMs: Date.now() - startedAt,
  });
  return result.entries.map((entry) => ({
    threadId: entry.metadata?.threadId,
    categorySlug: entry.metadata?.categorySlug,
    agentSlug: entry.metadata?.agentSlug,
    title: entry.title,
    text: entry.text,
    score: scores.get(entry.entryId) ?? 0,
  }));
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
  const { rag } = platform(requireApiKey());
  const text = [source.title, source.body].join("\n\n");
  let result: Awaited<ReturnType<typeof rag.add>>;
  try {
    result = await rag.add(ctx, {
      namespace: MEMORY_NAMESPACE,
      key: `forum-thread:${source.threadId}`,
      title: source.title,
      text,
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
    provider: "gateway",
    model: EMBEDDING_MODEL,
    detail: `Indexed forum thread ${source.threadId}; ${result.status}.`,
  });
  await ctx.runMutation(internal.forumAgentEditorialData.recordUsage, {
    runKey: `index:${source.threadId}`,
    agentSlug,
    stage: "embedding",
    model: EMBEDDING_MODEL,
    categorySlug: source.categorySlug,
    inputTokens: result.usage.tokens,
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
    try {
      const { rag } = platform(requireApiKey());
      await rag.getOrCreateNamespace(ctx, {
        namespace: MEMORY_NAMESPACE,
        status: "ready",
      });
      const result = await rag.search(ctx, {
        namespace: MEMORY_NAMESPACE,
        query: "forum editorial semantic retrieval health check",
        limit: 1,
        vectorScoreThreshold: 0,
        searchType: "vector",
      });
      await ctx.runMutation(
        internal.aiRoutingControlData.recordOperationalState,
        {
          key: EMBEDDING_HEALTH_KEY,
          healthy: true,
          provider: "gateway",
          model: EMBEDDING_MODEL,
          detail: `Embedding search is available; ${result.entries.length} entries available.`,
        },
      );
      return {
        healthy: true,
        model: EMBEDDING_MODEL,
        entries: result.entries.length,
        embeddingTokens: result.usage.tokens,
      };
    } catch (error) {
      const detail = safeError(error);
      await recordEmbeddingFailure(ctx, error);
      return { healthy: false, detail };
    }
  },
});

export const backfillForumMemory = internalAction({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ indexed: number; done: boolean }> => {
    const state =
      args.cursor === undefined
        ? await ctx.runQuery(
            internal.forumAgentEditorialData.readEmbeddingBackfillState,
            {},
          )
        : null;
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
    provider: "gateway",
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
