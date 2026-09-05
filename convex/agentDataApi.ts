import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { AgentQuotaConsumeResult } from "./agentQuota";
import { requireAgentScope, requireAuthenticatedUser } from "./authz";
import { listPublicEvidenceSourceRegistry } from "./evidenceSourceRegistry";
import {
  configuredWebhookKek,
  decryptWebhookSecret,
  encryptWebhookSecret,
} from "./evidenceWebhooks";

const operationValidator = v.union(
  v.literal("status"),
  v.literal("sources"),
  v.literal("source_registry"),
  v.literal("search"),
  v.literal("universal_search"),
  v.literal("document"),
  v.literal("changes"),
  v.literal("verify"),
  v.literal("entities"),
  v.literal("version_claims"),
  v.literal("claim_timeline"),
  v.literal("products"),
  v.literal("datasets"),
  v.literal("benchmarks"),
  v.literal("quota"),
  v.literal("entitlements"),
  v.literal("usage"),
  v.literal("research_create"),
  v.literal("research_get"),
  v.literal("research_artifact"),
  v.literal("export_create"),
  v.literal("export_get"),
  v.literal("export_artifact"),
  v.literal("export_manifest"),
  v.literal("webhooks_list"),
  v.literal("webhooks_availability"),
  v.literal("webhooks_create"),
  v.literal("webhooks_status"),
  v.literal("webhooks_health"),
  v.literal("webhooks_history"),
  v.literal("webhooks_rotate"),
  v.literal("webhooks_replay"),
  v.literal("webhooks_test"),
);

type Operation =
  | "status"
  | "sources"
  | "source_registry"
  | "search"
  | "universal_search"
  | "document"
  | "changes"
  | "verify"
  | "entities"
  | "version_claims"
  | "claim_timeline"
  | "products"
  | "datasets"
  | "benchmarks"
  | "quota"
  | "entitlements"
  | "usage"
  | "research_create"
  | "research_get"
  | "research_artifact"
  | "export_create"
  | "export_get"
  | "export_artifact"
  | "export_manifest"
  | "webhooks_list"
  | "webhooks_availability"
  | "webhooks_create"
  | "webhooks_status"
  | "webhooks_health"
  | "webhooks_history"
  | "webhooks_rotate"
  | "webhooks_replay"
  | "webhooks_test";

type EvidenceIdTable =
  | "evidenceDocuments"
  | "evidenceDocumentVersions"
  | "evidenceClaims"
  | "evidenceDatasets"
  | "evidenceResearchJobs"
  | "evidenceExportJobs";

const MAX_LIMIT = 50;
const MAX_EXPORT_RECORD_LIMIT = 500;
const WEBHOOK_RESULT_VERSION = 1;
const WEBHOOK_IDEMPOTENT_OPERATIONS = new Set<Operation>([
  "webhooks_create",
  "webhooks_status",
  "webhooks_rotate",
  "webhooks_replay",
  "webhooks_test",
]);

type WebhookCommandResult = {
  kind: "webhook-result";
  version: 1;
  operation: string;
  result: Record<string, unknown>;
  signingSecretCiphertext?: string;
  signingSecretNonce?: string;
};

async function storeWebhookCommandResult(
  ctx: MutationCtx,
  commandId: Id<"apiCommands">,
  operation: string,
  value: unknown,
) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConvexError({
      code: "IDEMPOTENCY_RESULT_INVALID",
      message: "Webhook operation returned an invalid result.",
    });
  }
  const result = { ...(value as Record<string, unknown>) };
  const signingSecret = result.signingSecret;
  delete result.signingSecret;
  const stored: WebhookCommandResult = {
    kind: "webhook-result",
    version: WEBHOOK_RESULT_VERSION,
    operation,
    result,
  };
  if (typeof signingSecret === "string" && signingSecret.length > 0) {
    const encrypted = await encryptWebhookSecret(
      configuredWebhookKek(),
      signingSecret,
    );
    stored.signingSecretCiphertext = encrypted.ciphertext;
    stored.signingSecretNonce = encrypted.nonce;
  }
  const resultJson = JSON.stringify(stored);
  if (resultJson.length > 100_000) {
    throw new ConvexError({
      code: "IDEMPOTENCY_RESULT_TOO_LARGE",
      message: "Webhook operation result exceeded the replay bound.",
    });
  }
  await ctx.db.patch("apiCommands", commandId, {
    status: "completed",
    resultJson,
    updatedAt: Date.now(),
  });
}

