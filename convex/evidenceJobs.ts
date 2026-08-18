import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

const MAX_QUERY_LENGTH = 300;
const MAX_EXPORT_LIMIT = 100;
const JOB_TTL_MS = 24 * 60 * 60 * 1_000;
const enqueueWebhookRef = makeFunctionReference<
  "mutation",
  {
    eventKey: string;
    eventType: "evidence.research.completed" | "evidence.export.completed";
    payloadJson: string;
  },
  { eventId: Id<"apiWebhookEvents"> | null; enqueued: number }
>("evidenceWebhooks:enqueueEvent");

const JOB_STATUS = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);
const RESEARCH_JOB_RESULT = v.object({
  jobId: v.id("evidenceResearchJobs"),
  status: JOB_STATUS,
  resultJson: v.string(),
  errorMessage: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});
const EXPORT_JOB_RESULT = v.object({
  jobId: v.id("evidenceExportJobs"),
  status: JOB_STATUS,
  resultJson: v.string(),
  errorMessage: v.string(),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
  checksum: v.string(),
  recordCount: v.number(),
  format: v.union(v.literal("jsonl"), v.literal("parquet")),
});
const EXPORTED_DOCUMENT = v.object({
  documentId: v.id("evidenceDocuments"),
  versionId: v.union(v.id("evidenceDocumentVersions"), v.null()),
  title: v.string(),
  excerpt: v.string(),
  canonicalUrl: v.string(),
  kind: v.union(
    v.literal("document"),
    v.literal("advisory"),
    v.literal("release"),
    v.literal("paper"),
    v.literal("dataset"),
    v.literal("benchmark"),
  ),
  licenseClass: v.union(
    v.literal("public-domain"),
    v.literal("open"),
    v.literal("attributed"),
    v.literal("restricted"),
    v.literal("unknown"),
  ),
  publishedAt: v.union(v.number(), v.null()),
  updatedAt: v.number(),
});

function bounded(value: string, name: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new ConvexError({
      code: "INVALID_EVIDENCE_JOB_VALUE",
      message: `${name} must be between 1 and ${maximum} characters.`,
    });
  }
  return normalized;
}

function boundedUnits(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new ConvexError({
      code: "INVALID_EVIDENCE_JOB_QUOTA",
      message: "quotaUnits must be a positive bounded integer.",
    });
  }
  return value;
}

async function requireOwnedAgent(
  ctx: QueryCtx | MutationCtx,
  ownerUserId: Id<"users">,
  agentId: string,
) {
  const identity = await ctx.db
    .query("agentIdentities")
    .withIndex("by_agentId", (q) => q.eq("agentId", agentId))
    .unique();
  if (
    identity === null ||
    identity.ownerUserId !== ownerUserId ||
    identity.status !== "active"
  ) {
    throw new ConvexError({
      code: "EVIDENCE_JOB_AGENT_DENIED",
      message: "An active agent owned by this user is required.",
    });
  }
}

async function ownedDataset(
  ctx: QueryCtx | MutationCtx,
  datasetId: Id<"evidenceDatasets">,
) {
  const dataset = await ctx.db.get("evidenceDatasets", datasetId);
  if (
    dataset === null ||
    dataset.status !== "active" ||
    dataset.visibility !== "public"
  ) {
    throw new ConvexError({
      code: "EVIDENCE_DATASET_UNAVAILABLE",
      message: "Only active public datasets can be exported.",
    });
  }
  return dataset;
}

