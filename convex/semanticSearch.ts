import { RAG } from "@convex-dev/rag";
import { embedRagQuery, embedRagText } from "./ragEmbeddings";
import { getPublicEvidenceSource } from "./evidenceVisibility";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  forumDayKey,
  estimatedModelCostMicroUsd,
  openRouterDailyBudgetMicroUsd,
} from "../lib/ai-model-costs";
import {
  semanticSearchConfig,
  type SemanticSearchConfig,
} from "../lib/semantic-search-config";
import {
  isKnownOpenRouterSpendBucket,
  OPENROUTER_SPEND_BUCKETS,
} from "./aiRoutingControlData";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  env,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

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
const MAX_LEGACY_INDEX_MARKERS = 50;
const BACKFILL_KEY = "semantic-search-public-evidence-v1";
const SEMANTIC_HEALTH_KEY = "semantic-search-public-evidence";
const PAUSE_AFTER_FAILURE_MS = 15 * 60_000;
const PROVIDER_TIMEOUT_MS = 12_000;
const MAX_PROVIDER_RESPONSE_BYTES = 512 * 1024;
const LEASE_MS = 60_000;
const QUERY_OPERATION_RETENTION_MS = 15 * 60_000;
const OPERATION_CLEANUP_LIMIT = 100;
// The bounded range read below asks for one more row than the registered
// namespace permits. A legacy or accidental bucket therefore rejects admission
// instead of silently escaping the global cap.
const MAX_OPENROUTER_SPEND_BUCKETS = OPENROUTER_SPEND_BUCKETS.length + 1;

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
  legacyMarkerId?: Id<"aiOperationalStates">;
};

type SemanticCandidate = {
  documentId: Id<"evidenceDocuments">;
  score: number;
  fingerprint: string;
};

type UniversalResult = {
  type:
    | "evidence_document"
    | "evidence_claim"
    | "evidence_entity"
    | "blog_post"
    | "newsletter_issue"
    | "news_story"
    | "forum_thread";
  canonicalUrl: string;
  title: string;
  excerpt: string;
  visibility: "public";
  score: number;
  scoreExplanation: string[];
  rankSignals: {
    matchedTerms: number;
    titleTerms: number;
    phraseMatch: boolean;
    citationCount: number;
    recencyDays: number;
  };
  updatedAt: number;
  publishedAt: number | null;
  provenance: {
    recordId: string;
    sourceId?: string;
    documentId?: string;
    documentVersionId?: string;
    claimId?: string;
    entityId?: string;
    citationIds: string[];
  };
};

const readIndexPreflightRef = makeFunctionReference<
  "query",
  {
    documentId: Id<"evidenceDocuments">;
    embeddingModel: string;
    now: number;
    allowPriorSourceRevision?: boolean;
  },
  {
    available: boolean;
    reason?: string;
    document: IndexDocument | null;
  }
>("semanticSearch:readIndexPreflight");
const readBackfillPageRef = makeFunctionReference<
  "query",
  { cursor?: string },
  {
    documentIds: Id<"evidenceDocuments">[];
    continueCursor?: string;
    done: boolean;
  }
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
    operationKey: string;
    inputTokens: number;
    settledMicroUsd: number;
    model: string;
    outcome: "completed" | "failed";
    detail: string;
    indexMarker?: { key: string; detail: string };
  },
  null
>("semanticSearch:recordUsage");
const migrateLegacyIndexMarkerRef = makeFunctionReference<
  "mutation",
  {
    markerId: Id<"aiOperationalStates">;
    documentId: Id<"evidenceDocuments">;
    documentUpdatedAt: number;
    model: string;
  },
  null
>("semanticSearch:migrateLegacyIndexMarker");
const reserveUsageRef = makeFunctionReference<
  "mutation",
  {
    operationKey: string;
    kind: "index" | "query";
    fingerprint: string;
    holder: string;
    estimatedMicroUsd: number;
    inputTokens: number;
    model: string;
    dailyBudgetMicroUsd: number;
    globalDailyBudgetMicroUsd: number;
  },
  { accepted: boolean; replay: boolean }
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
const readCleanupEligibilityRef = makeFunctionReference<
  "query",
  { documentIds: Id<"evidenceDocuments">[] },
  { eligibleDocumentIds: Id<"evidenceDocuments">[] }
>("semanticSearch:readEvidenceVectorCleanupEligibility");
const invalidateIndexMarkersRef = makeFunctionReference<
  "mutation",
  { documentIds: Id<"evidenceDocuments">[]; model: string },
  null
>("semanticSearch:invalidateEvidenceVectorMarkers");
const indexDocumentRef = makeFunctionReference<
  "action",
  {
    documentId: Id<"evidenceDocuments">;
    allowPriorSourceRevision?: boolean;
  },
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
  {
    results: Array<{
      documentId: Id<"evidenceDocuments">;
      title: string;
      excerpt: string;
      canonicalUrl: string;
      updatedAt: number;
      publishedAt: number | null;
      score: number;
    }>;
    semanticAttempted: boolean;
    semanticUsed: boolean;
    outcome:
      "completed" | "circuit_paused" | "budget_rejected" | "provider_failed";
  }
>("semanticSearch:searchPublicSemantic");
const lexicalSearchRef = makeFunctionReference<
  "query",
  { query: string; limit?: number },
  UniversalResult[]
>("universalSearch:searchPublic");
const cleanupRef = makeFunctionReference<
  "mutation",
  { now?: number },
  { failed: number; deleted: number; hasMore: boolean }
>("semanticSearch:cleanupExpiredOperations");
const availabilityRef = makeFunctionReference<
  "query",
  { model: string; now: number },
  { available: boolean; reason?: string }
>("semanticSearch:readAvailability");