async function replayWebhookCommandResult(
  ctx: MutationCtx,
  commandId: Id<"apiCommands">,
  operation: string,
) {
  const command = await ctx.db.get("apiCommands", commandId);
  if (command === null || command.status !== "completed") {
    throw new ConvexError({
      code: "IDEMPOTENCY_REPLAY_IN_PROGRESS",
      message: "The original webhook operation has not completed.",
    });
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
    (parsed as Record<string, unknown>).kind !== "webhook-result" ||
    (parsed as Record<string, unknown>).version !== WEBHOOK_RESULT_VERSION ||
    (parsed as Record<string, unknown>).operation !== operation
  ) {
    throw new ConvexError({
      code: "IDEMPOTENCY_REPLAY_UNAVAILABLE",
      message: "The original webhook result is unavailable for replay.",
    });
  }
  const stored = parsed as WebhookCommandResult;
  const result = { ...stored.result };
  if (stored.signingSecretCiphertext || stored.signingSecretNonce) {
    if (!stored.signingSecretCiphertext || !stored.signingSecretNonce) {
      throw new ConvexError({
        code: "IDEMPOTENCY_REPLAY_UNAVAILABLE",
        message: "The original webhook secret is unavailable for replay.",
      });
    }
    result.signingSecret = await decryptWebhookSecret(
      configuredWebhookKek(),
      stored.signingSecretCiphertext,
      stored.signingSecretNonce,
    );
  }
  return result;
}

function limit(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_LIMIT
  ) {
    throw new ConvexError({
      code: "INVALID_REQUEST",
      message: `limit must be an integer between 1 and ${MAX_LIMIT}.`,
    });
  }
  return value as number;
}

function exportRecordLimit(value: unknown) {
  if (value === undefined) return 100;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_EXPORT_RECORD_LIMIT
  )
    throw new ConvexError({
      code: "INVALID_REQUEST",
      message: `recordLimit must be an integer between 1 and ${MAX_EXPORT_RECORD_LIMIT}.`,
    });
  return value as number;
}

function requiredText(
  input: Record<string, unknown>,
  key: string,
  maximum: number,
) {
  const value = input[key];
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    throw new ConvexError({
      code: "INVALID_REQUEST",
      message: `${key} is required and must be at most ${maximum} characters.`,
    });
  }
  return value.trim();
}

function normalizedId<TableName extends EvidenceIdTable>(
  ctx: MutationCtx,
  table: TableName,
  input: Record<string, unknown>,
  key: string,
) {
  const value = requiredText(input, key, 160);
  const id = ctx.db.normalizeId(table, value);
  if (id === null) {
    throw new ConvexError({
      code: "INVALID_REQUEST",
      message: `${key} is invalid.`,
    });
  }
  return id;
}

async function agentPrincipal(ctx: MutationCtx) {
  const user = await requireAuthenticatedUser(ctx);
  requireAgentScope(user, "evidence");
  const identity = await ctx.db
    .query("agentIdentities")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .unique();
  if (
    identity === null ||
    identity.status !== "active" ||
    identity.ownerUserId === undefined
  ) {
    throw new ConvexError({
      code: "AGENT_OWNER_REQUIRED",
      message: "An active owner-managed agent identity is required.",
    });
  }
  return {
    agentUserId: user._id,
    agentId: identity.agentId,
    ownerUserId: identity.ownerUserId,
  };
}

function productForOperation(operation: Operation) {
  if (operation === "changes") return "evidence-change";
  if (operation === "verify") return "evidence-verify";
  if (operation === "version_claims") return "evidence-verify";
  if (operation === "claim_timeline") return "evidence-verify";
  if (operation.startsWith("research_")) return "evidence-research";
  if (operation.startsWith("export_")) return "evidence-export";
  if (operation === "benchmarks") return "evidence-benchmarks";
  if (operation.startsWith("webhooks_")) return "evidence-webhooks";
  return "evidence-search";
}

function unitsForOperation(operation: Operation) {
  if (operation === "research_create") return 5;
  if (operation === "export_create") return 10;
  return 1;
}

