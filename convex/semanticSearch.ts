"use node";

import { RAG } from "@convex-dev/rag";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible-v3";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import { estimatedModelCostMicroUsd, openRouterDailyBudgetMicroUsd } from "../lib/ai-model-costs";
import { OPENROUTER_EMBEDDING_MODEL } from "../lib/ai-models";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalAction, internalMutation, internalQuery } from "./_generated/server";

/**
 * Opt-in semantic retrieval for the public evidence corpus.
 *
 * The RAG component is an index, never an authorization boundary. Both
 * indexing and retrieval re-check the mutable primary records, so a document
 * or source that is hidden, retired, or deleted cannot be returned from a
 * stale embedding. Nothing calls this module from the public search transport
 * while the feature switch is off; universal lexical search remains exact and
 * dependency-free.
 */
const NAMESPACE = "public-evidence-v1";
const MAX_SOURCE_TEXT_CHARS = 6_000;
const MAX_QUERY_CHARS = 300;
const MAX_SEMANTIC_CANDIDATES = 25;
const MAX_BACKFILL_PAGE = 5;
const BACKFILL_KEY = "semantic-search-public-evidence-v1";
const SEMANTIC_HEALTH_KEY = "semantic-search-public-evidence";
const DEFAULT_DAILY_BUDGET_USD = 0.05;
const PAUSE_AFTER_FAILURE_MS = 15 * 60_000;

type SemanticMetadata = {
  documentId: string;
  sourceId: string;
  fingerprint: string;
};

type IndexDocument = {
  documentId: Id<"evidenceDocuments">;
  sourceId: Id<"evidenceSources">;
  title: string;
  excerpt: string;
  searchText: string;
  tags: string[];
  authors: string[];
  updatedAt: number;
  sourceUpdatedAt: number;
  alreadyIndexed: boolean;
};

type SemanticCandidate = {
  documentId: Id<"evidenceDocuments">;
  score: number;
};

const readDocumentRef = makeFunctionReference<
  "query",
  { documentId: Id<"evidenceDocuments">; embeddingModel: string },
  IndexDocument | null
>("semanticSearch:readPublicDocumentForIndex");
const readBackfillPageRef = makeFunctionReference<
  "query",
  { cursor?: string },
  { documentIds: Id<"evidenceDocuments">[]; continueCursor?: string; done: boolean }
>("semanticSearch:readPublicBackfillPage");
const writeBackfillStateRef = makeFunctionReference<
  "mutation",
  { cursor?: string; completed: boolean; processed: number },
  null
>("semanticSearch:writeBackfillState");
const readBackfillStateRef = makeFunctionReference<
  "query",
  Record<string, never>,
  { cursor?: string; completed: boolean } | null
>("semanticSearch:readBackfillState");
const recordUsageRef = makeFunctionReference<
  "mutation",
  {
    inputTokens: number;
    model: string;
    outcome: "completed" | "failed";
    detail: string;
  },
  null
>("semanticSearch:recordUsage");
const reserveUsageRef = makeFunctionReference<
  "mutation",
  { estimatedMicroUsd: number; inputTokens: number; model: string; dailyBudgetMicroUsd: number },
  { accepted: boolean }
>("semanticSearch:reserveUsage");
const readCandidatesRef = makeFunctionReference<
  "query",
  { candidates: SemanticCandidate[] },
  Array<{
    documentId: Id<"evidenceDocuments">;
    title: string;
    excerpt: string;
    canonicalUrl: string;
    updatedAt: number;
    publishedAt: number | null;
    score: number;
  }>
>("semanticSearch:readCurrentPublicCandidates");
const indexDocumentRef = makeFunctionReference<
  "action",
  { documentId: Id<"evidenceDocuments"> },
  { status: string; reason?: string; created?: boolean; inputTokens?: number }
>("semanticSearch:indexPublicEvidenceDocument");
const backfillRef = makeFunctionReference<
  "action",
  { cursor?: string; restart?: boolean },
  unknown