function publicResearchJob(job: Doc<"evidenceResearchJobs">) {
  return {
    jobId: job._id,
    status: job.status,
    resultJson: job.resultJson,
    errorMessage: job.errorMessage,
    expiresAt: job.expiresAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
function publicExportJob(job: Doc<"evidenceExportJobs">) {
  return {
    jobId: job._id,
    status: job.status,
    resultJson: job.resultJson,
    errorMessage: job.errorMessage,
    expiresAt: job.expiresAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    checksum: job.checksum,
    recordCount: job.recordCount,
    format: job.format,
  };
}

/** Creates an owned, replay-safe research job. The transport derives all identity values server-side. */
export const createResearchJob = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    agentId: v.string(),
    query: v.string(),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
    quotaUnits: v.number(),
  },
  returns: v.object({
    jobId: v.id("evidenceResearchJobs"),
    idempotent: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const agentId = bounded(args.agentId, "agentId", 160).toLowerCase();
    const query = bounded(args.query, "query", MAX_QUERY_LENGTH);
    const idempotencyKey = bounded(args.idempotencyKey, "idempotencyKey", 160);
    const requestFingerprint = bounded(
      args.requestFingerprint,
      "requestFingerprint",
      160,
    );
    const quotaUnits = boundedUnits(args.quotaUnits);
    await requireOwnedAgent(ctx, args.ownerUserId, agentId);
    const existing = await ctx.db
      .query("evidenceResearchJobs")
      .withIndex("by_ownerUserId_and_idempotencyKey", (q) =>
        q
          .eq("ownerUserId", args.ownerUserId)
          .eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.requestFingerprint !== requestFingerprint)
        throw new ConvexError({
          code: "EVIDENCE_JOB_IDEMPOTENCY_MISMATCH",
          message:
            "idempotencyKey was already used with a different request fingerprint.",
        });
      return { jobId: existing._id, idempotent: true };
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("evidenceResearchJobs", {
      ownerUserId: args.ownerUserId,
      agentId,
      requestKey: `${agentId}:research:${idempotencyKey}`,
      requestFingerprint,
      idempotencyKey,
      quotaUnits,
      status: "queued",
      query,
      resultJson: "",
      errorMessage: "",
      expiresAt: now + JOB_TTL_MS,
      createdAt: now,
      updatedAt: now,
    });
    return { jobId, idempotent: false };
  },
});

export const createExportJob = internalMutation({
  args: {
    ownerUserId: v.id("users"),
    agentId: v.string(),
    datasetId: v.id("evidenceDatasets"),
    format: v.union(v.literal("jsonl"), v.literal("parquet")),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
    quotaUnits: v.number(),
  },
  returns: v.object({
    jobId: v.id("evidenceExportJobs"),
    idempotent: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const agentId = bounded(args.agentId, "agentId", 160).toLowerCase();
    const idempotencyKey = bounded(args.idempotencyKey, "idempotencyKey", 160);
    const requestFingerprint = bounded(
      args.requestFingerprint,
      "requestFingerprint",
      160,
    );
    const quotaUnits = boundedUnits(args.quotaUnits);
    await requireOwnedAgent(ctx, args.ownerUserId, agentId);
    await ownedDataset(ctx, args.datasetId);
    const existing = await ctx.db
      .query("evidenceExportJobs")
      .withIndex("by_ownerUserId_and_idempotencyKey", (q) =>
        q
          .eq("ownerUserId", args.ownerUserId)
          .eq("idempotencyKey", idempotencyKey),
      )
      .unique();
    if (existing !== null) {
      if (existing.requestFingerprint !== requestFingerprint)
        throw new ConvexError({
          code: "EVIDENCE_JOB_IDEMPOTENCY_MISMATCH",
          message:
            "idempotencyKey was already used with a different request fingerprint.",
        });
      return { jobId: existing._id, idempotent: true };
    }
    const now = Date.now();
    const jobId = await ctx.db.insert("evidenceExportJobs", {
      ownerUserId: args.ownerUserId,
      agentId,
      datasetId: args.datasetId,
      requestKey: `${agentId}:export:${idempotencyKey}`,
      requestFingerprint,
      idempotencyKey,
      quotaUnits,
      status: "queued",
      format: args.format,
      checksum: "",
      recordCount: 0,
      resultJson: "",
      errorMessage: "",
      expiresAt: now + JOB_TTL_MS,
      createdAt: now,
      updatedAt: now,
    });
    return { jobId, idempotent: false };
  },
});

export const getResearchJob = internalQuery({
  args: { ownerUserId: v.id("users"), jobId: v.id("evidenceResearchJobs") },
  returns: v.union(v.null(), RESEARCH_JOB_RESULT),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceResearchJobs", args.jobId);
    return job !== null && job.ownerUserId === args.ownerUserId
      ? publicResearchJob(job)
      : null;
  },
});