export { semanticSearchConfig };
export type { SemanticSearchConfig };

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
    fetch: async (input, init) => {
      const signal = AbortSignal.any([
        init?.signal ?? new AbortController().signal,
        AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      ]);
      const response = await fetch(input, {
        ...init,
        redirect: "error",
        signal,
      });
      const length = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(length) && length > MAX_PROVIDER_RESPONSE_BYTES) {
        response.body?.cancel();
        throw new Error(
          "OpenRouter embedding response exceeded the 512 KiB bound.",
        );
      }
      if (response.body === null) return response;
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > MAX_PROVIDER_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error(
              "OpenRouter embedding response exceeded the 512 KiB bound.",
            );
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    },
  });
  const embeddingModel = openRouter.embeddingModel(model);
  const rag = new RAG<Record<string, never>, SemanticMetadata>(components.rag, {
    embeddingDimension: 1536,
    textEmbeddingModel: embeddingModel,
    filterNames: [],
  });
  return { rag, embeddingModel };
}

function normalizedText(value: string, maximum: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maximum);
}

function fingerprint(
  document: Pick<IndexDocument, "updatedAt" | "sourceUpdatedAt">,
) {
  return `${document.updatedAt}:${document.sourceUpdatedAt}`;
}

function contentIndexMarkerKey(
  documentId: Id<"evidenceDocuments">,
  documentUpdatedAt: number,
  model: string,
) {
  return `semantic-index-content:${documentId}:${documentUpdatedAt}:${model}`;
}

export function isCurrentFingerprint(
  candidateFingerprint: string,
  documentUpdatedAt: number,
) {
  // Source visibility/status is rechecked against primary records below.
  // Source metadata does not change the embedded document text; accepting an
  // older source revision also keeps vectors written by the previous format.
  return (
    candidateFingerprint === `${documentUpdatedAt}` ||
    candidateFingerprint.startsWith(`${documentUpdatedAt}:`)
  );
}

function estimatedInputTokens(text: string) {
  // Reservation intentionally exceeds normal tokenizer ratios. This keeps the
  // budget hard even for punctuation-heavy or non-ASCII public text; unused
  // microdollars are reconciled after the provider returns.
  return Math.max(1, text.length * 2);
}

export function dayKey(timestamp = Date.now()) {
  // Semantic embeddings and routed model calls share one OpenRouter budget
  // window; using UTC here would let the same local day spend into two buckets.
  return forumDayKey(timestamp);
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

function operationKey(kind: "index" | "query", key: string, model: string) {
  return `semantic:${kind}:${model}:${key}`;
}

function operationHolder() {
  return crypto.randomUUID();
}

function semanticBucket() {
  return 15;
}

export function settlementLocation(operation: {
  reservationDayKey: string;
  reservationBucket: number;
}) {
  return {
    dayKey: operation.reservationDayKey,
    bucket: operation.reservationBucket,
  };
}

export function settlementDelta(
  reservedMicroUsd: number,
  actualMicroUsd: number,
) {
  return Math.max(0, actualMicroUsd) - Math.max(0, reservedMicroUsd);
}

function isSafeNonNegativeInteger(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

function hasValidSpendCounters(spend: Doc<"aiSpendBuckets">) {
  return (
    isSafeNonNegativeInteger(spend.spentMicroUsd) &&
    isSafeNonNegativeInteger(spend.requests) &&
    isSafeNonNegativeInteger(spend.inputTokens) &&
    isSafeNonNegativeInteger(spend.outputTokens)
  );
}

async function publicDocumentForIndex(
  ctx: QueryCtx,
  args: {
    documentId: Id<"evidenceDocuments">;
    embeddingModel: string;
    allowPriorSourceRevision?: boolean;
  },
): Promise<IndexDocument | null> {
  const document = await ctx.db.get("evidenceDocuments", args.documentId);
  if (document === null) return null;
  const source = await getPublicEvidenceSource(ctx, document);
  if (source === null) return null;
  const contentMarkerKey = contentIndexMarkerKey(
    document._id,
    document.updatedAt,
    args.embeddingModel,
  );
  const contentMarker = await ctx.db
    .query("aiOperationalStates")
    .withIndex("by_key", (q) => q.eq("key", contentMarkerKey))
    .unique();
  let legacyMarker: Doc<"aiOperationalStates"> | undefined;
  if (contentMarker?.healthy !== true && args.allowPriorSourceRevision) {
    const legacyPrefix = `semantic-index:${document._id}:${document.updatedAt}:`;
    const legacyMarkers = await ctx.db
      .query("aiOperationalStates")
      .withIndex("by_key", (q) =>
        q.gte("key", legacyPrefix).lt("key", `${legacyPrefix}\uffff`),
      )
      .order("desc")
      .take(MAX_LEGACY_INDEX_MARKERS);
    legacyMarker = legacyMarkers.find(
      (marker) =>
        marker.healthy && marker.key.endsWith(`:${args.embeddingModel}`),
    );
  }
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
    alreadyIndexed:
      contentMarker?.healthy === true || legacyMarker !== undefined,
    ...(legacyMarker === undefined ? {} : { legacyMarkerId: legacyMarker._id }),
  };
}

export const readPublicDocumentForIndex = internalQuery({
  args: {
    documentId: v.id("evidenceDocuments"),
    embeddingModel: v.string(),
  },
  handler: publicDocumentForIndex,
});

export const readPublicBackfillPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("evidenceDocuments")
      .withIndex("by_visibility_and_updatedAt", (q) =>
        q.eq("visibility", "public"),
      )
      .order("asc")
      .paginate({ numItems: MAX_BACKFILL_PAGE, cursor: args.cursor ?? null });
    return {
      documentIds: page.page.map((document) => document._id),
      continueCursor: page.isDone ? undefined : page.continueCursor,
      done: page.isDone,
    };
  },
});