>("semanticSearch:backfillPublicEvidence");
const searchSemanticRef = makeFunctionReference<
  "action",
  { query: string; limit?: number },
  Array<{
    documentId: Id<"evidenceDocuments">;
    title: string;
    excerpt: string;
    canonicalUrl: string;
    updatedAt: number;
    publishedAt: number | null;
    score: number;
  }>
>("semanticSearch:searchPublicSemantic");

export type SemanticSearchConfig = {
  enabled: boolean;
  model: string;
  dailyBudgetMicroUsd: number;
  reason?: string;
};

export function semanticSearchConfig(values: {
  enabled?: string;
  dailyBudgetUsd?: string;
  embeddingModel?: string;
}): SemanticSearchConfig {
  if (values.enabled?.trim().toLowerCase() !== "true") {
    return {
      enabled: false,
      model: OPENROUTER_EMBEDDING_MODEL,
      dailyBudgetMicroUsd: 0,
      reason: "SEMANTIC_SEARCH_ENABLED is not true.",
    };
  }
  const configuredModel = values.embeddingModel?.trim() || OPENROUTER_EMBEDDING_MODEL;
  // Pricing and vector dimensions are a security boundary: do not silently
  // route to an unpriced model or mix incompatible vectors in one namespace.
  if (configuredModel !== OPENROUTER_EMBEDDING_MODEL) {
    return {
      enabled: false,
      model: configuredModel,
      dailyBudgetMicroUsd: 0,
      reason: "The configured embedding model has no approved price/dimension profile.",
    };
  }
  const rawBudget = values.dailyBudgetUsd?.trim();
  const budgetUsd = rawBudget === undefined || rawBudget === ""
    ? DEFAULT_DAILY_BUDGET_USD
    : Number(rawBudget);
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0 || budgetUsd > 5) {
    return {
      enabled: false,
      model: configuredModel,
      dailyBudgetMicroUsd: 0,
      reason: "SEMANTIC_SEARCH_DAILY_BUDGET_USD must be between 0 and 5.",
    };
  }
  return {
    enabled: true,
    model: configuredModel,
    dailyBudgetMicroUsd: Math.round(budgetUsd * 1_000_000),
  };
}

function config() {
  // Generated environment bindings update at deployment time. The cast keeps
  // this isolated worktree type-checkable before that code generation step.
  const semanticEnv = env as unknown as Record<string, string | undefined>;
  return semanticSearchConfig({
    enabled: semanticEnv.SEMANTIC_SEARCH_ENABLED,
    dailyBudgetUsd: semanticEnv.SEMANTIC_SEARCH_DAILY_BUDGET_USD,
    embeddingModel: semanticEnv.SEMANTIC_SEARCH_EMBEDDING_MODEL,
  });
}

function requireEnabledConfig() {
  const value = config();
  if (!value.enabled) {
    throw new ConvexError({
      code: "SEMANTIC_SEARCH_DISABLED",
      message: value.reason ?? "Semantic search is disabled.",
    });
  }
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new ConvexError({
      code: "SEMANTIC_SEARCH_UNAVAILABLE",
      message: "OpenRouter is not configured for semantic search.",
    });
  }
  return { ...value, apiKey };
}

function platform(apiKey: string, model: string) {
  const openRouter = createOpenAICompatible({
    name: "openrouter",
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    headers: {
      "HTTP-Referer": "https://www.symbaiex.com",
      "X-OpenRouter-Title": "SYMBaiEX Public Evidence Search",
    },
  });
  return new RAG<Record<string, never>, SemanticMetadata>(components.rag, {
    embeddingDimension: 1536,
    textEmbeddingModel: openRouter.embeddingModel(model),
    filterNames: [],
  });
}

