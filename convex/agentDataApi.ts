import { ConvexError, v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { AgentQuotaConsumeResult } from "./agentQuota";
import { requireAgentScope, requireAuthenticatedUser } from "./authz";

const operationValidator = v.union(
  v.literal("status"),
  v.literal("sources"),
  v.literal("search"),
  v.literal("document"),
  v.literal("changes"),
  v.literal("verify"),
  v.literal("entities"),
  v.literal("version_claims"),
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
  v.literal("webhooks_list"),
  v.literal("webhooks_create"),
  v.literal("webhooks_status"),
);

type Operation =
  | "status"
  | "sources"
  | "search"
  | "document"
  | "changes"
  | "verify"
  | "entities"
  | "version_claims"
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
  | "webhooks_list"
  | "webhooks_create"
  | "webhooks_status";

type EvidenceIdTable =
  | "evidenceDocuments"
  | "evidenceDocumentVersions"
  | "evidenceClaims"
  | "evidenceDatasets"
  | "evidenceResearchJobs"
  | "evidenceExportJobs";

const MAX_LIMIT = 50;

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
    agentId: identity.agentId,
    ownerUserId: identity.ownerUserId,
  };
}

function productForOperation(operation: Operation) {
  if (operation === "changes") return "evidence-change";
  if (operation === "verify") return "evidence-verify";
  if (operation === "version_claims") return "evidence-verify";
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
        operations: ["search", "verify", "research", "export", "mcp"],
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
    const datasetId =
      args.operation === "export_create"
        ? normalizedId(ctx, "evidenceDatasets", input, "datasetId")
        : null;
    const researchJobId =
      args.operation === "research_get" ||
      args.operation === "research_artifact"
        ? normalizedId(ctx, "evidenceResearchJobs", input, "jobId")
        : null;
    const exportJobId =
      args.operation === "export_get" || args.operation === "export_artifact"
        ? normalizedId(ctx, "evidenceExportJobs", input, "jobId")
        : null;
    const search =
      args.operation === "search" ? requiredText(input, "query", 300) : null;
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
      args.operation === "webhooks_status"
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
    await ctx.runMutation(api.apiCommerce.beginOrReplayCommand, {
      agentId: principal.agentId,
      productKey: productForOperation(args.operation),
      idempotencyKey: args.idempotencyKey,
      requestFingerprint: args.requestFingerprint,
      operation: `evidence.${args.operation}`,
      units: requestedUnits,
      metadataJson: "{}",
    });

    switch (args.operation) {
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
      case "export_artifact": {
        const artifact = await ctx.runQuery(internal.evidenceJobs.getArtifact, {
          ownerUserId: principal.ownerUserId,
          researchJobId:
            args.operation === "research_artifact"
              ? (researchJobId as Id<"evidenceResearchJobs">)
              : undefined,
          exportJobId:
            args.operation === "export_artifact"
              ? (exportJobId as Id<"evidenceExportJobs">)
              : undefined,
        });
        if (artifact === null) return null;
        const downloadUrl = await ctx.storage.getUrl(artifact.storageId);
        return downloadUrl === null
          ? null
          : { downloadUrl, expiresAt: artifact.expiresAt };
      }
      case "webhooks_list":
        return await ctx.runQuery(api.evidenceWebhooks.listMySubscriptions, {});
      case "webhooks_create":
        return await ctx.runMutation(api.evidenceWebhooks.createSubscription, {
          subscriptionKey: webhookSubscriptionKey!,
          url: webhookUrl!,
          eventTypes: webhookEventTypes!,
        });
      case "webhooks_status":
        return await ctx.runMutation(
          api.evidenceWebhooks.setSubscriptionStatus,
          {
            subscriptionKey: webhookSubscriptionKey!,
            status: webhookStatus!,
          },
        );
    }
  },
});