/** Source-scoped pages let a reactivated public source catch up without scanning the corpus. */
export const readPublicSourceBackfillPage = internalQuery({
  args: {
    sourceId: v.id("evidenceSources"),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const source = await ctx.db.get("evidenceSources", args.sourceId);
    if (source?.status !== "active" || source.visibility !== "public") {
      return { documentIds: [], continueCursor: undefined, done: true };
    }

    const page = await ctx.db
      .query("evidenceDocuments")
      .withIndex("by_sourceId_and_visibility_and_updatedAt", (q) =>
        q.eq("sourceId", args.sourceId).eq("visibility", "public"),
      )
      .order("asc")
      .paginate({ numItems: MAX_BACKFILL_PAGE, cursor: args.cursor ?? null });
    return {
      documentIds: page.page.map((document) => document._id),
      continueCursor: page.isDone ? undefined : page.continueCursor,
      done: page.isDone,
    };
  },
});

/** Source-scoped cleanup reads IDs only and remains bounded after a source is hidden. */
export const readNonPublicSourceVectorCleanupPage = internalQuery({
  args: {
    sourceId: v.id("evidenceSources"),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("evidenceDocuments")
      .withIndex("by_sourceId_and_externalKey", (q) =>
        q.eq("sourceId", args.sourceId),
      )
      .order("asc")
      .paginate({ numItems: MAX_BACKFILL_PAGE, cursor: args.cursor ?? null });
    return {
      documentIds: page.page.map((document) => document._id),
      continueCursor: page.isDone ? undefined : page.continueCursor,
      done: page.isDone,
    };
  },
});

/** One-time bounded scan that selects only rows whose vector must no longer be searchable. */
export const readStalePublicEvidenceVectorCleanupPage = internalQuery({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("evidenceDocuments")
      .order("asc")
      .paginate({ numItems: MAX_BACKFILL_PAGE, cursor: args.cursor ?? null });
    const sources = new Map<
      Id<"evidenceSources">,
      Promise<Doc<"evidenceSources"> | null>
    >();
    const documentIds = (
      await Promise.all(
        page.page.map(async (document) => {
          if (document.visibility !== "public") return document._id;
          let source = sources.get(document.sourceId);
          if (source === undefined) {
            source = ctx.db.get("evidenceSources", document.sourceId);
            sources.set(document.sourceId, source);
          }
          const currentSource = await source;
          return currentSource?.status === "active" &&
            currentSource.visibility === "public"
            ? null
            : document._id;
        }),
      )
    ).filter(
      (documentId): documentId is Id<"evidenceDocuments"> =>
        documentId !== null,
    );
    return {
      documentIds,
      continueCursor: page.isDone ? undefined : page.continueCursor,
      done: page.isDone,
    };
  },
});

export const readEvidenceVectorCleanupEligibility = internalQuery({
  args: {
    documentIds: v.array(v.id("evidenceDocuments")),
  },
  handler: async (ctx, args) => {
    if (args.documentIds.length > MAX_BACKFILL_PAGE) {
      throw new ConvexError({
        code: "INVALID_REQUEST",
        message: `At most ${MAX_BACKFILL_PAGE} evidence vectors may be checked at once.`,
      });
    }
    const sources = new Map<
      Id<"evidenceSources">,
      Promise<Doc<"evidenceSources"> | null>
    >();
    const eligibleDocumentIds = (
      await Promise.all(
        args.documentIds.map(async (documentId) => {
          const document = await ctx.db.get("evidenceDocuments", documentId);
          if (document === null || document.visibility !== "public")
            return null;
          let source = sources.get(document.sourceId);
          if (source === undefined) {
            source = ctx.db.get("evidenceSources", document.sourceId);
            sources.set(document.sourceId, source);
          }
          const currentSource = await source;
          return currentSource?.status === "active" &&
            currentSource.visibility === "public"
            ? documentId
            : null;
        }),
      )
    ).filter(
      (documentId): documentId is Id<"evidenceDocuments"> =>
        documentId !== null,
    );
    return { eligibleDocumentIds };
  },
});