function normalizedText(value: string, maximum: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function fingerprint(document: Pick<IndexDocument, "updatedAt" | "sourceUpdatedAt">) {
  return `${document.updatedAt}:${document.sourceUpdatedAt}`;
}

function estimatedInputTokens(text: string) {
  // Conservative reservation: three UTF-16 chars per token is intentionally
  // lower than typical English prose, leaving headroom for tokenization.
  return Math.ceil(text.length / 3);
}

function dayKey(timestamp = Date.now()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

export const readPublicDocumentForIndex = internalQuery({
  args: {
    documentId: v.id("evidenceDocuments"),
    embeddingModel: v.string(),
  },
  handler: async (ctx, args): Promise<IndexDocument | null> => {
    const document = await ctx.db.get("evidenceDocuments", args.documentId);
    if (document === null || document.visibility !== "public") return null;
    const source = await ctx.db.get("evidenceSources", document.sourceId);
    if (
      source === null ||
      source.visibility !== "public" ||
      source.status !== "active"
    ) return null;
    const indexed = await ctx.db
      .query("aiOperationalStates")
      .withIndex("by_key", (q) =>
        q.eq(
          "key",
          `semantic-index:${document._id}:${document.updatedAt}:${source.updatedAt}:${args.embeddingModel}`,
        ),
      )
      .unique();
    return {
      documentId: document._id,
      sourceId: document.sourceId,
      title: document.title,
      excerpt: document.excerpt,
      searchText: document.searchText,
      tags: document.tags,
      authors: document.authors,
      updatedAt: document.updatedAt,
      sourceUpdatedAt: source.updatedAt,
      alreadyIndexed: indexed?.healthy === true,
    };
  },
});

export const readPublicBackfillPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("evidenceDocuments")
      .withIndex("by_visibility_and_updatedAt", (q) => q.eq("visibility", "public"))
      .order("asc")
      .paginate({ numItems: MAX_BACKFILL_PAGE, cursor: args.cursor ?? null });
    return {
      documentIds: page.page.map((document) => document._id),
      continueCursor: page.isDone ? undefined : page.continueCursor,
      done: page.isDone,
    };
  },
});

export const writeBackfillState = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    completed: v.boolean(),
    processed: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const current = await ctx.db
      .query("optimizationMigrations")
      .withIndex("by_key", (q) => q.eq("key", BACKFILL_KEY))
      .unique();
    const value = {
      status: args.completed ? ("completed" as const) : ("running" as const),
      processed: (current?.processed ?? 0) + args.processed,
      updatedAt: now,
      ...(args.completed ? { completedAt: now } : {}),
    };
    if (current === null) {
      await ctx.db.insert("optimizationMigrations", { key: BACKFILL_KEY, ...value });
    } else {
      await ctx.db.patch("optimizationMigrations", current._id, value);
    }
    const stateKey = `${BACKFILL_KEY}:cursor`;
    const state = await ctx.db
      .query("aiOperationalStates")
      .withIndex("by_key", (q) => q.eq("key", stateKey))
      .unique();
    const stateValue = {
      key: stateKey,
      healthy: args.completed,
      provider: "internal",
      model: "cursor-v1",
      // Convex pagination cursors are opaque. They are stored only as an
      // operational checkpoint and are never returned by public search.
      detail: args.cursor ?? "",
      checkedAt: now,
      pauseUntil: 0,
      updatedAt: now,
    };
    if (state === null) await ctx.db.insert("aiOperationalStates", stateValue);
    else await ctx.db.patch("aiOperationalStates", state._id, stateValue);
    return null;
  },
});

export const readBackfillState = internalQuery({
  args: {},
  handler: async (ctx) => {
    const [migration, state] = await Promise.all([
      ctx.db
        .query("optimizationMigrations")
        .withIndex("by_key", (q) => q.eq("key", BACKFILL_KEY))
        .unique(),
      ctx.db
        .query("aiOperationalStates")
        .withIndex("by_key", (q) => q.eq("key", `${BACKFILL_KEY}:cursor`))
        .unique(),
    ]);
    if (migration === null) return null;
    return {
      cursor: state?.detail || undefined,
      completed: migration.status === "completed",
    };
  },
});