export const getExportJob = internalQuery({
  args: { ownerUserId: v.id("users"), jobId: v.id("evidenceExportJobs") },
  returns: v.union(v.null(), EXPORT_JOB_RESULT),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceExportJobs", args.jobId);
    return job !== null && job.ownerUserId === args.ownerUserId
      ? publicExportJob(job)
      : null;
  },
});

export const getArtifact = internalQuery({
  args: {
    ownerUserId: v.id("users"),
    researchJobId: v.optional(v.id("evidenceResearchJobs")),
    exportJobId: v.optional(v.id("evidenceExportJobs")),
  },
  returns: v.union(
    v.null(),
    v.object({ storageId: v.id("_storage"), expiresAt: v.number() }),
  ),
  handler: async (ctx, args) => {
    if ((args.researchJobId === undefined) === (args.exportJobId === undefined))
      throw new ConvexError({
        code: "INVALID_EVIDENCE_ARTIFACT",
        message: "Specify exactly one job.",
      });
    const job =
      args.researchJobId === undefined
        ? await ctx.db.get("evidenceExportJobs", args.exportJobId!)
        : await ctx.db.get("evidenceResearchJobs", args.researchJobId);
    if (
      job === null ||
      job.ownerUserId !== args.ownerUserId ||
      job.resultStorageId === undefined ||
      job.expiresAt <= Date.now()
    )
      return null;
    return { storageId: job.resultStorageId, expiresAt: job.expiresAt };
  },
});

export const readResearchInput = internalQuery({
  args: { jobId: v.id("evidenceResearchJobs") },
  returns: v.union(
    v.null(),
    v.object({ query: v.string(), status: JOB_STATUS }),
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceResearchJobs", args.jobId);
    return job === null ? null : { query: job.query, status: job.status };
  },
});

export const readExportInput = internalQuery({
  args: { jobId: v.id("evidenceExportJobs") },
  returns: v.union(
    v.null(),
    v.object({
      datasetId: v.id("evidenceDatasets"),
      format: v.union(v.literal("jsonl"), v.literal("parquet")),
      status: JOB_STATUS,
    }),
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceExportJobs", args.jobId);
    return job === null
      ? null
      : { datasetId: job.datasetId, format: job.format, status: job.status };
  },
});

export const readExportDocuments = internalQuery({
  args: { datasetId: v.id("evidenceDatasets"), limit: v.optional(v.number()) },
  returns: v.array(EXPORTED_DOCUMENT),
  handler: async (ctx, args) => {
    await ownedDataset(ctx, args.datasetId);
    const limit = Math.max(
      1,
      Math.min(MAX_EXPORT_LIMIT, Math.floor(args.limit ?? MAX_EXPORT_LIMIT)),
    );
    const documents = await ctx.db
      .query("evidenceDocuments")
      .withIndex("by_visibility_and_updatedAt", (q) =>
        q.eq("visibility", "public"),
      )
      .order("desc")
      .take(limit);
    return documents.map((document) => ({
      documentId: document._id,
      versionId: document.currentVersionId,
      title: document.title,
      excerpt: document.excerpt,
      canonicalUrl: document.canonicalUrl,
      kind: document.kind,
      licenseClass: document.licenseClass,
      publishedAt: document.publishedAt,
      updatedAt: document.updatedAt,
    }));
  },
});