export const invalidateEvidenceVectorMarkers = internalMutation({
  args: {
    documentIds: v.array(v.id("evidenceDocuments")),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.documentIds.length > MAX_BACKFILL_PAGE) {
      throw new ConvexError({
        code: "INVALID_REQUEST",
        message: `At most ${MAX_BACKFILL_PAGE} evidence-vector markers may be invalidated at once.`,
      });
    }
    for (const documentId of args.documentIds) {
      const document = await ctx.db.get("evidenceDocuments", documentId);
      if (document === null) continue;
      const currentMarkerKey = contentIndexMarkerKey(
        document._id,
        document.updatedAt,
        args.model,
      );
      const currentMarker = await ctx.db
        .query("aiOperationalStates")
        .withIndex("by_key", (q) => q.eq("key", currentMarkerKey))
        .unique();
      if (currentMarker !== null)
        await ctx.db.delete("aiOperationalStates", currentMarker._id);

      const legacyPrefix = `semantic-index:${document._id}:${document.updatedAt}:`;
      const legacyMarkers = await ctx.db
        .query("aiOperationalStates")
        .withIndex("by_key", (q) =>
          q.gte("key", legacyPrefix).lt("key", `${legacyPrefix}\uffff`),
        )
        .order("desc")
        .take(MAX_LEGACY_INDEX_MARKERS);
      for (const marker of legacyMarkers) {
        if (marker.key.endsWith(`:${args.model}`))
          await ctx.db.delete("aiOperationalStates", marker._id);
      }
    }
    return null;
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
      await ctx.db.insert("optimizationMigrations", {
        key: BACKFILL_KEY,
        ...value,
      });
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

export function isCircuitAvailable(
  pauseUntil: number | undefined,
  now: number,
) {
  return pauseUntil === undefined || pauseUntil <= now;
}

async function readAvailabilityState(
  ctx: QueryCtx,
  args: { model: string; now: number },
) {
  const state = await ctx.db
    .query("aiOperationalStates")
    .withIndex("by_key", (q) =>
      q.eq("key", `${SEMANTIC_HEALTH_KEY}:${args.model}`),
    )
    .unique();
  return isCircuitAvailable(state?.pauseUntil, args.now)
    ? { available: true as const }
    : {
        available: false as const,
        reason: "Semantic OpenRouter circuit is paused.",
      };
}

export const readAvailability = internalQuery({
  args: { model: v.string(), now: v.number() },
  handler: readAvailabilityState,
});

/** Combine the index action's circuit and document preflight into one call. */
export const readIndexPreflight = internalQuery({
  args: {
    documentId: v.id("evidenceDocuments"),
    embeddingModel: v.string(),
    now: v.number(),
    allowPriorSourceRevision: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const availability = await readAvailabilityState(ctx, {
      model: args.embeddingModel,
      now: args.now,
    });
    if (!availability.available) {
      return { ...availability, document: null };
    }
    return {
      ...availability,
      document: await publicDocumentForIndex(ctx, args),
    };
  },
});

/** Promote a valid old source-revision marker without another embedding call. */
export const migrateLegacyIndexMarker = internalMutation({
  args: {
    markerId: v.id("aiOperationalStates"),
    documentId: v.id("evidenceDocuments"),
    documentUpdatedAt: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const marker = await ctx.db.get("aiOperationalStates", args.markerId);
    const legacyPrefix = `semantic-index:${args.documentId}:${args.documentUpdatedAt}:`;
    if (
      marker === null ||
      !marker.healthy ||
      !marker.key.startsWith(legacyPrefix) ||
      !marker.key.endsWith(`:${args.model}`)
    )
      return null;

    const key = contentIndexMarkerKey(
      args.documentId,
      args.documentUpdatedAt,
      args.model,
    );
    const existing = await ctx.db
      .query("aiOperationalStates")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing === null)
      await ctx.db.patch("aiOperationalStates", marker._id, {
        key,
        provider: "openrouter",
        model: args.model,
        detail: "Current public evidence content embedded.",
        updatedAt: Date.now(),
      });
    else if (!existing.healthy)
      await ctx.db.patch("aiOperationalStates", existing._id, {
        healthy: true,
        provider: "openrouter",
        model: args.model,
        detail: "Current public evidence content embedded.",
        checkedAt: marker.checkedAt,
        pauseUntil: 0,
        updatedAt: Date.now(),
      });
    return null;
  },
});

async function recordSuccessfulIndexMarker(
  ctx: MutationCtx,
  marker: { key: string; detail: string },
  model: string,
  now: number,
) {
  const indexed = await ctx.db
    .query("aiOperationalStates")
    .withIndex("by_key", (q) => q.eq("key", marker.key))
    .unique();
  const indexState = {
    key: marker.key,
    healthy: true,
    provider: "openrouter",
    model,
    detail: marker.detail.slice(0, 240),
    checkedAt: now,
    pauseUntil: 0,
    updatedAt: now,
  };
  if (indexed === null) await ctx.db.insert("aiOperationalStates", indexState);
  else await ctx.db.patch("aiOperationalStates", indexed._id, indexState);
}

export const recordUsage = internalMutation({
  args: {
    operationKey: v.string(),
    inputTokens: v.number(),
    settledMicroUsd: v.number(),
    model: v.string(),
    outcome: v.union(v.literal("completed"), v.literal("failed")),
    detail: v.string(),
    indexMarker: v.optional(v.object({ key: v.string(), detail: v.string() })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const operation = await ctx.db
      .query("semanticSearchOperations")
      .withIndex("by_operationKey", (q) =>
        q.eq("operationKey", args.operationKey),
      )
      .unique();
    // A terminal operation is immutable. This prevents duplicate action retries
    // from settling or charging the same reservation twice.
    if (operation === null || operation.status !== "leased") {
      // The provider action can finish after its lease-recovery mutation has
      // conservatively closed the reservation. Its successful RAG write is
      // still a valid completion marker, so don't make it pay for another
      // embedding on the next enqueue.
      if (
        args.outcome === "completed" &&
        operation?.kind === "index" &&
        args.indexMarker !== undefined
      ) {
        await recordSuccessfulIndexMarker(
          ctx,
          args.indexMarker,
          args.model,
          now,
        );
      }
      return null;
    }
    const actualMicroUsd = Math.max(0, args.settledMicroUsd);
    const delta = settlementDelta(operation.reservedMicroUsd, actualMicroUsd);
    const { dayKey: day, bucket } = settlementLocation(operation);
    const spend = await ctx.db
      .query("aiSpendBuckets")
      .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
        q.eq("dayKey", day).eq("provider", "openrouter").eq("bucket", bucket),
      )
      .unique();
    if (spend !== null && delta !== 0) {
      await ctx.db.patch("aiSpendBuckets", spend._id, {
        // Clamp protects the accounting bucket from a corrupt legacy row.
        spentMicroUsd: Math.max(0, spend.spentMicroUsd + delta),
        inputTokens: Math.max(
          0,
          spend.inputTokens + args.inputTokens - operation.reservedInputTokens,
        ),
        updatedAt: now,
      });
    }
    await ctx.db.patch("semanticSearchOperations", operation._id, {
      status: args.outcome === "completed" ? "completed" : "failed",
      leaseExpiresAt: undefined,
      settledMicroUsd: actualMicroUsd,
      settledInputTokens: args.inputTokens,
      completedAt: args.outcome === "completed" ? now : undefined,
      failedAt: args.outcome === "failed" ? now : undefined,
      updatedAt: now,
    });
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
      pauseUntil:
        args.outcome === "completed" ? 0 : now + PAUSE_AFTER_FAILURE_MS,
      updatedAt: now,
    };
    if (existing === null) await ctx.db.insert("aiOperationalStates", next);
    else await ctx.db.patch("aiOperationalStates", existing._id, next);
    if (
      args.outcome === "completed" &&
      operation.kind === "index" &&
      args.indexMarker !== undefined
    )
      await recordSuccessfulIndexMarker(ctx, args.indexMarker, args.model, now);
    return null;
  },
});