export const recordUsage = internalMutation({
  args: {
    inputTokens: v.number(),
    estimatedMicroUsd: v.number(),
    model: v.string(),
    outcome: v.union(v.literal("completed"), v.literal("failed")),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const key = `${SEMANTIC_HEALTH_KEY}:${args.model}`;
    const existing = await ctx.db
      .query("aiOperationalStates")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const next = {
      key,
      healthy: args.outcome === "completed",
      provider: "openrouter",
      model: args.model,
      detail: args.detail.slice(0, 240),
      checkedAt: now,
      pauseUntil: args.outcome === "completed" ? 0 : now + PAUSE_AFTER_FAILURE_MS,
      updatedAt: now,
    };
    if (existing === null) await ctx.db.insert("aiOperationalStates", next);
    else await ctx.db.patch("aiOperationalStates", existing._id, next);
    return null;
  },
});

/**
 * Reserve the conservative embedding cost before making an external request.
 * Bucket 15 is intentionally outside the eight shared editorial buckets, so
 * the feature cap is transactionally isolated while the normal global
 * OpenRouter circuit remains an additional guard.
 */
export const reserveUsage = internalMutation({
  args: {
    estimatedMicroUsd: v.number(),
    inputTokens: v.number(),
    model: v.string(),
    dailyBudgetMicroUsd: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const day = dayKey(now);
    const bucket = 15;
    const spend = await ctx.db
      .query("aiSpendBuckets")
      .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
        q.eq("dayKey", day).eq("provider", "openrouter").eq("bucket", bucket),
      )
      .unique();
    if (
      args.estimatedMicroUsd <= 0 ||
      args.inputTokens <= 0 ||
      !Number.isSafeInteger(args.dailyBudgetMicroUsd) ||
      args.dailyBudgetMicroUsd <= 0 ||
      (spend?.spentMicroUsd ?? 0) + args.estimatedMicroUsd > args.dailyBudgetMicroUsd
    ) {
      return { accepted: false };
    }
    if (spend === null) {
      await ctx.db.insert("aiSpendBuckets", {
        dayKey: day,
        provider: "openrouter",
        bucket,
        spentMicroUsd: args.estimatedMicroUsd,
        requests: 1,
        inputTokens: args.inputTokens,
        outputTokens: 0,
        updatedAt: now,
      });
    } else {
      await ctx.db.patch("aiSpendBuckets", spend._id, {
        spentMicroUsd: spend.spentMicroUsd + args.estimatedMicroUsd,
        requests: spend.requests + 1,
        inputTokens: spend.inputTokens + args.inputTokens,
        updatedAt: now,
      });
    }
    return { accepted: true };
  },
});

export const readCurrentPublicCandidates = internalQuery({
  args: {
    candidates: v.array(v.object({ documentId: v.id("evidenceDocuments"), score: v.number() })),
  },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.candidates.map(async (candidate) => {
        const document = await ctx.db.get("evidenceDocuments", candidate.documentId);
        if (document === null || document.visibility !== "public") return null;
        const source = await ctx.db.get("evidenceSources", document.sourceId);
        if (source === null || source.visibility !== "public" || source.status !== "active") return null;
        try {
          const url = new URL(document.canonicalUrl);
          if (url.protocol !== "https:") return null;
        } catch {
          return null;
        }
        return {
          documentId: document._id,
          title: document.title,
          excerpt: document.excerpt.slice(0, 600),
          canonicalUrl: document.canonicalUrl,
          updatedAt: document.updatedAt,
          publishedAt: document.publishedAt,
          score: candidate.score,
        };
      }),
    );
    return rows.filter((row): row is NonNullable<typeof row> => row !== null);
  },
});

