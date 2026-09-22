import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  isPublicEvidenceClaim,
  isPublicEvidenceDocument,
  isPublicEvidenceEntity,
} from "./evidenceVisibility";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import type { AgentQuotaConsumeResult } from "./agentQuota";
import {
  isActiveAgentUser,
  requireAgentScope,
  requireAuthenticatedUser,
} from "./authz";

const MAX_QUERY_CHARS = 300;
const MAX_RESULTS = 20;
const SEMANTIC_QUERY_UNITS = 2;
// text-embedding-3-small is capped at 600 reserved input tokens for the
// 300-character public query contract. At $0.02/M input tokens that is 12
// micro-USD. Organization budgets reserve that hard upper bound before any
// provider-capable action runs.
export const SEMANTIC_QUERY_MAX_MICRO_USD = 12;

const universalResultValidator = v.object({
  type: v.union(
    v.literal("evidence_document"),
    v.literal("evidence_claim"),
    v.literal("evidence_entity"),
    v.literal("blog_post"),
    v.literal("newsletter_issue"),
    v.literal("news_story"),
    v.literal("forum_thread"),
  ),
  canonicalUrl: v.string(),
  title: v.string(),
  excerpt: v.string(),
  visibility: v.literal("public"),
  score: v.number(),
  scoreExplanation: v.array(v.string()),
  rankSignals: v.object({
    matchedTerms: v.number(),
    titleTerms: v.number(),
    phraseMatch: v.boolean(),
    citationCount: v.number(),
    recencyDays: v.number(),
  }),
  updatedAt: v.number(),
  publishedAt: v.union(v.number(), v.null()),
  provenance: v.object({
    recordId: v.string(),
    sourceId: v.optional(v.string()),
    documentId: v.optional(v.string()),
    documentVersionId: v.optional(v.string()),
    claimId: v.optional(v.string()),
    entityId: v.optional(v.string()),
    citationIds: v.array(v.string()),
  }),
});

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

type SemanticPrepareResult = {
  commandId: Id<"apiCommands">;
  replayResult?: UniversalResult[];
  denialCode?: "AGENT_QUOTA_EXCEEDED";
};

type BeginOrReplayCommandResult = {
  commandId: Id<"apiCommands">;
  ledgerEntryId?: Id<"apiUsageLedger">;
  status: "accepted" | "completed" | "failed";
  idempotent: boolean;
  billingEnabled: boolean;
};

const prepareRef = makeFunctionReference<
  "mutation",
  {
    query: string;
    limit: number;
    idempotencyKey: string;
    requestFingerprint: string;
  },
  SemanticPrepareResult
>("agentSemanticApi:prepare");

const completeRef = makeFunctionReference<
  "mutation",
  {
    commandId: Id<"apiCommands">;
    result: UniversalResult[];
    chargeMonetary: boolean;
    semanticAttempted: boolean;
    semanticUsed: boolean;
    outcome: string;
  },
  null
>("agentSemanticApi:complete");

const failRef = makeFunctionReference<
  "mutation",
  { commandId: Id<"apiCommands"> },
  null
>("agentSemanticApi:fail");

const hybridSearchRef = makeFunctionReference<
  "action",
  { query: string; limit?: number },
  {
    results: UniversalResult[];
    semanticAttempted: boolean;
    semanticUsed: boolean;
    outcome: string;
  }
>("semanticSearch:searchHybridPublic");

function semanticError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

function normalizedQuery(value: string) {
  const query = value.replace(/\s+/g, " ").trim();
  if (query.length === 0 || query.length > MAX_QUERY_CHARS) {
    semanticError(
      "INVALID_REQUEST",
      `query is required and must be at most ${MAX_QUERY_CHARS} characters.`,
    );
  }
  return query;
}

function normalizedLimit(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_RESULTS) {
    semanticError(
      "INVALID_REQUEST",
      `limit must be an integer between 1 and ${MAX_RESULTS}.`,
    );
  }
  return value;
}

function normalizedIdempotencyKey(value: string) {
  const key = value.trim();
  if (
    key.length < 8 ||
    key.length > 96 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)
  ) {
    semanticError(
      "INVALID_IDEMPOTENCY_KEY",
      "idempotencyKey must be 8-96 URL-safe identifier characters.",
    );
  }
  return key;
}

function normalizedFingerprint(value: string) {
  const fingerprint = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    semanticError(
      "INVALID_REQUEST_FINGERPRINT",
      "requestFingerprint must be a SHA-256 hex digest.",
    );
  }
  return fingerprint;
}