/**
 * Reserve the conservative embedding cost before making an external request.
 * Bucket 15 is intentionally outside the eight shared editorial buckets. The
 * reservation nevertheless reads each bounded OpenRouter spend bucket and
 * admits only when both the feature and global caps have room.
 */
export const reserveUsage = internalMutation({
  args: {
    operationKey: v.string(),
    kind: v.union(v.literal("index"), v.literal("query")),
    fingerprint: v.string(),
    holder: v.string(),
    estimatedMicroUsd: v.number(),
    inputTokens: v.number(),
    model: v.string(),
    dailyBudgetMicroUsd: v.number(),
    globalDailyBudgetMicroUsd: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("semanticSearchOperations")
      .withIndex("by_operationKey", (q) =>
        q.eq("operationKey", args.operationKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.status === "completed")
        return { accepted: false, replay: true };
      if (
        existing.status === "leased" &&
        (existing.leaseExpiresAt ?? 0) > now
      ) {
        return { accepted: false, replay: true };
      }
      // An expired lease is reconciled once before another worker can claim it.
      // The old reservation never survives a crashed worker indefinitely.
      if (existing.status === "leased") {
        const oldBucket = await ctx.db
          .query("aiSpendBuckets")
          .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
            q
              .eq("dayKey", existing.reservationDayKey)
              .eq("provider", "openrouter")
              .eq("bucket", existing.reservationBucket),
          )
          .unique();
        if (oldBucket !== null) {
          await ctx.db.patch("aiSpendBuckets", oldBucket._id, {
            spentMicroUsd: Math.max(
              0,
              oldBucket.spentMicroUsd - existing.reservedMicroUsd,
            ),
            inputTokens: Math.max(
              0,
              oldBucket.inputTokens - existing.reservedInputTokens,
            ),
            requests: Math.max(0, oldBucket.requests - 1),
            updatedAt: now,
          });
        }
      }
      await ctx.db.delete("semanticSearchOperations", existing._id);
    }
    const day = dayKey(now);
    const bucket = semanticBucket();
    const spendBuckets = await ctx.db
      .query("aiSpendBuckets")
      .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
        q.eq("dayKey", day).eq("provider", "openrouter"),
      )
      .take(MAX_OPENROUTER_SPEND_BUCKETS);
    if (
      spendBuckets.length === MAX_OPENROUTER_SPEND_BUCKETS ||
      spendBuckets.some(
        (currentSpend) => !isKnownOpenRouterSpendBucket(currentSpend.bucket),
      )
    ) {
      return { accepted: false, replay: false };
    }
    const semanticSpends = spendBuckets.filter(
      (currentSpend) => currentSpend.bucket === bucket,
    );
    if (semanticSpends.length > 1) return { accepted: false, replay: false };
    const spend = semanticSpends[0] ?? null;
    let totalOpenRouterSpendMicroUsd = 0;
    for (const currentSpend of spendBuckets) {
      if (currentSpend === null) continue;
      if (!hasValidSpendCounters(currentSpend))
        return { accepted: false, replay: false };
      const nextTotal =
        totalOpenRouterSpendMicroUsd + currentSpend.spentMicroUsd;
      if (!Number.isSafeInteger(nextTotal))
        return { accepted: false, replay: false };
      totalOpenRouterSpendMicroUsd = nextTotal;
    }
    const effectiveDailyBudgetMicroUsd = Math.min(
      args.dailyBudgetMicroUsd,
      args.globalDailyBudgetMicroUsd,
    );
    const nextSemanticSpendMicroUsd =
      (spend?.spentMicroUsd ?? 0) + args.estimatedMicroUsd;
    const nextSemanticInputTokens =
      (spend?.inputTokens ?? 0) + args.inputTokens;
    const nextSemanticRequests = (spend?.requests ?? 0) + 1;
    const nextOpenRouterSpendMicroUsd =
      totalOpenRouterSpendMicroUsd + args.estimatedMicroUsd;
    if (
      !Number.isSafeInteger(args.estimatedMicroUsd) ||
      args.estimatedMicroUsd <= 0 ||
      !Number.isSafeInteger(args.inputTokens) ||
      args.inputTokens <= 0 ||
      !Number.isSafeInteger(args.dailyBudgetMicroUsd) ||
      args.dailyBudgetMicroUsd <= 0 ||
      !Number.isSafeInteger(args.globalDailyBudgetMicroUsd) ||
      args.globalDailyBudgetMicroUsd <= 0 ||
      !Number.isSafeInteger(effectiveDailyBudgetMicroUsd) ||
      effectiveDailyBudgetMicroUsd <= 0 ||
      !Number.isSafeInteger(nextSemanticSpendMicroUsd) ||
      !Number.isSafeInteger(nextSemanticInputTokens) ||
      !Number.isSafeInteger(nextSemanticRequests) ||
      !Number.isSafeInteger(nextOpenRouterSpendMicroUsd) ||
      nextSemanticSpendMicroUsd > args.dailyBudgetMicroUsd ||
      nextOpenRouterSpendMicroUsd > effectiveDailyBudgetMicroUsd
    ) {
      return { accepted: false, replay: false };
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
        spentMicroUsd: nextSemanticSpendMicroUsd,
        requests: nextSemanticRequests,
        inputTokens: nextSemanticInputTokens,
        updatedAt: now,
      });
    }
    const operationId = await ctx.db.insert("semanticSearchOperations", {
      operationKey: args.operationKey,
      kind: args.kind,
      fingerprint: args.fingerprint,
      model: args.model,
      status: "leased",
      holder: args.holder,
      leaseExpiresAt: now + LEASE_MS,
      reservationDayKey: day,
      reservationBucket: bucket,
      reservedMicroUsd: args.estimatedMicroUsd,
      reservedInputTokens: args.inputTokens,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      LEASE_MS + 1,
      makeFunctionReference<"mutation">("semanticSearch:recoverOperationLease"),
      { operationId },
    );
    return { accepted: true, replay: false };
  },
});