export const indexPublicEvidenceDocument = internalAction({
  args: { documentId: v.id("evidenceDocuments") },
  handler: async (ctx, args) => {
    const settings = requireEnabledConfig();
    const document = await ctx.runQuery(readDocumentRef, {
      documentId: args.documentId,
      embeddingModel: settings.model,
    });
    if (document === null) return { status: "skipped" as const, reason: "not_public" };
    if (document.alreadyIndexed) return { status: "skipped" as const, reason: "idempotent" };

    const text = normalizedText(
      [document.title, document.excerpt, document.searchText, document.tags.join(" "), document.authors.join(" ")]
        .filter(Boolean)
        .join("\n\n"),
      MAX_SOURCE_TEXT_CHARS,
    );
    if (!text) return { status: "skipped" as const, reason: "empty" };
    const reservedTokens = estimatedInputTokens(text);
    const reservedMicroUsd = estimatedModelCostMicroUsd(settings.model, reservedTokens, 0);
    const controls = await ctx.runQuery(internal.aiRoutingControlData.readRoutingControl, {
      dayKey: dayKey(),
      budgetLimitMicroUsd: Math.min(
        settings.dailyBudgetMicroUsd,
        openRouterDailyBudgetMicroUsd(env.OPENROUTER_DAILY_BUDGET_USD),
      ),
      now: Date.now(),
    });
    if (controls.paidBudgetExceeded) {
      return { status: "skipped" as const, reason: "budget" };
    }
    const reservation = await ctx.runMutation(reserveUsageRef, {
      estimatedMicroUsd: reservedMicroUsd,
      inputTokens: reservedTokens,
      model: settings.model,
      dailyBudgetMicroUsd: settings.dailyBudgetMicroUsd,
    });
    if (!reservation.accepted) return { status: "skipped" as const, reason: "budget" };
    const rag = platform(settings.apiKey, settings.model);
    const key = `evidence-document:${document.documentId}`;
    try {
      const result = await rag.add(ctx, {
        namespace: NAMESPACE,
        key,
        title: document.title.slice(0, 500),
        text,
        metadata: {
          documentId: document.documentId,
          sourceId: document.sourceId,
          fingerprint: fingerprint(document),
        },
        filterValues: [],
      });
      const inputTokens = result.usage.tokens;
      await ctx.runMutation(recordUsageRef, {
        inputTokens,
        model: settings.model,
        outcome: "completed",
        detail: `Indexed public evidence ${document.documentId}.`,
      });
      await ctx.runMutation(internal.aiRoutingControlData.recordOperationalState, {
        key: `semantic-index:${document.documentId}:${document.updatedAt}:${document.sourceUpdatedAt}:${settings.model}`,
        healthy: true,
        provider: "openrouter",
        model: settings.model,
        detail: "Current public evidence document embedded.",
        pauseUntil: 0,
      });
      return { status: result.status, created: result.created, inputTokens };
    } catch (error) {
      await ctx.runMutation(recordUsageRef, {
        inputTokens: 0,
        model: settings.model,
        outcome: "failed",
        detail: safeError(error),
      });
      return { status: "failed" as const, reason: "provider" };
    }
  },
});

export const backfillPublicEvidence = internalAction({
  args: { cursor: v.optional(v.string()), restart: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const settings = config();
    if (!settings.enabled) return { enabled: false, indexed: 0, done: false, reason: settings.reason };
    const state =
      args.cursor === undefined && !args.restart
        ? await ctx.runQuery(readBackfillStateRef, {})
        : null;
    if (state?.completed && state.cursor === undefined) {
      return { enabled: true, indexed: 0, done: true };
    }
    const cursor = args.restart ? undefined : (args.cursor ?? state?.cursor);
    const page = await ctx.runQuery(readBackfillPageRef, cursor === undefined ? {} : { cursor });
    let indexed = 0;
    for (const documentId of page.documentIds) {
      const result = await ctx.runAction(indexDocumentRef, { documentId });
      if (result.status === "created" || result.status === "updated") indexed += 1;
    }
    await ctx.runMutation(writeBackfillStateRef, {
      cursor: page.continueCursor,
      completed: page.done,
      processed: page.documentIds.length,
    });
    if (!page.done && page.continueCursor !== undefined) {
      await ctx.scheduler.runAfter(5_000, backfillRef, { cursor: page.continueCursor });
    }
    return { enabled: true, indexed, done: page.done, cursor: page.continueCursor };
  },
});