export const markResearchRunning = internalMutation({
  args: { jobId: v.id("evidenceResearchJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceResearchJobs", args.jobId);
    if (job !== null && job.status === "queued")
      await ctx.db.patch("evidenceResearchJobs", job._id, {
        status: "running",
        updatedAt: Date.now(),
      });
    return null;
  },
});
export const markExportRunning = internalMutation({
  args: { jobId: v.id("evidenceExportJobs") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceExportJobs", args.jobId);
    if (job !== null && job.status === "queued")
      await ctx.db.patch("evidenceExportJobs", job._id, {
        status: "running",
        updatedAt: Date.now(),
      });
    return null;
  },
});
export const completeResearchJob = internalMutation({
  args: {
    jobId: v.id("evidenceResearchJobs"),
    resultJson: v.string(),
    resultStorageId: v.optional(v.id("_storage")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceResearchJobs", args.jobId);
    if (job !== null && job.status !== "completed") {
      await ctx.db.patch("evidenceResearchJobs", job._id, {
        status: "completed",
        resultJson: args.resultJson.slice(0, 100_000),
        resultStorageId: args.resultStorageId,
        errorMessage: "",
        updatedAt: Date.now(),
      });
      await ctx.runMutation(enqueueWebhookRef, {
        eventKey: `research:${job._id}:completed`,
        eventType: "evidence.research.completed",
        payloadJson: JSON.stringify({
          researchJobId: job._id,
          status: "completed",
          expiresAt: job.expiresAt,
        }),
      });
    }
    return null;
  },
});
export const completeExportJob = internalMutation({
  args: {
    jobId: v.id("evidenceExportJobs"),
    resultJson: v.string(),
    resultStorageId: v.id("_storage"),
    checksum: v.string(),
    recordCount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceExportJobs", args.jobId);
    if (job !== null && job.status !== "completed") {
      await ctx.db.patch("evidenceExportJobs", job._id, {
        status: "completed",
        resultJson: args.resultJson.slice(0, 20_000),
        resultStorageId: args.resultStorageId,
        checksum: bounded(args.checksum, "checksum", 128),
        recordCount: Math.max(
          0,
          Math.min(MAX_EXPORT_LIMIT, Math.floor(args.recordCount)),
        ),
        errorMessage: "",
        updatedAt: Date.now(),
      });
      const existingVersion = await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_datasetId_and_checksum", (q) =>
          q.eq("datasetId", job.datasetId).eq("checksum", args.checksum),
        )
        .unique();
      if (existingVersion === null) {
        const version = `${new Date().toISOString().slice(0, 10)}-${args.checksum.slice(0, 12)}`;
        const datasetVersionId = await ctx.db.insert(
          "evidenceDatasetVersions",
          {
            datasetId: job.datasetId,
            version,
            checksum: args.checksum,
            recordCount: Math.max(
              0,
              Math.min(MAX_EXPORT_LIMIT, Math.floor(args.recordCount)),
            ),
            manifestStorageId: args.resultStorageId,
            createdAt: Date.now(),
          },
        );
        await ctx.db.insert("evidenceChangeEvents", {
          eventKey: `dataset:${job.datasetId}:version:${version}`,
          entityType: "dataset",
          entityId: datasetVersionId,
          kind: "updated",
          visibility: "public",
          summary:
            `Published dataset snapshot ${version} with ${args.recordCount} records.`.slice(
              0,
              1_000,
            ),
          occurredAt: Date.now(),
          createdAt: Date.now(),
        });
      }
      await ctx.runMutation(enqueueWebhookRef, {
        eventKey: `export:${job._id}:completed`,
        eventType: "evidence.export.completed",
        payloadJson: JSON.stringify({
          exportJobId: job._id,
          status: "completed",
          checksum: args.checksum,
          recordCount: args.recordCount,
          expiresAt: job.expiresAt,
        }),
      });
    }
    return null;
  },
});
export const failResearchJob = internalMutation({
  args: { jobId: v.id("evidenceResearchJobs"), errorMessage: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceResearchJobs", args.jobId);
    if (job !== null && job.status !== "completed")
      await ctx.db.patch("evidenceResearchJobs", job._id, {
        status: "failed",
        errorMessage: args.errorMessage.slice(0, 1_000),
        updatedAt: Date.now(),
      });
    return null;
  },
});
export const failExportJob = internalMutation({
  args: { jobId: v.id("evidenceExportJobs"), errorMessage: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceExportJobs", args.jobId);
    if (job !== null && job.status !== "completed")
      await ctx.db.patch("evidenceExportJobs", job._id, {
        status: "failed",
        errorMessage: args.errorMessage.slice(0, 1_000),
        updatedAt: Date.now(),
      });
    return null;
  },
});