async function failExpiredOperation(
  ctx: MutationCtx,
  operation: Doc<"semanticSearchOperations">,
  now: number,
) {
  if (
    operation.status !== "leased" ||
    operation.leaseExpiresAt === undefined ||
    operation.leaseExpiresAt > now
  )
    return false;
  await ctx.db.patch("semanticSearchOperations", operation._id, {
    // An interrupted action may already have reached the provider. Retain the
    // estimate rather than refunding an ambiguous, potentially billable call.
    status: "failed",
    leaseExpiresAt: undefined,
    settledMicroUsd: operation.reservedMicroUsd,
    settledInputTokens: operation.reservedInputTokens,
    failedAt: now,
    updatedAt: now,
  });
  return true;
}

export const recoverOperationLease = internalMutation({
  args: { operationId: v.id("semanticSearchOperations") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(
      "semanticSearchOperations",
      args.operationId,
    );
    if (operation !== null)
      await failExpiredOperation(ctx, operation, Date.now());
    return null;
  },
});

/** Hourly safety net for legacy leases and bounded query-record retention. */
export const cleanupExpiredOperations = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const expired = await ctx.db
      .query("semanticSearchOperations")
      .withIndex("by_status_and_leaseExpiresAt", (q) =>
        q.eq("status", "leased").lte("leaseExpiresAt", now),
      )
      .order("asc")
      .take(OPERATION_CLEANUP_LIMIT);
    let failed = 0;
    for (const operation of expired)
      if (await failExpiredOperation(ctx, operation, now)) failed += 1;
    let deleted = 0;
    for (const status of ["completed", "failed", "refunded"] as const) {
      const rows = await ctx.db
        .query("semanticSearchOperations")
        .withIndex("by_kind_and_status_and_updatedAt", (q) =>
          q
            .eq("kind", "query")
            .eq("status", status)
            .lte("updatedAt", now - QUERY_OPERATION_RETENTION_MS),
        )
        .order("asc")
        .take(OPERATION_CLEANUP_LIMIT - deleted);
      for (const row of rows) {
        await ctx.db.delete("semanticSearchOperations", row._id);
        deleted += 1;
      }
      if (deleted >= OPERATION_CLEANUP_LIMIT) break;
    }
    const hasMore =
      expired.length === OPERATION_CLEANUP_LIMIT ||
      deleted === OPERATION_CLEANUP_LIMIT;
    if (hasMore) await ctx.scheduler.runAfter(1_000, cleanupRef, { now });
    return { failed, deleted, hasMore };
  },
});