export const searchPublicSemantic = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const settings = requireEnabledConfig();
    const query = normalizedText(args.query, MAX_QUERY_CHARS);
    if (!query) throw new ConvexError({ code: "INVALID_REQUEST", message: "query is required." });
    const limit = args.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new ConvexError({ code: "INVALID_REQUEST", message: "limit must be an integer between 1 and 20." });
    }
    const rag = platform(settings.apiKey, settings.model);
    const reservedTokens = estimatedInputTokens(query);
    const reservation = await ctx.runMutation(reserveUsageRef, {
      estimatedMicroUsd: estimatedModelCostMicroUsd(settings.model, reservedTokens, 0),
      inputTokens: reservedTokens,
      model: settings.model,
      dailyBudgetMicroUsd: settings.dailyBudgetMicroUsd,
    });
    if (!reservation.accepted) return [];
    try {
      const result = await rag.search(ctx, {
        namespace: NAMESPACE,
        query,
        limit: Math.min(MAX_SEMANTIC_CANDIDATES, limit * 3),
        vectorScoreThreshold: 0.58,
        searchType: "vector",
      });
      const inputTokens = result.usage.tokens;
      await ctx.runMutation(recordUsageRef, {
        inputTokens,
        model: settings.model,
        outcome: "completed",
        detail: `Semantic retrieval returned ${result.entries.length} candidates.`,
      });
      const scores = new Map<string, number>();
      for (const match of result.results) scores.set(match.entryId, Math.max(scores.get(match.entryId) ?? 0, match.score));
      const candidates = result.entries.flatMap((entry) => {
        const id = entry.metadata?.documentId;
        if (id === undefined) return [];
        return [{ documentId: id as Id<"evidenceDocuments">, score: scores.get(entry.entryId) ?? 0 }];
      }).slice(0, MAX_SEMANTIC_CANDIDATES);
      return await ctx.runQuery(readCandidatesRef, { candidates });
    } catch (error) {
      await ctx.runMutation(recordUsageRef, {
        inputTokens: 0,
        model: settings.model,
        outcome: "failed",
        detail: safeError(error),
      });
      // Explicitly fail closed. Callers retain lexical results rather than
      // receiving unverified/stale vector content.
      return [];
    }
  },
});

/**
 * Action-capable callers can opt into a hybrid result without changing the
 * existing lexical query contract. Lexical hits retain their established rank;
 * currently-authorized semantic-only evidence is appended deterministically.
 */
export const searchHybridPublic = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 20;
    const lexical = await ctx.runQuery(internal.universalSearch.searchPublic, {
      query: args.query,
      limit,
    });
    if (!config().enabled || lexical.length >= limit) return lexical;
    let semantic: Awaited<ReturnType<typeof ctx.runAction<typeof searchSemanticRef>>>;
    try {
      semantic = await ctx.runAction(searchSemanticRef, {
        query: args.query,
        limit: Math.min(20, limit - lexical.length),
      });
    } catch {
      // Semantic is an enhancement only. Preserve the lexical response if an
      // operator disables the feature between the first check and this call.
      return lexical;
    }
    const knownUrls = new Set(lexical.map((result) => result.canonicalUrl));
    const semanticOnly = semantic
      .filter((result) => !knownUrls.has(result.canonicalUrl))
      .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
      .map((result) => ({
        type: "evidence_document" as const,
        canonicalUrl: result.canonicalUrl,
        title: result.title,
        excerpt: result.excerpt,
        visibility: "public" as const,
        score: result.score,
        scoreExplanation: ["semantic similarity", "live public-source authorization"],
        rankSignals: {
          matchedTerms: 0,
          titleTerms: 0,
          phraseMatch: false,
          citationCount: 0,
          recencyDays: Math.max(0, Math.floor((Date.now() - result.updatedAt) / 86_400_000)),
        },
        updatedAt: result.updatedAt,
        publishedAt: result.publishedAt,
        provenance: {
          recordId: result.documentId,
          documentId: result.documentId,
          citationIds: [],
        },
      }));
    return [...lexical, ...semanticOnly].slice(0, limit);
  },
});