async function semanticRequestFingerprint(query: string, limit: number) {
  const canonical = `semantic_search:{"limit":${limit},"query":${JSON.stringify(query)}}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function semanticPrincipal(ctx: MutationCtx) {
  const user = await requireAuthenticatedUser(ctx);
  requireAgentScope(user, "evidence");
  const identity = await ctx.db
    .query("agentIdentities")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .unique();
  if (
    !isActiveAgentUser(user) ||
    identity === null ||
    identity.status !== "active" ||
    identity.userId !== user._id ||
    identity.ownerUserId === undefined ||
    identity.agentId !== user.agentSlug ||
    !identity.scopes.includes("evidence")
  ) {
    semanticError(
      "AGENT_OWNER_REQUIRED",
      "An active owner-managed evidence agent identity is required.",
    );
  }
  const owner = await ctx.db.get("users", identity.ownerUserId);
  if (owner === null || owner.isAgent === true) {
    semanticError("AGENT_OWNER_REQUIRED", "An active human owner is required.");
  }
  return {
    agentUserId: user._id,
    agentId: identity.agentId,
    ownerUserId: identity.ownerUserId,
  };
}

function parseStoredResult(command: Doc<"apiCommands">): UniversalResult[] {
  if (command.status === "accepted") {
    semanticError(
      "IDEMPOTENCY_REPLAY_IN_PROGRESS",
      "The original semantic search is still in progress.",
    );
  }
  if (command.status === "failed") {
    semanticError(
      "IDEMPOTENCY_REPLAY_FAILED",
      "The original semantic search did not complete.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(command.resultJson);
  } catch {
    parsed = null;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).kind !== "semantic-search-result" ||
    (parsed as Record<string, unknown>).version !== 1 ||
    !Array.isArray((parsed as Record<string, unknown>).result)
  ) {
    semanticError(
      "IDEMPOTENCY_REPLAY_UNAVAILABLE",
      "The original semantic search result is unavailable.",
    );
  }
  return (parsed as { result: UniversalResult[] }).result;
}

function parseReservation(command: Doc<"apiCommands">) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(command.resultJson);
  } catch {
    parsed = null;
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).kind !==
      "semantic-search-reservation" ||
    (parsed as Record<string, unknown>).version !== 1
  ) {
    semanticError(
      "COMMAND_STATE_INVALID",
      "Semantic search accounting reservation is unavailable.",
    );
  }
  const organizationUsageId = (parsed as Record<string, unknown>)
    .organizationUsageId;
  if (
    organizationUsageId !== undefined &&
    typeof organizationUsageId !== "string"
  ) {
    semanticError(
      "COMMAND_STATE_INVALID",
      "Semantic search accounting reservation is invalid.",
    );
  }
  return {
    organizationUsageId: organizationUsageId as
      Id<"organizationUsageLedger"> | undefined,
  };
}

async function reverseMonetaryReservations(
  ctx: MutationCtx,
  command: Doc<"apiCommands">,
  reason: string,
) {
  const reservation = parseReservation(command);
  await ctx.runMutation(internal.apiCommerce.reverseCommandUsage, {
    commandId: command._id,
    reason,
  });
  if (reservation.organizationUsageId !== undefined) {
    await ctx.runMutation(internal.organizations.reverseServiceAccountUsage, {
      usageId: reservation.organizationUsageId,
      commandId: command._id,
      reason,
    });
  }
}

/**
 * Authenticates and reserves every caller-controlled budget before the action
 * can reach OpenRouter. No owner, organization, project, or agent identifier
 * is accepted from the request.
 */
export const prepare = internalMutation({
  args: {
    query: v.string(),
    limit: v.number(),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
  },
  returns: v.object({
    commandId: v.id("apiCommands"),
    replayResult: v.optional(v.array(universalResultValidator)),
    denialCode: v.optional(v.literal("AGENT_QUOTA_EXCEEDED")),
  }),
  handler: async (ctx, args): Promise<SemanticPrepareResult> => {
    const query = normalizedQuery(args.query);
    const limit = normalizedLimit(args.limit);
    const idempotencyKey = normalizedIdempotencyKey(args.idempotencyKey);
    const requestFingerprint = normalizedFingerprint(args.requestFingerprint);
    const principal = await semanticPrincipal(ctx);

    // Commerce admission precedes the request-attempt abuse quota. If the
    // latter rejects, the monetary debit is compensated before returning the
    // denial. Agent quota is deliberately not refundable after acceptance.
    const command: BeginOrReplayCommandResult = await ctx.runMutation(
      api.apiCommerce.beginOrReplayCommand,
      {
        agentId: principal.agentId,
        productKey: "evidence-search",
        idempotencyKey,
        requestFingerprint,
        operation: "evidence.semantic_search",
        units: SEMANTIC_QUERY_UNITS,
        metadataJson: JSON.stringify({ queryLength: query.length, limit }),
      },
    );

    if (command.idempotent) {
      const stored: Doc<"apiCommands"> | null = await ctx.db.get(
        "apiCommands",
        command.commandId,
      );
      if (
        stored === null ||
        stored.ownerUserId !== principal.ownerUserId ||
        stored.kind !== "evidence.semantic_search"
      ) {
        semanticError(
          "IDEMPOTENCY_REPLAY_UNAVAILABLE",
          "The original semantic search result is unavailable.",
        );
      }
      return {
        commandId: stored._id,
        replayResult: (
          await Promise.all(
            parseStoredResult(stored).map(async (result) => {
              if (result.type === "evidence_document") {
                const id = ctx.db.normalizeId(
                  "evidenceDocuments",
                  result.provenance.documentId ?? "",
                );
                const document =
                  id === null
                    ? null
                    : await ctx.db.get("evidenceDocuments", id);
                if (
                  document === null ||
                  document.updatedAt !== result.updatedAt ||
                  !(await isPublicEvidenceDocument(ctx, document))
                )
                  return null;
              }
              if (result.type === "evidence_claim") {
                const id = ctx.db.normalizeId(
                  "evidenceClaims",
                  result.provenance.claimId ?? "",
                );
                const claim =
                  id === null ? null : await ctx.db.get("evidenceClaims", id);
                if (
                  claim === null ||
                  claim.updatedAt !== result.updatedAt ||
                  !(await isPublicEvidenceClaim(ctx, claim))
                )
                  return null;
                for (const citationId of result.provenance.citationIds) {
                  const id = ctx.db.normalizeId(
                    "evidenceClaimCitations",
                    citationId,
                  );
                  const citation =
                    id === null
                      ? null
                      : await ctx.db.get("evidenceClaimCitations", id);
                  if (citation === null || citation.claimId !== claim._id)
                    return null;
                  const version = await ctx.db.get(
                    "evidenceDocumentVersions",
                    citation.documentVersionId,
                  );
                  const document =
                    version === null
                      ? null
                      : await ctx.db.get(
                          "evidenceDocuments",
                          version.documentId,
                        );
                  if (!(await isPublicEvidenceDocument(ctx, document)))
                    return null;
                }
              }
              if (result.type === "evidence_entity") {
                const id = ctx.db.normalizeId(
                  "evidenceEntities",
                  result.provenance.entityId ?? "",
                );
                const entity =
                  id === null ? null : await ctx.db.get("evidenceEntities", id);
                if (
                  entity === null ||
                  !(await isPublicEvidenceEntity(ctx, entity)) ||
                  entity.updatedAt !== result.updatedAt
                )
                  return null;
              }
              return result;
            }),
          )
        ).filter((result) => result !== null),
      };
    }

    const quota: AgentQuotaConsumeResult = await ctx.runMutation(
      internal.agentQuota.consumeAgentQuota,
      {
        agentId: principal.agentId,
        units: SEMANTIC_QUERY_UNITS,
        operation: "evidence.semantic_search",
        idempotencyKey,
        requestFingerprint,
      },
    );
    if (!quota.accepted) {
      await ctx.db.patch("apiCommands", command.commandId, {
        status: "failed",
        resultJson: JSON.stringify({
          kind: "semantic-search-reservation",
          version: 1,
        }),
        updatedAt: Date.now(),
      });
      const denied = await ctx.db.get("apiCommands", command.commandId);
      if (denied === null) {
        semanticError("COMMAND_STATE_INVALID", "Semantic command disappeared.");
      }
      await reverseMonetaryReservations(ctx, denied, "agent_quota_rejected");
      return {
        commandId: command.commandId,
        denialCode: "AGENT_QUOTA_EXCEEDED" as const,
      };
    }

    const serviceAccount = await ctx.db
      .query("organizationServiceAccounts")
      .withIndex("by_agentUserId", (q) =>
        q.eq("agentUserId", principal.agentUserId),
      )
      .unique();
    let organizationUsageId: Id<"organizationUsageLedger"> | undefined;
    if (serviceAccount !== null) {
      const usage = await ctx.runMutation(
        api.organizations.recordServiceAccountUsage,
        {
          scope: "evidence",
          amountMicros: SEMANTIC_QUERY_MAX_MICRO_USD,
          idempotencyKey: `semantic:${idempotencyKey}`,
          commandId: command.commandId,
          requestFingerprint,
        },
      );
      organizationUsageId = usage.usageId;
    }

    await ctx.db.patch("apiCommands", command.commandId, {
      resultJson: JSON.stringify({
        kind: "semantic-search-reservation",
        version: 1,
        organizationUsageId,
      }),
      updatedAt: Date.now(),
    });

    return { commandId: command.commandId };
  },
});

export const complete = internalMutation({
  args: {
    commandId: v.id("apiCommands"),
    result: v.array(universalResultValidator),
    chargeMonetary: v.boolean(),
    semanticAttempted: v.boolean(),
    semanticUsed: v.boolean(),
    outcome: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const command = await ctx.db.get("apiCommands", args.commandId);
    if (command === null || command.kind !== "evidence.semantic_search") {
      semanticError("COMMAND_DENIED", "Semantic search command not found.");
    }
    if (command.status === "completed") return null;
    if (command.status !== "accepted") {
      semanticError("COMMAND_STATE_INVALID", "Semantic search command failed.");
    }
    if (!args.chargeMonetary) {
      await reverseMonetaryReservations(
        ctx,
        command,
        `semantic_${args.outcome}`.slice(0, 80),
      );
    }
    const resultJson = JSON.stringify({
      kind: "semantic-search-result",
      version: 1,
      result: args.result,
      settlement: {
        agentQuota: "non_refundable_request_attempt",
        monetaryCharged: args.chargeMonetary,
        semanticAttempted: args.semanticAttempted,
        semanticUsed: args.semanticUsed,
        outcome: args.outcome,
      },
    });
    if (resultJson.length > 100_000) {
      semanticError(
        "COMMAND_RESULT_TOO_LARGE",
        "Semantic search result exceeded its storage bound.",
      );
    }
    await ctx.db.patch("apiCommands", command._id, {
      status: "completed",
      resultJson,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const fail = internalMutation({
  args: { commandId: v.id("apiCommands") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const command = await ctx.db.get("apiCommands", args.commandId);
    if (
      command === null ||
      command.kind !== "evidence.semantic_search" ||
      command.status !== "accepted"
    ) {
      return null;
    }
    await ctx.db.patch("apiCommands", command._id, {
      status: "failed",
      resultJson: JSON.stringify({
        kind: "semantic-search-result",
        version: 1,
        error: "operation_failed",
      }),
      updatedAt: Date.now(),
    });
    await reverseMonetaryReservations(ctx, command, "semantic_search_failed");
    return null;
  },
});

/** The sole provider-capable transport entrypoint for authenticated callers. */
export const dispatch = internalAction({
  args: {
    query: v.string(),
    limit: v.number(),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
  },
  returns: v.array(universalResultValidator),
  handler: async (ctx, args): Promise<UniversalResult[]> => {
    const query = normalizedQuery(args.query);
    const limit = normalizedLimit(args.limit);
    const expectedFingerprint = await semanticRequestFingerprint(query, limit);
    if (
      normalizedFingerprint(args.requestFingerprint) !== expectedFingerprint
    ) {
      semanticError(
        "REQUEST_FINGERPRINT_MISMATCH",
        "The semantic search request fingerprint does not match its payload.",
      );
    }
    const prepared = await ctx.runMutation(prepareRef, {
      ...args,
      query,
      limit,
      requestFingerprint: expectedFingerprint,
    });
    if (prepared.denialCode === "AGENT_QUOTA_EXCEEDED") {
      semanticError(
        "AGENT_QUOTA_EXCEEDED",
        "Agent usage quota reached for this period.",
      );
    }
    if (prepared.replayResult !== undefined) return prepared.replayResult;
    try {
      // searchHybridPublic is the only provider-capable function called here.
      // It preserves lexical ranking and returns lexical-only results whenever
      // the feature flag is off, the circuit is paused, or semantic retrieval
      // fails closed.
      const search = await ctx.runAction(hybridSearchRef, {
        query,
        limit,
      });
      await ctx.runMutation(completeRef, {
        commandId: prepared.commandId,
        result: search.results,
        chargeMonetary: search.semanticUsed,
        semanticAttempted: search.semanticAttempted,
        semanticUsed: search.semanticUsed,
        outcome: search.outcome,
      });
      return search.results;
    } catch (error) {
      await ctx.runMutation(failRef, { commandId: prepared.commandId });
      throw error;
    }
  },
});