/** Removes only expired stored artifacts; job records remain available as audit history. */
export const cleanupExpiredArtifacts = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ researchCleared: v.number(), exportCleared: v.number() }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 50)));
    const now = Date.now();
    const research = (
      await ctx.db.query("evidenceResearchJobs").take(limit)
    ).filter(
      (job) => job.expiresAt <= now && job.resultStorageId !== undefined,
    );
    const exports = (
      await ctx.db.query("evidenceExportJobs").take(limit)
    ).filter(
      (job) => job.expiresAt <= now && job.resultStorageId !== undefined,
    );
    for (const job of research) {
      await ctx.storage.delete(job.resultStorageId!);
      await ctx.db.patch("evidenceResearchJobs", job._id, {
        resultStorageId: undefined,
        updatedAt: now,
      });
    }
    for (const job of exports) {
      await ctx.storage.delete(job.resultStorageId!);
      await ctx.db.patch("evidenceExportJobs", job._id, {
        resultStorageId: undefined,
        updatedAt: now,
      });
    }
    return { researchCleared: research.length, exportCleared: exports.length };
  },
});

const PRODUCTS = [
  "search",
  "change",
  "verify",
  "research",
  "export",
  "benchmarks",
  "mcp",
  "webhooks",
] as const;
export const ensureCatalog = internalMutation({
  args: {},
  returns: v.object({
    datasetId: v.id("evidenceDatasets"),
    billingEnabled: v.boolean(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    for (const key of PRODUCTS) {
      const productKey = `evidence-${key}`;
      if (
        await ctx.db
          .query("apiProducts")
          .withIndex("by_productKey", (q) => q.eq("productKey", productKey))
          .unique()
      )
        continue;
      await ctx.db.insert("apiProducts", {
        productKey,
        name: `Evidence ${key}`,
        description: `Disabled-monetization evidence ${key} operation.`,
        status: "active",
        visibility: "public",
        createdAt: now,
        updatedAt: now,
      });
    }
    let dataset = await ctx.db
      .query("evidenceDatasets")
      .withIndex("by_datasetKey", (q) =>
        q.eq("datasetKey", "ai-systems-evidence"),
      )
      .unique();
    if (dataset === null) {
      const id = await ctx.db.insert("evidenceDatasets", {
        datasetKey: "ai-systems-evidence",
        name: "AI systems evidence",
        description:
          "Bounded public metadata and excerpts for AI systems evidence.",
        visibility: "public",
        licenseClass: "attributed",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      dataset = (await ctx.db.get("evidenceDatasets", id))!;
    }
    if (
      (await ctx.db
        .query("evidenceBenchmarks")
        .withIndex("by_benchmarkKey", (q) =>
          q.eq("benchmarkKey", "evidence-citation-coverage"),
        )
        .unique()) === null
    )
      await ctx.db.insert("evidenceBenchmarks", {
        benchmarkKey: "evidence-citation-coverage",
        name: "Evidence citation coverage",
        description:
          "Operational benchmark for cited public-evidence coverage.",
        visibility: "public",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    return { datasetId: dataset._id, billingEnabled: false };
  },
});