/** The only internal entrypoint exposed by the platform HTTP transport. */
export const dispatch = internalMutation({
  args: {
    operation: operationValidator,
    input: v.any(),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<unknown> => {
    const principal = await agentPrincipal(ctx);
    const input =
      args.input !== null &&
      typeof args.input === "object" &&
      !Array.isArray(args.input)
        ? (args.input as Record<string, unknown>)
        : {};

    if (args.operation === "status") {
      return {
        status: "available",
        version: "v1",
        paymentAccepted: false,
        graphql: "deferred",
        operations: [
          "search",
          "semantic_search",
          "verify",
          "research",
          "export",
          "mcp",
        ],
      };
    }
    if (args.operation === "quota") {
      return await ctx.runQuery(api.agentQuota.getMyAgentQuota, {});
    }
    if (args.operation === "entitlements") {
      return await ctx.runQuery(api.apiCommerce.getMyAccessSummary, {});
    }
    if (args.operation === "usage") {
      return await ctx.runQuery(api.apiCommerce.getMyUsageStatus, {
        limit: limit(input.limit, 20),
      });
    }
    if (args.operation === "webhooks_availability") {
      return await ctx.runQuery(
        api.evidenceWebhooks.getMyWebhookAvailability,
        {},
      );
    }

    // Validate operation-specific values before reserving quota and usage.
    const requestedLimit = limit(input.limit, 20);
    const researchQuery =
      args.operation === "research_create"
        ? requiredText(input, "query", 300)
        : null;
    const documentId =
      args.operation === "document"
        ? normalizedId(ctx, "evidenceDocuments", input, "documentId")
        : null;
    const claimId =
      args.operation === "verify"
        ? normalizedId(ctx, "evidenceClaims", input, "claimId")
        : null;
    const documentVersionId =
      args.operation === "version_claims"
        ? normalizedId(
            ctx,
            "evidenceDocumentVersions",
            input,
            "documentVersionId",
          )
        : null;
    const claimKey =
      args.operation === "claim_timeline"
        ? requiredText(input, "claimKey", 200)
        : null;
    const datasetId =
      args.operation === "export_create"
        ? normalizedId(ctx, "evidenceDatasets", input, "datasetId")
        : null;
    const requestedExportRecordLimit =
      args.operation === "export_create"
        ? exportRecordLimit(input.recordLimit)
        : null;
    const researchJobId =
      args.operation === "research_get" ||
      args.operation === "research_artifact"
        ? normalizedId(ctx, "evidenceResearchJobs", input, "jobId")
        : null;
    const exportJobId =
      args.operation === "export_get" ||
      args.operation === "export_artifact" ||
      args.operation === "export_manifest"
        ? normalizedId(ctx, "evidenceExportJobs", input, "jobId")
        : null;
    const search =
      args.operation === "search" ? requiredText(input, "query", 300) : null;
    const universalSearch =
      args.operation === "universal_search"
        ? requiredText(input, "query", 300)
        : null;
    const entitySearch =
      args.operation === "entities" ? requiredText(input, "query", 200) : null;
    if (
      args.operation === "export_create" &&
      input.format !== undefined &&
      input.format !== "jsonl"
    ) {
      throw new ConvexError({
        code: "INVALID_REQUEST",
        message: "Only jsonl exports are currently supported.",
      });
    }
    const webhookSubscriptionKey =
      args.operation === "webhooks_create" ||
      args.operation === "webhooks_status" ||
      args.operation === "webhooks_health" ||
      args.operation === "webhooks_history" ||
      args.operation === "webhooks_rotate" ||
      args.operation === "webhooks_replay" ||
      args.operation === "webhooks_test"
        ? requiredText(input, "subscriptionKey", 96).toLowerCase()
        : null;
    const webhookUrl =
      args.operation === "webhooks_create"
        ? requiredText(input, "url", 2_000)
        : null;
    const webhookEventTypes =
      args.operation === "webhooks_create" &&
      Array.isArray(input.eventTypes) &&
      input.eventTypes.length > 0 &&
      input.eventTypes.length <= 12 &&
      input.eventTypes.every((eventType) => typeof eventType === "string")
        ? (input.eventTypes as Array<
            | "evidence.document.changed"
            | "evidence.research.completed"
            | "evidence.export.completed"
            | "evidence.benchmark.completed"
            | "evidence.claim.verified"
            | "evidence.usage.threshold_reached"
            | "evidence.usage.budget_reached"
            | "evidence.entitlement.status_changed"
          >)
        : null;
    if (args.operation === "webhooks_create" && webhookEventTypes === null) {
      throw new ConvexError({
        code: "INVALID_REQUEST",
        message:
          "eventTypes must contain between 1 and 12 supported event types.",
      });
    }
    const webhookStatus =
      args.operation === "webhooks_status" &&
      (input.status === "active" ||
        input.status === "paused" ||
        input.status === "revoked")
        ? input.status
        : null;
    if (args.operation === "webhooks_status" && webhookStatus === null) {
      throw new ConvexError({
        code: "INVALID_REQUEST",
        message: "status must be active, paused, or revoked.",
      });
    }
    const webhookEventKey =
      args.operation === "webhooks_replay"
        ? requiredText(input, "eventKey", 160).toLowerCase()
        : null;
    const webhookEventType =
      args.operation === "webhooks_test" &&
      [
        "evidence.document.changed",
        "evidence.research.completed",
        "evidence.export.completed",
        "evidence.benchmark.completed",
        "evidence.claim.verified",
        "evidence.usage.threshold_reached",
        "evidence.usage.budget_reached",
        "evidence.entitlement.status_changed",
      ].includes(String(input.eventType))
        ? (input.eventType as
            | "evidence.document.changed"
            | "evidence.research.completed"
            | "evidence.export.completed"
            | "evidence.benchmark.completed"
            | "evidence.claim.verified"
            | "evidence.usage.threshold_reached"
            | "evidence.usage.budget_reached"
            | "evidence.entitlement.status_changed")
        : null;
    if (args.operation === "webhooks_test" && webhookEventType === null) {
      throw new ConvexError({
        code: "INVALID_REQUEST",
        message: "eventType must be a supported webhook event type.",
      });
    }

    const requestedUnits = unitsForOperation(args.operation);
    const quota: AgentQuotaConsumeResult = await ctx.runMutation(
      internal.agentQuota.consumeAgentQuota,
      {
        agentId: principal.agentId,
        units: requestedUnits,
        operation: `evidence.${args.operation}`,
        idempotencyKey: args.idempotencyKey,
        requestFingerprint: args.requestFingerprint,
      },
    );
    if (!quota.accepted) {
      throw new ConvexError({
        code: "AGENT_QUOTA_EXCEEDED",
        message: "Agent usage quota reached for this period.",
        reason: quota.reason,
        retryAfter: quota.retryAfter,
      });
    }
    const commerceCommand = await ctx.runMutation(
      api.apiCommerce.beginOrReplayCommand,
      {
        agentId: principal.agentId,
        productKey: productForOperation(args.operation),
        idempotencyKey: args.idempotencyKey,
        requestFingerprint: args.requestFingerprint,
        operation: `evidence.${args.operation}`,
        units: requestedUnits,
        metadataJson: "{}",
      },
    );

    // Webhook writes must replay the original result for retries. The quota
    // and commerce ledgers already detect duplicate keys; do not let a retry
    // fall through and rotate a secret or enqueue another delivery.
    if (
      commerceCommand.idempotent &&
      WEBHOOK_IDEMPOTENT_OPERATIONS.has(args.operation)
    ) {
      return await replayWebhookCommandResult(
        ctx,
        commerceCommand.commandId,
        args.operation,
      );
    }

    let operationResult: unknown;
    switch (args.operation) {
      case "source_registry":
        return listPublicEvidenceSourceRegistry();
      case "sources": {
        const rows = await ctx.db
          .query("evidenceSources")
          .withIndex("by_status_and_visibility", (q) =>
            q.eq("status", "active").eq("visibility", "public"),
          )
          .order("desc")
          .take(requestedLimit);
        return rows.map(
          ({
            _id,
            sourceKey,
            name,
            sourceType,
            homepageUrl,
            termsUrl,
            provenanceClass,
            licenseClass,
            updatedAt,
          }) => ({
            sourceId: _id,
            sourceKey,
            name,
            sourceType,
            homepageUrl,
            termsUrl,
            provenanceClass,
            licenseClass,
            updatedAt,
          }),
        );
      }
      case "search":
        return await ctx.runQuery(internal.evidence.searchPublic, {
          search: search!,
          limit: requestedLimit,
        });
      case "universal_search":
        return await ctx.runQuery(internal.universalSearch.searchPublic, {
          query: universalSearch!,
          limit: requestedLimit,
        });
      case "document":
        return await ctx.runQuery(internal.evidence.getPublicDocument, {
          documentId: documentId!,
        });
      case "changes":
        return await ctx.runQuery(internal.evidence.listPublicChanges, {
          limit: requestedLimit,
        });
      case "products":
        return await ctx.runQuery(api.evidence.listProducts, {
          limit: requestedLimit,
        });
      case "datasets":
        return await ctx.runQuery(api.evidence.listDatasets, {
          limit: requestedLimit,
        });
      case "benchmarks":
        return {
          benchmarks: await ctx.runQuery(api.evidence.listBenchmarks, {
            limit: requestedLimit,
          }),
          recentRuns: await ctx.runQuery(
            internal.evidenceBenchmarks.listPublicRuns,
            { limit: requestedLimit },
          ),
        };
      case "verify": {
        const claim = await ctx.db.get("evidenceClaims", claimId!);
        if (claim === null || claim.visibility !== "public") return null;
        const citations = await ctx.db
          .query("evidenceClaimCitations")
          .withIndex("by_claimId", (q) => q.eq("claimId", claim._id))
          .take(MAX_LIMIT);
        const publicCitations = [];
        for (const citation of citations) {
          const version = await ctx.db.get(
            "evidenceDocumentVersions",
            citation.documentVersionId,
          );
          if (version === null) continue;
          const document = await ctx.db.get(
            "evidenceDocuments",
            version.documentId,
          );
          if (document?.visibility === "public") publicCitations.push(citation);
        }
        return {
          claimId: claim._id,
          statement: claim.statement,
          status: claim.status,
          confidence: claim.confidence,
          observedAt: claim.observedAt,
          citations: publicCitations.map((citation) => ({
            relation: citation.relation,
            documentVersionId: citation.documentVersionId,
            locator: citation.locator,
            excerpt: citation.excerpt,
            confidence: citation.confidence,
          })),
        };
      }
      case "entities":
        return await ctx.runQuery(internal.evidence.searchEntities, {
          search: entitySearch!,
          limit: requestedLimit,
        });
      case "version_claims":
        return await ctx.runQuery(
          internal.evidence.listClaimsForDocumentVersion,
          {
            documentVersionId: documentVersionId!,
            limit: requestedLimit,
          },
        );
      case "claim_timeline":
        // Reuse the evidence projection so this authenticated transport keeps
        // its per-revision public-visibility and citation joins intact.
        return await ctx.runQuery(internal.evidence.listPublicClaimTimeline, {
          claimKey: claimKey!,
          limit: requestedLimit,
        });
      case "research_create": {
        const job = await ctx.runMutation(
          internal.evidenceJobs.createResearchJob,
          {
            ownerUserId: principal.ownerUserId,
            agentId: principal.agentId,
            query: researchQuery!,
            idempotencyKey: args.idempotencyKey,
            requestFingerprint: args.requestFingerprint,
            quotaUnits: requestedUnits,
          },
        );
        if (!job.idempotent) {
          await ctx.scheduler.runAfter(
            0,
            internal.evidenceJobWorkflows.startResearchWorkflow,
            { jobId: job.jobId },
          );
        }
        return await ctx.runQuery(internal.evidenceJobs.getResearchJob, {
          ownerUserId: principal.ownerUserId,
          jobId: job.jobId,
        });
      }
      case "research_get":
        return await ctx.runQuery(internal.evidenceJobs.getResearchJob, {
          ownerUserId: principal.ownerUserId,
          jobId: researchJobId!,
        });
      case "export_create": {
        const job = await ctx.runMutation(
          internal.evidenceJobs.createExportJob,
          {
            ownerUserId: principal.ownerUserId,
            agentId: principal.agentId,
            datasetId: datasetId!,
            format: "jsonl",
            recordLimit: requestedExportRecordLimit!,
            idempotencyKey: args.idempotencyKey,
            requestFingerprint: args.requestFingerprint,
            quotaUnits: requestedUnits,
          },
        );
        if (!job.idempotent) {
          await ctx.scheduler.runAfter(
            0,
            internal.evidenceJobWorkflows.startExportWorkflow,
            { jobId: job.jobId },
          );
        }
        return await ctx.runQuery(internal.evidenceJobs.getExportJob, {
          ownerUserId: principal.ownerUserId,
          jobId: job.jobId,
        });
      }
      case "export_get":
        return await ctx.runQuery(internal.evidenceJobs.getExportJob, {
          ownerUserId: principal.ownerUserId,
          jobId: exportJobId!,
        });
      case "research_artifact":
      case "export_artifact":
      case "export_manifest": {
        const kind =
          args.operation === "research_artifact"
            ? "research"
            : args.operation === "export_manifest"
              ? "export-manifest"
              : "export";
        const artifact = await ctx.runQuery(
          internal.evidenceJobs.resolveArtifactDownload,
          {
            agentUserId: principal.agentUserId,
            kind,
            researchJobId:
              args.operation === "research_artifact"
                ? (researchJobId as Id<"evidenceResearchJobs">)
                : undefined,
            exportJobId:
              args.operation === "export_artifact" ||
              args.operation === "export_manifest"
                ? (exportJobId as Id<"evidenceExportJobs">)
                : undefined,
          },
        );
        if (artifact === null) return null;
        const base = "https://www.symbaiex.com/api/agent/v1";
        const path =
          args.operation === "research_artifact"
            ? `/research-jobs/${researchJobId}/artifact`
            : args.operation === "export_manifest"
              ? `/exports/${exportJobId}/manifest`
              : `/exports/${exportJobId}/artifact`;
        return {
          downloadUrl: `${base}${path}`,
          contentType: artifact.contentType,
          byteLength: artifact.byteLength,
          sha256: artifact.sha256,
          generatedAt: artifact.generatedAt,
          expiresAt: artifact.expiresAt,
        };
      }
      case "webhooks_list":
        operationResult = await ctx.runQuery(
          api.evidenceWebhooks.listMySubscriptions,
          {},
        );
        break;
      case "webhooks_create":
        operationResult = await ctx.runMutation(
          api.evidenceWebhooks.createSubscription,
          {
            subscriptionKey: webhookSubscriptionKey!,
            url: webhookUrl!,
            eventTypes: webhookEventTypes!,
          },
        );
        break;
      case "webhooks_status":
        operationResult = await ctx.runMutation(
          api.evidenceWebhooks.setSubscriptionStatus,
          {
            subscriptionKey: webhookSubscriptionKey!,
            status: webhookStatus!,
          },
        );
        break;
      case "webhooks_health":
        operationResult = await ctx.runQuery(
          api.evidenceWebhooks.getSubscriptionHealth,
          {
            subscriptionKey: webhookSubscriptionKey!,
          },
        );
        break;
      case "webhooks_history":
        operationResult = await ctx.runQuery(
          api.evidenceWebhooks.listDeliveryHistory,
          {
            subscriptionKey: webhookSubscriptionKey!,
            limit: requestedLimit,
          },
        );
        break;
      case "webhooks_rotate":
        operationResult = await ctx.runMutation(
          api.evidenceWebhooks.rotateSigningSecret,
          { subscriptionKey: webhookSubscriptionKey! },
        );
        break;
      case "webhooks_replay":
        operationResult = await ctx.runMutation(
          api.evidenceWebhooks.replayDelivery,
          {
            subscriptionKey: webhookSubscriptionKey!,
            eventKey: webhookEventKey!,
          },
        );
        break;
      case "webhooks_test":
        operationResult = await ctx.runMutation(
          api.evidenceWebhooks.sendTestEvent,
          {
            subscriptionKey: webhookSubscriptionKey!,
            eventType: webhookEventType!,
          },
        );
        break;
    }
    if (WEBHOOK_IDEMPOTENT_OPERATIONS.has(args.operation)) {
      await storeWebhookCommandResult(
        ctx,
        commerceCommand.commandId,
        args.operation,
        operationResult,
      );
    }
    return operationResult;
  },
});