export const readCurrentPublicCandidates = internalQuery({
  args: {
    candidates: v.array(
      v.object({
        documentId: v.id("evidenceDocuments"),
        score: v.number(),
        fingerprint: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const rows = await Promise.all(
      args.candidates.map(async (candidate) => {
        const document = await ctx.db.get(
          "evidenceDocuments",
          candidate.documentId,
        );
        if (document === null) return null;
        const source = await getPublicEvidenceSource(ctx, document);
        if (source === null) return null;
        if (!isCurrentFingerprint(candidate.fingerprint, document.updatedAt))
          return null;
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

export const hasPublicEvidenceIndexNamespace = internalAction({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const settings = config();
    const { rag } = platform(
      env.OPENROUTER_API_KEY?.trim() || "semantic-index-cleanup-only",
      settings.model,
    );
    return (await rag.getNamespace(ctx, { namespace: NAMESPACE })) !== null;
  },
});

/** Recheck live authorization before deleting stale vector entries. */
export const removeNonPublicEvidenceDocuments = internalAction({
  args: { documentIds: v.array(v.id("evidenceDocuments")) },
  returns: v.object({ attempted: v.number(), skipped: v.number() }),
  handler: async (ctx, args) => {
    const documentIds = [...new Set(args.documentIds)];
    if (documentIds.length > MAX_BACKFILL_PAGE) {
      throw new ConvexError({
        code: "INVALID_REQUEST",
        message: `At most ${MAX_BACKFILL_PAGE} evidence vectors may be removed at once.`,
      });
    }
    if (documentIds.length === 0) return { attempted: 0, skipped: 0 };

    const { eligibleDocumentIds } = await ctx.runQuery(
      readCleanupEligibilityRef,
      { documentIds },
    );
    const eligible = new Set(eligibleDocumentIds);
    const ineligibleDocumentIds = documentIds.filter(
      (documentId) => !eligible.has(documentId),
    );
    if (ineligibleDocumentIds.length === 0)
      return { attempted: 0, skipped: documentIds.length };

    const settings = config();
    const { rag } = platform(
      env.OPENROUTER_API_KEY?.trim() || "semantic-index-cleanup-only",
      settings.model,
    );
    const namespace = await rag.getNamespace(ctx, { namespace: NAMESPACE });
    if (namespace !== null) {
      for (const documentId of ineligibleDocumentIds) {
        await rag.deleteByKey(ctx, {
          namespaceId: namespace.namespaceId,
          key: `evidence-document:${documentId}`,
        });
      }
    }
    // Source pauses preserve document revisions, so clear a matching marker to
    // ensure reactivation queues a fresh embedding instead of skipping it.
    await ctx.runMutation(invalidateIndexMarkersRef, {
      documentIds: ineligibleDocumentIds,
      model: settings.model,
    });
    return {
      attempted: namespace === null ? 0 : ineligibleDocumentIds.length,
      skipped: documentIds.length - ineligibleDocumentIds.length,
    };
  },
});

export const indexPublicEvidenceDocument = internalAction({
  args: {
    documentId: v.id("evidenceDocuments"),
    allowPriorSourceRevision: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const settings = requireEnabledConfig();
    const preflight = await ctx.runQuery(readIndexPreflightRef, {
      documentId: args.documentId,
      embeddingModel: settings.model,
      now: Date.now(),
      allowPriorSourceRevision: args.allowPriorSourceRevision,
    });
    if (!preflight.available) {
      return { status: "skipped" as const, reason: "circuit_paused" };
    }
    const document = preflight.document;
    if (document === null)
      return { status: "skipped" as const, reason: "not_public" };
    if (document.alreadyIndexed) {
      if (document.legacyMarkerId !== undefined)
        await ctx.runMutation(migrateLegacyIndexMarkerRef, {
          markerId: document.legacyMarkerId,
          documentId: document.documentId,
          documentUpdatedAt: document.updatedAt,
          model: settings.model,
        });
      return { status: "skipped" as const, reason: "idempotent" };
    }

    const text = normalizedText(
      [
        document.title,
        document.excerpt,
        document.searchText,
        document.tags.join(" "),
        document.authors.join(" "),
      ]
        .filter(Boolean)
        .join("\n\n"),
      MAX_SOURCE_TEXT_CHARS,
    );
    if (!text) return { status: "skipped" as const, reason: "empty" };
    const reservedTokens = estimatedInputTokens(text);
    const reservedMicroUsd = estimatedModelCostMicroUsd(
      settings.model,
      reservedTokens,
      0,
    );
    const globalDailyBudgetMicroUsd = openRouterDailyBudgetMicroUsd(
      env.OPENROUTER_DAILY_BUDGET_USD,
    );
    if (
      reservedMicroUsd > settings.dailyBudgetMicroUsd ||
      reservedMicroUsd > globalDailyBudgetMicroUsd
    ) {
      return {
        status: "skipped" as const,
        reason: "request_exceeds_budget" as const,
      };
    }
    const reservation = await ctx.runMutation(reserveUsageRef, {
      operationKey: operationKey(
        "index",
        `${document.documentId}:${fingerprint(document)}`,
        settings.model,
      ),
      kind: "index",
      fingerprint: fingerprint(document),
      holder: operationHolder(),
      estimatedMicroUsd: reservedMicroUsd,
      inputTokens: reservedTokens,
      model: settings.model,
      dailyBudgetMicroUsd: settings.dailyBudgetMicroUsd,
      globalDailyBudgetMicroUsd,
    });
    if (!reservation.accepted)
      return {
        status: "skipped" as const,
        reason: reservation.replay ? "in_progress_or_idempotent" : "budget",
      };
    const indexOperationKey = operationKey(
      "index",
      `${document.documentId}:${fingerprint(document)}`,
      settings.model,
    );
    const { rag, embeddingModel } = platform(settings.apiKey, settings.model);
    const key = `evidence-document:${document.documentId}`;
    let inputTokens = 0;
    try {
      const embedded = await embedRagText(
        embeddingModel,
        text,
        AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      );
      inputTokens = embedded.inputTokens;
      const result = await rag.add(ctx, {
        namespace: NAMESPACE,
        key,
        title: document.title.slice(0, 500),
        chunks: embedded.chunks,
        metadata: {
          documentId: document.documentId,
          sourceId: document.sourceId,
          fingerprint: fingerprint(document),
        },
        filterValues: [],
      });
      await ctx.runMutation(recordUsageRef, {
        operationKey: indexOperationKey,
        inputTokens,
        settledMicroUsd: estimatedModelCostMicroUsd(
          settings.model,
          inputTokens,
          0,
        ),
        model: settings.model,
        outcome: "completed",
        detail: `Indexed public evidence ${document.documentId}.`,
        indexMarker: {
          key: contentIndexMarkerKey(
            document.documentId,
            document.updatedAt,
            settings.model,
          ),
          detail: "Current public evidence content embedded.",
        },
      });
      return { status: result.status, created: result.created, inputTokens };
    } catch (error) {
      await ctx.runMutation(recordUsageRef, {
        operationKey: indexOperationKey,
        inputTokens: reservedTokens,
        settledMicroUsd: reservedMicroUsd,
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
    if (!settings.enabled)
      return {
        enabled: false,
        indexed: 0,
        done: false,
        reason: settings.reason,
      };
    const state =
      args.cursor === undefined && !args.restart
        ? await ctx.runQuery(readBackfillStateRef, {})
        : null;
    if (state?.completed && state.cursor === undefined) {
      return { enabled: true, indexed: 0, done: true };
    }
    const cursor = args.restart ? undefined : (args.cursor ?? state?.cursor);
    const page = await ctx.runQuery(
      readBackfillPageRef,
      cursor === undefined ? {} : { cursor },
    );
    let indexed = 0;
    for (const documentId of page.documentIds) {
      const result = await ctx.runAction(indexDocumentRef, {
        documentId,
        allowPriorSourceRevision: true,
      });
      if (result.status === "created" || result.status === "updated")
        indexed += 1;
    }
    await ctx.runMutation(writeBackfillStateRef, {
      cursor: page.continueCursor,
      completed: page.done,
      processed: page.documentIds.length,
    });
    if (!page.done && page.continueCursor !== undefined) {
      await ctx.scheduler.runAfter(5_000, backfillRef, {
        cursor: page.continueCursor,
      });
    }
    return {
      enabled: true,
      indexed,
      done: page.done,
      cursor: page.continueCursor,
    };
  },
});

export const searchPublicSemantic = internalAction({
  args: { query: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const settings = requireEnabledConfig();
    const availability = await ctx.runQuery(availabilityRef, {
      model: settings.model,
      now: Date.now(),
    });
    if (!availability.available)
      return {
        results: [],
        semanticAttempted: false,
        semanticUsed: false,
        outcome: "circuit_paused" as const,
      };
    const query = normalizedText(args.query, MAX_QUERY_CHARS);
    if (!query)
      throw new ConvexError({
        code: "INVALID_REQUEST",
        message: "query is required.",
      });
    const limit = args.limit ?? 10;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new ConvexError({
        code: "INVALID_REQUEST",
        message: "limit must be an integer between 1 and 20.",
      });
    }
    const { rag, embeddingModel } = platform(settings.apiKey, settings.model);
    const reservedTokens = estimatedInputTokens(query);
    const reservedMicroUsd = estimatedModelCostMicroUsd(
      settings.model,
      reservedTokens,
      0,
    );
    const queryOperationKey = operationKey(
      "query",
      `${query}:${operationHolder()}`,
      settings.model,
    );
    const reservation = await ctx.runMutation(reserveUsageRef, {
      operationKey: queryOperationKey,
      kind: "query",
      fingerprint: query,
      holder: operationHolder(),
      estimatedMicroUsd: reservedMicroUsd,
      inputTokens: reservedTokens,
      model: settings.model,
      dailyBudgetMicroUsd: settings.dailyBudgetMicroUsd,
      globalDailyBudgetMicroUsd: openRouterDailyBudgetMicroUsd(
        env.OPENROUTER_DAILY_BUDGET_USD,
      ),
    });
    if (!reservation.accepted)
      return {
        results: [],
        semanticAttempted: false,
        semanticUsed: false,
        outcome: "budget_rejected" as const,
      };
    try {
      const embedded = await embedRagQuery(
        embeddingModel,
        query,
        AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      );
      const result = await rag.search(ctx, {
        namespace: NAMESPACE,
        query: embedded.embedding,
        limit: Math.min(MAX_SEMANTIC_CANDIDATES, limit * 3),
        vectorScoreThreshold: 0.58,
        searchType: "vector",
      });
      const inputTokens = embedded.inputTokens;
      await ctx.runMutation(recordUsageRef, {
        operationKey: queryOperationKey,
        inputTokens,
        settledMicroUsd: estimatedModelCostMicroUsd(
          settings.model,
          inputTokens,
          0,
        ),
        model: settings.model,
        outcome: "completed",
        detail: `Semantic retrieval returned ${result.entries.length} candidates.`,
      });
      const scores = new Map<string, number>();
      for (const match of result.results)
        scores.set(
          match.entryId,
          Math.max(scores.get(match.entryId) ?? 0, match.score),
        );
      const candidates = result.entries
        .flatMap((entry) => {
          const id = entry.metadata?.documentId;
          if (id === undefined) return [];
          const candidateFingerprint = entry.metadata?.fingerprint;
          if (candidateFingerprint === undefined) return [];
          return [
            {
              documentId: id as Id<"evidenceDocuments">,
              score: scores.get(entry.entryId) ?? 0,
              fingerprint: candidateFingerprint,
            },
          ];
        })
        .slice(0, MAX_SEMANTIC_CANDIDATES);
      return {
        results: await ctx.runQuery(readCandidatesRef, { candidates }),
        semanticAttempted: true,
        semanticUsed: true,
        outcome: "completed" as const,
      };
    } catch (error) {
      await ctx.runMutation(recordUsageRef, {
        operationKey: queryOperationKey,
        inputTokens: reservedTokens,
        settledMicroUsd: reservedMicroUsd,
        model: settings.model,
        outcome: "failed",
        detail: safeError(error),
      });
      // Explicitly fail closed. Callers retain lexical results rather than
      // receiving unverified/stale vector content.
      return {
        results: [],
        semanticAttempted: true,
        semanticUsed: false,
        outcome: "provider_failed" as const,
      };
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
  handler: async (
    ctx,
    args,
  ): Promise<{
    results: UniversalResult[];
    semanticAttempted: boolean;
    semanticUsed: boolean;
    outcome:
      | "completed"
      | "feature_disabled"
      | "lexical_satisfied"
      | "circuit_paused"
      | "budget_rejected"
      | "provider_failed";
  }> => {
    const limit = args.limit ?? 20;
    const lexical = await ctx.runQuery(lexicalSearchRef, {
      query: args.query,
      limit,
    });
    if (!config().enabled)
      return {
        results: lexical,
        semanticAttempted: false,
        semanticUsed: false,
        outcome: "feature_disabled",
      };
    if (lexical.length >= limit)
      return {
        results: lexical,
        semanticAttempted: false,
        semanticUsed: false,
        outcome: "lexical_satisfied",
      };
    let semantic: Awaited<
      ReturnType<typeof ctx.runAction<typeof searchSemanticRef>>
    >;
    try {
      semantic = await ctx.runAction(searchSemanticRef, {
        query: args.query,
        limit: Math.min(20, limit - lexical.length),
      });
    } catch {
      // Semantic is an enhancement only. Preserve the lexical response if an
      // operator disables the feature between the first check and this call.
      return {
        results: lexical,
        semanticAttempted: false,
        semanticUsed: false,
        outcome: "provider_failed",
      };
    }
    const knownUrls = new Set(lexical.map((result) => result.canonicalUrl));
    const semanticOnly = semantic.results
      .filter((result) => !knownUrls.has(result.canonicalUrl))
      .sort(
        (left, right) =>
          right.score - left.score || right.updatedAt - left.updatedAt,
      )
      .map((result) => ({
        type: "evidence_document" as const,
        canonicalUrl: result.canonicalUrl,
        title: result.title,
        excerpt: result.excerpt,
        visibility: "public" as const,
        score: result.score,
        scoreExplanation: [
          "semantic similarity",
          "live public-source authorization",
        ],
        rankSignals: {
          matchedTerms: 0,
          titleTerms: 0,
          phraseMatch: false,
          citationCount: 0,
          recencyDays: Math.max(
            0,
            Math.floor((Date.now() - result.updatedAt) / 86_400_000),
          ),
        },
        updatedAt: result.updatedAt,
        publishedAt: result.publishedAt,
        provenance: {
          recordId: result.documentId,
          documentId: result.documentId,
          citationIds: [],
        },
      }));
    return {
      results: [...lexical, ...semanticOnly].slice(0, limit),
      semanticAttempted: semantic.semanticAttempted,
      semanticUsed: semantic.semanticUsed,
      outcome: semantic.outcome,
    };
  },
});
