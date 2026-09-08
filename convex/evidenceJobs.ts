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
export const DEFAULT_EXPORT_LIMIT = 100;
export const MAX_EXPORT_LIMIT = 500;
const MAX_EXPORT_SCAN = 500;
const MAX_EXPORT_CITATIONS_PER_RECORD = 50;
// Convex pagination cursors are opaque and can be longer than a small numeric
// offset. Keep this bounded while leaving enough room for one native cursor.
const MAX_EXPORT_CURSOR_LENGTH = 4_096;
const JOB_TTL_MS = 24 * 60 * 60 * 1_000;
// Provider calls are bounded to two minutes. A much wider lease avoids
// declaring healthy work stale while still giving duplicate workflow starts a
// deterministic way to terminally fail abandoned executions without rerunning
// paid/non-idempotent external work.
const EXECUTION_STALE_MS = 30 * 60 * 1_000;
const enqueueWebhookRef = makeFunctionReference<
  "mutation",
  {
    eventKey: string;
    eventType: "evidence.research.completed" | "evidence.export.completed";
    payloadJson: string;
  },
  { eventId: Id<"apiWebhookEvents"> | null; enqueued: number }
>("evidenceWebhooks:enqueueEvent");
const readSourceExportPageRef = makeFunctionReference<
  "query",
  { sourceId: Id<"evidenceSources">; snapshotAt: number; cursor: string | null; limit: number },
  { documents: Doc<"evidenceDocuments">[]; isDone: boolean; continueCursor: string }
>("evidenceJobs:readSourceExportPage");

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
  continueCursor: v.optional(v.string()),
  artifactByteLength: v.optional(v.number()),
});
const EXPORTED_DOCUMENT = v.object({
  schemaVersion: v.string(),
  datasetKey: v.string(),
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
  tags: v.array(v.string()),
  authors: v.array(v.string()),
  publishedAt: v.union(v.number(), v.null()),
  firstSeenAt: v.number(),
  updatedAt: v.number(),
  source: v.object({
    sourceKey: v.string(),
    name: v.string(),
    homepageUrl: v.string(),
    termsUrl: v.string(),
    provenanceClass: v.string(),
    licenseClass: v.string(),
  }),
  version: v.union(
    v.null(),
    v.object({
      version: v.number(),
      contentHash: v.string(),
      fetchedAt: v.number(),
      sourceRevision: v.string(),
      sourceUpdatedAt: v.number(),
      retrievalUrl: v.string(),
      metadataJson: v.string(),
    }),
  ),
  entities: v.array(
    v.object({
      entityKey: v.string(),
      kind: v.string(),
      name: v.string(),
      aliases: v.array(v.string()),
      role: v.string(),
    }),
  ),
  claims: v.array(
    v.object({
      claimKey: v.string(),
      statement: v.string(),
      predicate: v.string(),
      objectText: v.string(),
      status: v.string(),
      confidence: v.number(),
      observedAt: v.number(),
      relation: v.string(),
      locator: v.string(),
      excerpt: v.string(),
    }),
  ),
  citationMetrics: v.object({
    total: v.number(),
    supports: v.number(),
    contradicts: v.number(),
    context: v.number(),
    truncated: v.boolean(),
  }),
});
const EXPORT_RECORDS = v.object({
  dataset: v.object({
    datasetKey: v.string(),
    name: v.string(),
    description: v.string(),
    includedKinds: v.array(v.string()),
    includedLicenseClasses: v.array(v.string()),
    sourceKeys: v.array(v.string()),
    exportSchemaVersion: v.string(),
  }),
  scannedRecordCount: v.number(),
  selectionScanTruncated: v.boolean(),
  selectionStrategy: v.union(v.literal("balanced"), v.literal("recent")),
  snapshotAt: v.number(),
  continueCursor: v.optional(v.string()),
  records: v.array(EXPORTED_DOCUMENT),
});

type LegacyExportCursor = {
  v: 1;
  datasetId: string;
  selectionStrategy: "balanced" | "recent";
  snapshotAt: number;
  offset: number;
};

/**
 * A per-source native Convex cursor lets a snapshot walk arbitrarily deep
 * without repeatedly materializing a capped prefix in application memory.
 * Sources are traversed deterministically; callers retain snapshotAt so new
 * documents cannot move the page boundary during an export.
 */
type ExportCursor = {
  v: 2;
  datasetId: string;
  selectionStrategy: "balanced" | "recent";
  snapshotAt: number;
  /** Native Convex cursors keyed by sourceKey for the balanced walk. */
  sourceCursors?: Record<string, string | null>;
  doneSourceKeys?: string[];
  /** Ordered-source offset used to rotate sparse balanced pages fairly. */
  nextSourceOffset?: number;
  /** Native cursor on the global public-documents index for recent order. */
  recentCursor?: string | null;
};

function decodeExportCursor(
  cursor: string | undefined,
  datasetId: Id<"evidenceDatasets">,
  strategy: "balanced" | "recent",
): ExportCursor | null {
  if (cursor === undefined) return null;
  if (cursor.length > MAX_EXPORT_CURSOR_LENGTH)
    throw new ConvexError({ code: "INVALID_EXPORT_CURSOR", message: "Export cursor is too long." });
  try {
    const value = JSON.parse(decodeURIComponent(cursor)) as Partial<ExportCursor | LegacyExportCursor>;
    if (
      value.v === 1 &&
      value.datasetId === String(datasetId) &&
      value.selectionStrategy === strategy &&
      Number.isSafeInteger(value.snapshotAt) &&
      (value.snapshotAt ?? 0) > 0
    ) {
      // v1 only represented an offset into a capped in-memory scan. Restarting
      // at the stable snapshot is intentionally preferable to silently losing
      // records beyond that cap. New cursors are always v2.
      return {
        v: 2,
        datasetId: String(datasetId),
        selectionStrategy: strategy,
        snapshotAt: value.snapshotAt!,
      };
    }
    const v2Value = value as Partial<ExportCursor>;
    const sourceCursors = v2Value.sourceCursors;
    const validSourceCursors =
      sourceCursors === undefined ||
      (typeof sourceCursors === "object" &&
        sourceCursors !== null &&
        !Array.isArray(sourceCursors) &&
        Object.entries(sourceCursors).every(
          ([key, sourceCursor]) =>
            key.length > 0 &&
            (sourceCursor === null || typeof sourceCursor === "string"),
        ));
    const validDoneSourceKeys =
      v2Value.doneSourceKeys === undefined ||
      (Array.isArray(v2Value.doneSourceKeys) &&
        v2Value.doneSourceKeys.every((key: unknown) => typeof key === "string" && key.length > 0));
    if (
      value.v !== 2 ||
      value.datasetId !== String(datasetId) ||
      value.selectionStrategy !== strategy ||
      !Number.isSafeInteger(value.snapshotAt) ||
      (value.snapshotAt ?? 0) <= 0 ||
      !validSourceCursors ||
      !validDoneSourceKeys ||
      (v2Value.recentCursor !== undefined &&
        v2Value.recentCursor !== null &&
        typeof v2Value.recentCursor !== "string") ||
      (v2Value.nextSourceOffset !== undefined &&
        (!Number.isSafeInteger(v2Value.nextSourceOffset) ||
          v2Value.nextSourceOffset < 0))
    )
      throw new Error("mismatch");
    return value as ExportCursor;
  } catch {
    throw new ConvexError({
      code: "INVALID_EXPORT_CURSOR",
      message: "Export cursor is invalid or does not match this dataset and selection strategy.",
    });
  }
}

function encodeExportCursor(value: ExportCursor) {
  return encodeURIComponent(JSON.stringify(value));
}
const ARTIFACT_DOWNLOAD = v.object({
  storageId: v.id("_storage"),
  contentType: v.string(),
  byteLength: v.number(),
  sha256: v.string(),
  generatedAt: v.number(),
  expiresAt: v.number(),
  filename: v.string(),
});
const DATASET_VERSION_SUMMARY = v.object({
  versionId: v.id("evidenceDatasetVersions"),
  version: v.string(),
  parentVersionId: v.optional(v.id("evidenceDatasetVersions")),
  checksum: v.string(),
  format: v.union(v.literal("jsonl"), v.literal("parquet")),
  recordCount: v.number(),
  artifactByteLength: v.number(),
  sourceCoverageScore: v.number(),
  citationCoverageScore: v.number(),
  entityCoverageScore: v.number(),
  claimCoverageScore: v.number(),
  createdAt: v.number(),
});

function publicDatasetVersion(version: Doc<"evidenceDatasetVersions">) {
  return {
    versionId: version._id,
    version: version.version,
    parentVersionId: version.parentVersionId,
    checksum: version.checksum,
    format: version.format ?? ("jsonl" as const),
    recordCount: version.recordCount,
    artifactByteLength: version.artifactByteLength ?? 0,
    sourceCoverageScore: version.sourceCoverageScore ?? 0,
    citationCoverageScore: version.citationCoverageScore ?? 0,
    entityCoverageScore: version.entityCoverageScore ?? 0,
    claimCoverageScore: version.claimCoverageScore ?? 0,
    createdAt: version.createdAt,
  };
}

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
    continueCursor: job.continueCursor,
    artifactByteLength: job.artifactByteLength,
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
    recordLimit: v.optional(v.number()),
    selectionStrategy: v.optional(
      v.union(v.literal("balanced"), v.literal("recent")),
    ),
    cursor: v.optional(v.string()),
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
    const recordLimit = args.recordLimit ?? DEFAULT_EXPORT_LIMIT;
    const selectionStrategy = args.selectionStrategy ?? "balanced";
    if ((args.cursor?.length ?? 0) > MAX_EXPORT_CURSOR_LENGTH)
      throw new ConvexError({ code: "INVALID_EXPORT_CURSOR", message: "Export cursor is too long." });
    if (
      !Number.isSafeInteger(recordLimit) ||
      recordLimit < 1 ||
      recordLimit > MAX_EXPORT_LIMIT
    )
      throw new ConvexError({
        code: "INVALID_EVIDENCE_EXPORT_LIMIT",
        message: `recordLimit must be an integer between 1 and ${MAX_EXPORT_LIMIT}.`,
      });
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
      recordLimit,
      selectionStrategy,
      cursor: args.cursor,
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

/**
 * Resolves a download only after the request's active agent identity, owner,
 * free-beta/explicit entitlement, completed job, manifest, and retention
 * window have all been checked. This is deliberately internal: HTTP performs
 * token validation before it supplies agentUserId.
 */
export const resolveArtifactDownload = internalQuery({
  args: {
    agentUserId: v.id("users"),
    kind: v.union(
      v.literal("research"),
      v.literal("export"),
      v.literal("export-manifest"),
    ),
    researchJobId: v.optional(v.id("evidenceResearchJobs")),
    exportJobId: v.optional(v.id("evidenceExportJobs")),
  },
  returns: v.union(v.null(), ARTIFACT_DOWNLOAD),
  handler: async (ctx, args) => {
    if ((args.researchJobId === undefined) === (args.exportJobId === undefined))
      return null;
    if (
      (args.kind === "research" && args.researchJobId === undefined) ||
      ((args.kind === "export" || args.kind === "export-manifest") &&
        args.exportJobId === undefined)
    )
      return null;
    const agent = await ctx.db.get("users", args.agentUserId);
    if (
      agent?.isAgent !== true ||
      agent.agentStatus !== "active" ||
      !agent.agentScopes?.includes("evidence")
    )
      return null;
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_userId", (q) => q.eq("userId", args.agentUserId))
      .unique();
    if (
      identity === null ||
      identity.status !== "active" ||
      identity.ownerUserId === undefined
    )
      return null;
    const ownerUserId = identity.ownerUserId;
    const job =
      args.kind === "research"
        ? await ctx.db.get("evidenceResearchJobs", args.researchJobId!)
        : await ctx.db.get("evidenceExportJobs", args.exportJobId!);
    if (
      job === null ||
      job.ownerUserId !== ownerUserId ||
      job.agentId !== identity.agentId ||
      job.status !== "completed" ||
      job.expiresAt <= Date.now()
    )
      return null;
    const productKey =
      args.kind === "research" ? "evidence-research" : "evidence-export";
    const product = await ctx.db
      .query("apiProducts")
      .withIndex("by_productKey", (q) => q.eq("productKey", productKey))
      .unique();
    if (product === null || product.status !== "active") return null;
    const explicit = await ctx.db
      .query("apiEntitlements")
      .withIndex("by_ownerUserId_and_productId", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("productId", product._id),
      )
      .unique();
    const now = Date.now();
    const entitled =
      explicit !== null
        ? explicit.status === "active" &&
          explicit.startsAt <= now &&
          (explicit.expiresAt === undefined || explicit.expiresAt > now)
        : product.unitPriceMicroUsd === undefined &&
          product.visibility === "public";
    if (!entitled) return null;
    if (args.kind === "export-manifest") {
      const exportJob = job as Doc<"evidenceExportJobs">;
      const version = await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_datasetId_and_checksum", (q) =>
          q
            .eq("datasetId", exportJob.datasetId)
            .eq("checksum", exportJob.checksum),
        )
        .unique();
      if (version?.manifestStorageId === undefined) return null;
      const metadata = await ctx.db.system.get(
        "_storage",
        version.manifestStorageId,
      );
      if (metadata === null) return null;
      return {
        storageId: version.manifestStorageId,
        contentType: metadata.contentType ?? "application/json",
        byteLength: metadata.size,
        sha256: metadata.sha256,
        generatedAt: version.createdAt,
        expiresAt: exportJob.expiresAt,
        filename: `symbaiex-export-${exportJob._id}-manifest.json`,
      };
    }
    const artifact =
      args.kind === "research"
        ? await ctx.db
            .query("evidenceArtifacts")
            .withIndex("by_researchJobId", (q) =>
              q.eq("researchJobId", args.researchJobId!),
            )
            .unique()
        : await ctx.db
            .query("evidenceArtifacts")
            .withIndex("by_exportJobId", (q) =>
              q.eq("exportJobId", args.exportJobId!),
            )
            .unique();
    if (
      artifact === null ||
      artifact.ownerUserId !== ownerUserId ||
      artifact.agentId !== identity.agentId ||
      artifact.status !== "available" ||
      job.resultStorageId !== artifact.storageId ||
      artifact.expiresAt <= now
    )
      return null;
    return {
      storageId: artifact.storageId,
      contentType: artifact.contentType,
      byteLength: artifact.byteLength,
      sha256: artifact.sha256,
      generatedAt: artifact.generatedAt,
      expiresAt: artifact.expiresAt,
      filename:
        args.kind === "research"
          ? `symbaiex-research-${job._id}.json`
          : `symbaiex-export-${job._id}.${(job as Doc<"evidenceExportJobs">).format}`,
    };
  },
});

/** Resolves an immutable historical snapshot without exposing a storage URL. */
export const resolveDatasetVersionDownload = internalQuery({
  args: {
    agentUserId: v.id("users"),
    datasetId: v.id("evidenceDatasets"),
    versionId: v.id("evidenceDatasetVersions"),
    kind: v.union(v.literal("artifact"), v.literal("manifest")),
  },
  returns: v.union(v.null(), ARTIFACT_DOWNLOAD),
  handler: async (ctx, args) => {
    const agent = await ctx.db.get("users", args.agentUserId);
    if (
      agent?.isAgent !== true ||
      agent.agentStatus !== "active" ||
      !agent.agentScopes?.includes("evidence")
    )
      return null;
    const identity = await ctx.db
      .query("agentIdentities")
      .withIndex("by_userId", (q) => q.eq("userId", args.agentUserId))
      .unique();
    if (
      identity === null ||
      identity.status !== "active" ||
      identity.ownerUserId === undefined
    )
      return null;
    const dataset = await ctx.db.get("evidenceDatasets", args.datasetId);
    const version = await ctx.db.get("evidenceDatasetVersions", args.versionId);
    if (
      dataset === null ||
      dataset.status !== "active" ||
      dataset.visibility !== "public" ||
      version === null ||
      version.datasetId !== dataset._id
    )
      return null;
    const product = await ctx.db
      .query("apiProducts")
      .withIndex("by_productKey", (q) => q.eq("productKey", "evidence-export"))
      .unique();
    if (product === null || product.status !== "active") return null;
    const explicit = await ctx.db
      .query("apiEntitlements")
      .withIndex("by_ownerUserId_and_productId", (q) =>
        q.eq("ownerUserId", identity.ownerUserId!).eq("productId", product._id),
      )
      .unique();
    const now = Date.now();
    const entitled =
      explicit !== null
        ? explicit.status === "active" &&
          explicit.startsAt <= now &&
          (explicit.expiresAt === undefined || explicit.expiresAt > now)
        : product.unitPriceMicroUsd === undefined && product.visibility === "public";
    if (!entitled) return null;
    const storageId =
      args.kind === "manifest" ? version.manifestStorageId : version.artifactStorageId;
    if (storageId === undefined) return null;
    const metadata = await ctx.db.system.get("_storage", storageId);
    if (metadata === null) return null;
    const format = version.format ?? "jsonl";
    return {
      storageId,
      contentType:
        metadata.contentType ??
        (args.kind === "manifest"
          ? "application/json"
          : format === "parquet"
            ? "application/vnd.apache.parquet"
            : "application/x-ndjson"),
      byteLength: metadata.size,
      sha256: metadata.sha256,
      generatedAt: version.createdAt,
      expiresAt: now + 5 * 60_000,
      filename:
        args.kind === "manifest"
          ? `symbaiex-${dataset.datasetKey}-${version.version}-manifest.json`
          : `symbaiex-${dataset.datasetKey}-${version.version}.${format}`,
    };
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
    // Rolling-deploy guard: a token means the new workflow owns execution, so
    // an already-scheduled legacy action must stop before provider work.
    return job === null || job.executionToken !== undefined
      ? null
      : { query: job.query, status: job.status };
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
      recordLimit: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceExportJobs", args.jobId);
    return job === null || job.executionToken !== undefined
      ? null
      : {
          datasetId: job.datasetId,
          format: job.format,
          status: job.status,
          recordLimit: job.recordLimit ?? DEFAULT_EXPORT_LIMIT,
        };
  },
});

/** One native page per source. Kept separate because Convex permits one
 * `.paginate()` call per function execution; the parent can safely compose
 * these bounded pages into a balanced response. */
export const readSourceExportPage = internalQuery({
  args: {
    sourceId: v.id("evidenceSources"),
    snapshotAt: v.number(),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
  },
  returns: v.object({
    documents: v.array(v.any()),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("evidenceDocuments")
      .withIndex("by_sourceId_and_visibility_and_updatedAt", (q) =>
        q.eq("sourceId", args.sourceId).eq("visibility", "public").lte("updatedAt", args.snapshotAt),
      )
      .order("desc")
      .paginate({ cursor: args.cursor, numItems: args.limit });
    return { documents: page.page, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const readExportDocuments = internalQuery({
  args: {
    datasetId: v.id("evidenceDatasets"),
    limit: v.optional(v.number()),
    selectionStrategy: v.optional(v.union(v.literal("balanced"), v.literal("recent"))),
    cursor: v.optional(v.string()),
  },
  returns: EXPORT_RECORDS,
  handler: async (ctx, args) => {
    const dataset = await ownedDataset(ctx, args.datasetId);
    const limit = Math.max(
      1,
      Math.min(
        MAX_EXPORT_LIMIT,
        Math.floor(args.limit ?? DEFAULT_EXPORT_LIMIT),
      ),
    );
    const selectionStrategy = args.selectionStrategy ?? "balanced";
    const parsedCursor = decodeExportCursor(args.cursor, dataset._id, selectionStrategy);
    const snapshotAt = parsedCursor?.snapshotAt ?? Date.now();
    const includedKinds = dataset.includedKinds ?? [];
    const includedLicenseClasses = dataset.includedLicenseClasses ?? [
      "public-domain",
      "open",
      "attributed",
    ];
    const sourceKeys = dataset.sourceKeys ?? [];
    const allowedKinds = new Set(includedKinds);
    const allowedLicenses = new Set(includedLicenseClasses);
    const allowedSources = new Set(sourceKeys);
    const sources =
      sourceKeys.length > 0
        ? (
            await Promise.all(
              sourceKeys.map((sourceKey) =>
                ctx.db
                  .query("evidenceSources")
                  .withIndex("by_sourceKey", (q) =>
                    q.eq("sourceKey", sourceKey),
                  )
                  .unique(),
              ),
            )
          ).filter(
            (source): source is NonNullable<typeof source> =>
              source !== null &&
              source.status === "active" &&
              source.visibility === "public",
          )
        : await ctx.db
            .query("evidenceSources")
            .withIndex("by_status_and_visibility", (q) =>
              q.eq("status", "active").eq("visibility", "public"),
            )
            .take(100);
    const orderedSources = [...sources].sort((left, right) =>
      left.sourceKey.localeCompare(right.sourceKey),
    );
    const sourceById = new Map(orderedSources.map((source) => [String(source._id), source]));
    const cursorState = parsedCursor ?? {
      v: 2 as const,
      datasetId: String(dataset._id),
      selectionStrategy,
      snapshotAt,
    };
    const doneSourceKeys = new Set(cursorState.doneSourceKeys ?? []);
    let scannedRecordCount = 0;
    let selectionScanTruncated = false;
    let continueCursor: string | undefined;
    let sourceScans: Array<{ source: (typeof orderedSources)[number]; documents: Doc<"evidenceDocuments">[] }> = [];
    if (selectionStrategy === "balanced") {
      const sourceCount = orderedSources.length;
      const startOffset = sourceCount === 0
        ? 0
        : (cursorState.nextSourceOffset ?? 0) % sourceCount;
      const rotatedActiveSources = Array.from({ length: sourceCount }, (_, offset) =>
        orderedSources[(startOffset + offset) % sourceCount]!,
      ).filter((source) => !doneSourceKeys.has(source.sourceKey));
      const base = rotatedActiveSources.length === 0 ? 0 : Math.floor(limit / rotatedActiveSources.length);
      const remainder = rotatedActiveSources.length === 0 ? 0 : limit % rotatedActiveSources.length;
      const pages = await Promise.all(
        rotatedActiveSources.map(async (source, index) => {
          const requested = Math.min(MAX_EXPORT_SCAN, base + (index < remainder ? 1 : 0));
          if (requested === 0) return { source, page: null, requested };
          const page: { documents: Doc<"evidenceDocuments">[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(
            readSourceExportPageRef,
            { sourceId: source._id, snapshotAt, cursor: cursorState.sourceCursors?.[source.sourceKey] ?? null, limit: requested },
          );
          return { source, page, requested };
        }),
      );
      sourceScans = pages.flatMap(({ source, page }) => page === null ? [] : [{ source, documents: page.documents }]);
      scannedRecordCount = pages.reduce((total, entry) => total + (entry.page?.documents.length ?? 0), 0);
      selectionScanTruncated = pages.some(({ page, requested }) => page !== null && page.documents.length === requested && !page.isDone);
      const nextSourceCursors: Record<string, string | null> = {
        ...(cursorState.sourceCursors ?? {}),
      };
      for (const entry of pages) {
        if (entry.page === null) continue;
        if (entry.page.isDone) {
          doneSourceKeys.add(entry.source.sourceKey);
          delete nextSourceCursors[entry.source.sourceKey];
        }
        else nextSourceCursors[entry.source.sourceKey] = entry.page.continueCursor;
      }
      if (doneSourceKeys.size < orderedSources.length)
        // Advance from the final source that was allotted a row, even if that
        // source happened to finish. This prevents a small page from starving
        // later sources when source count exceeds its record limit.
        continueCursor = encodeExportCursor({
          ...cursorState,
          sourceCursors: nextSourceCursors,
          doneSourceKeys: [...doneSourceKeys].sort(),
          nextSourceOffset:
            sourceCount === 0 || rotatedActiveSources.length === 0
              ? 0
              : (orderedSources.findIndex(
                    (source) =>
                      source.sourceKey ===
                      rotatedActiveSources[Math.min(rotatedActiveSources.length, limit) - 1]?.sourceKey,
                  ) + 1) % sourceCount,
          recentCursor: undefined,
        });
    } else {
      // Recent order can use the global native index directly. The fetched raw
      // page is exactly the maximum returned record count, so no eligible row
      // is advanced past without being represented in this response.
      const page = await ctx.db
        .query("evidenceDocuments")
        .withIndex("by_visibility_and_updatedAt", (q) => q.eq("visibility", "public").lte("updatedAt", snapshotAt))
        .order("desc")
        .paginate({ cursor: cursorState.recentCursor ?? null, numItems: Math.min(MAX_EXPORT_SCAN, limit) });
      sourceScans = page.page.flatMap((document) => {
        const source = sourceById.get(String(document.sourceId));
        return source === undefined ? [] : [{ source, documents: [document] }];
      });
      scannedRecordCount = page.page.length;
      selectionScanTruncated = page.page.length === limit && !page.isDone;
      if (!page.isDone)
        continueCursor = encodeExportCursor({
          ...cursorState,
          sourceCursors: undefined,
          doneSourceKeys: undefined,
          recentCursor: page.continueCursor,
        });
    }
    const eligibleBySource = sourceScans.map(({ source, documents }) => ({
      source,
      documents: documents.filter(
        (document) =>
          (allowedKinds.size === 0 || allowedKinds.has(document.kind)) &&
          allowedLicenses.has(document.licenseClass) &&
          (allowedSources.size === 0 || allowedSources.has(source.sourceKey)),
      ),
    }));
    const recent = eligibleBySource
      .flatMap(({ source, documents }) => documents.map((document) => ({ document, source })))
      .sort(
        (left, right) =>
          right.document.updatedAt - left.document.updatedAt ||
          String(left.document._id).localeCompare(String(right.document._id)),
      );
    const balanced: typeof recent = [];
    const maximumBucket = Math.max(0, ...eligibleBySource.map(({ documents }) => documents.length));
    for (let index = 0; index < maximumBucket; index += 1)
      for (const bucket of eligibleBySource) {
        const document = bucket.documents[index];
        if (document !== undefined) balanced.push({ document, source: bucket.source });
      }
    const selected = (selectionStrategy === "balanced" ? balanced : recent).slice(0, limit);
    const records: Array<{
      schemaVersion: string;
      datasetKey: string;
      documentId: Id<"evidenceDocuments">;
      versionId: Id<"evidenceDocumentVersions"> | null;
      title: string;
      excerpt: string;
      canonicalUrl: string;
      kind: Doc<"evidenceDocuments">["kind"];
      licenseClass: Doc<"evidenceDocuments">["licenseClass"];
      tags: string[];
      authors: string[];
      publishedAt: number | null;
      firstSeenAt: number;
      updatedAt: number;
      source: {
        sourceKey: string;
        name: string;
        homepageUrl: string;
        termsUrl: string;
        provenanceClass: string;
        licenseClass: string;
      };
      version: null | {
        version: number;
        contentHash: string;
        fetchedAt: number;
        sourceRevision: string;
        sourceUpdatedAt: number;
        retrievalUrl: string;
        metadataJson: string;
      };
      citationMetrics: {
        total: number;
        supports: number;
        contradicts: number;
        context: number;
        truncated: boolean;
      };
      entities: Array<{
        entityKey: string;
        kind: string;
        name: string;
        aliases: string[];
        role: string;
      }>;
      claims: Array<{
        claimKey: string;
        statement: string;
        predicate: string;
        objectText: string;
        status: string;
        confidence: number;
        observedAt: number;
        relation: string;
        locator: string;
        excerpt: string;
      }>;
    }> = [];
    for (const candidate of selected) {
      const { document, source } = candidate;
      const version =
        document.currentVersionId === null
          ? null
          : await ctx.db.get(
              "evidenceDocumentVersions",
              document.currentVersionId,
            );
      const citations =
        version === null
          ? []
          : await ctx.db
              .query("evidenceClaimCitations")
              .withIndex("by_documentVersionId", (q) =>
                q.eq("documentVersionId", version._id),
              )
              .take(MAX_EXPORT_CITATIONS_PER_RECORD + 1);
      const boundedCitations = citations.slice(
        0,
        MAX_EXPORT_CITATIONS_PER_RECORD,
      );
      const entityLinks =
        version === null
          ? []
          : await ctx.db
              .query("evidenceDocumentEntities")
              .withIndex("by_documentVersionId", (q) =>
                q.eq("documentVersionId", version._id),
              )
              .take(50);
      const entities = (
        await Promise.all(
          entityLinks.map(async (link) => {
            const entity = await ctx.db.get("evidenceEntities", link.entityId);
            return entity === null || entity.visibility !== "public"
              ? null
              : {
                  entityKey: entity.entityKey,
                  kind: entity.kind,
                  name: entity.name,
                  aliases: entity.aliases,
                  role: link.role,
                };
          }),
        )
      ).filter((entity) => entity !== null);
      const claims = (
        await Promise.all(
          boundedCitations.map(async (citation) => {
            const claim = await ctx.db.get("evidenceClaims", citation.claimId);
            return claim === null || claim.visibility !== "public"
              ? null
              : {
                  claimKey: claim.claimKey,
                  statement: claim.statement,
                  predicate: claim.predicate,
                  objectText: claim.objectText,
                  status: claim.status,
                  confidence: claim.confidence,
                  observedAt: claim.observedAt,
                  relation: citation.relation,
                  locator: citation.locator,
                  excerpt: citation.excerpt,
                };
          }),
        )
      ).filter((claim) => claim !== null);
      records.push({
        schemaVersion:
          dataset.exportSchemaVersion ?? "symbaiex-evidence-document-v3",
        datasetKey: dataset.datasetKey,
        documentId: document._id,
        versionId: document.currentVersionId,
        title: document.title,
        excerpt: document.excerpt,
        canonicalUrl: document.canonicalUrl,
        kind: document.kind,
        licenseClass: document.licenseClass,
        tags: document.tags,
        authors: document.authors,
        publishedAt: document.publishedAt,
        firstSeenAt: document.firstSeenAt,
        updatedAt: document.updatedAt,
        source: {
          sourceKey: source.sourceKey,
          name: source.name,
          homepageUrl: source.homepageUrl,
          termsUrl: source.termsUrl,
          provenanceClass: source.provenanceClass,
          licenseClass: source.licenseClass,
        },
        version:
          version === null
            ? null
            : {
                version: version.version,
                contentHash: version.contentHash,
                fetchedAt: version.fetchedAt,
                sourceRevision: version.sourceRevision,
                sourceUpdatedAt: version.sourceUpdatedAt,
                retrievalUrl: version.retrievalUrl,
                metadataJson: version.metadataJson,
              },
        entities,
        claims,
        citationMetrics: {
          total: boundedCitations.length,
          supports: boundedCitations.filter(
            (citation) => citation.relation === "supports",
          ).length,
          contradicts: boundedCitations.filter(
            (citation) => citation.relation === "contradicts",
          ).length,
          context: boundedCitations.filter(
            (citation) => citation.relation === "context",
          ).length,
          truncated: citations.length > MAX_EXPORT_CITATIONS_PER_RECORD,
        },
      });
    }
    return {
      dataset: {
        datasetKey: dataset.datasetKey,
        name: dataset.name,
        description: dataset.description,
        includedKinds,
        includedLicenseClasses,
        sourceKeys,
        exportSchemaVersion:
          dataset.exportSchemaVersion ?? "symbaiex-evidence-document-v3",
      },
      scannedRecordCount,
      selectionScanTruncated,
      selectionStrategy,
      snapshotAt,
      ...(continueCursor ? { continueCursor } : {}),
      records,
    };
  },
});

export const listActiveDatasetIds = internalQuery({
  args: {},
  returns: v.array(v.id("evidenceDatasets")),
  handler: async (ctx) =>
    (
      await ctx.db
        .query("evidenceDatasets")
        .withIndex("by_visibility_and_status_and_updatedAt", (q) =>
          q.eq("visibility", "public").eq("status", "active"),
        )
        .take(20)
    ).map((dataset) => dataset._id),
});

export const listDatasetVersions = internalQuery({
  args: {
    datasetId: v.id("evidenceDatasets"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    versions: v.array(DATASET_VERSION_SUMMARY),
    continueCursor: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    await ownedDataset(ctx, args.datasetId);
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("evidenceDatasetVersions")
      .withIndex("by_datasetId_and_version", (q) => {
        const selected = q.eq("datasetId", args.datasetId);
        return args.cursor === undefined
          ? selected
          : selected.lt("version", args.cursor);
      })
      .order("desc")
      .take(limit + 1);
    return {
      versions: rows.slice(0, limit).map(publicDatasetVersion),
      ...(rows.length > limit
        ? { continueCursor: rows[limit - 1]!.version }
        : {}),
    };
  },
});

export const diffDatasetVersions = internalQuery({
  args: {
    datasetId: v.id("evidenceDatasets"),
    versionId: v.id("evidenceDatasetVersions"),
    againstVersionId: v.optional(v.id("evidenceDatasetVersions")),
  },
  returns: v.union(
    v.null(),
    v.object({
      current: DATASET_VERSION_SUMMARY,
      previous: v.union(v.null(), DATASET_VERSION_SUMMARY),
      delta: v.object({
        records: v.number(),
        artifactBytes: v.number(),
        sourceCoverage: v.number(),
        citationCoverage: v.number(),
        entityCoverage: v.number(),
        claimCoverage: v.number(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    await ownedDataset(ctx, args.datasetId);
    const current = await ctx.db.get("evidenceDatasetVersions", args.versionId);
    if (current === null || current.datasetId !== args.datasetId) return null;
    const previousId = args.againstVersionId ?? current.parentVersionId;
    const previous = previousId === undefined ? null : await ctx.db.get("evidenceDatasetVersions", previousId);
    if (previous !== null && previous.datasetId !== args.datasetId) return null;
    const left = publicDatasetVersion(current);
    const right = previous === null ? null : publicDatasetVersion(previous);
    return {
      current: left,
      previous: right,
      delta: {
        records: left.recordCount - (right?.recordCount ?? 0),
        artifactBytes: left.artifactByteLength - (right?.artifactByteLength ?? 0),
        sourceCoverage: left.sourceCoverageScore - (right?.sourceCoverageScore ?? 0),
        citationCoverage: left.citationCoverageScore - (right?.citationCoverageScore ?? 0),
        entityCoverage: left.entityCoverageScore - (right?.entityCoverageScore ?? 0),
        claimCoverage: left.claimCoverageScore - (right?.claimCoverageScore ?? 0),
      },
    };
  },
});

/** Records a code-owned immutable snapshot without impersonating an enrolled agent. */
export const recordSystemDatasetSnapshot = internalMutation({
  args: {
    datasetId: v.id("evidenceDatasets"),
    checksum: v.string(),
    recordCount: v.number(),
    schemaVersion: v.string(),
    artifactByteLength: v.number(),
    sourceCount: v.number(),
    configuredSourceCount: v.number(),
    sourceCoverageScore: v.number(),
    missingSourceKeys: v.array(v.string()),
    citationCount: v.number(),
    citationCoverageScore: v.number(),
    entityCount: v.number(),
    entityCoverageScore: v.number(),
    claimCount: v.number(),
    claimCoverageScore: v.number(),
    completenessScore: v.number(),
    freshnessScore: v.number(),
    earliestObservedAt: v.optional(v.number()),
    latestObservedAt: v.optional(v.number()),
    qualityMetricsJson: v.string(),
    manifestStorageId: v.id("_storage"),
    artifactStorageId: v.id("_storage"),
    selectionStrategy: v.optional(
      v.union(v.literal("balanced"), v.literal("recent")),
    ),
    scannedRecordCount: v.optional(v.number()),
    selectionScanTruncated: v.optional(v.boolean()),
    continueCursor: v.optional(v.string()),
  },
  returns: v.object({
    versionId: v.id("evidenceDatasetVersions"),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await ownedDataset(ctx, args.datasetId);
    const existing = await ctx.db
      .query("evidenceDatasetVersions")
      .withIndex("by_datasetId_and_checksum", (q) =>
        q.eq("datasetId", args.datasetId).eq("checksum", args.checksum),
      )
      .unique();
    if (existing !== null) {
      await ctx.db.patch("evidenceDatasetVersions", existing._id, {
        schemaVersion: args.schemaVersion,
        artifactByteLength: args.artifactByteLength,
        sourceCount: args.sourceCount,
        configuredSourceCount: args.configuredSourceCount,
        sourceCoverageScore: args.sourceCoverageScore,
        missingSourceKeys: args.missingSourceKeys,
        citationCount: args.citationCount,
        citationCoverageScore: args.citationCoverageScore,
        entityCount: args.entityCount,
        entityCoverageScore: args.entityCoverageScore,
        claimCount: args.claimCount,
        claimCoverageScore: args.claimCoverageScore,
        completenessScore: args.completenessScore,
        freshnessScore: args.freshnessScore,
        earliestObservedAt: args.earliestObservedAt,
        latestObservedAt: args.latestObservedAt,
        qualityMetricsJson: args.qualityMetricsJson,
        selectionStrategy: args.selectionStrategy ?? "balanced",
        scannedRecordCount: args.scannedRecordCount ?? 0,
        selectionScanTruncated: args.selectionScanTruncated ?? false,
        continueCursor: args.continueCursor,
      });
      return { versionId: existing._id, created: false };
    }
    const createdAt = Date.now();
    const parentVersion = await ctx.db
      .query("evidenceDatasetVersions")
      .withIndex("by_datasetId_and_version", (q) =>
        q.eq("datasetId", args.datasetId),
      )
      .order("desc")
      .first();
    const versionId = await ctx.db.insert("evidenceDatasetVersions", {
      ...args,
      version: new Date(createdAt).toISOString(),
      format: "jsonl",
      parentVersionId: parentVersion?._id,
      selectionStrategy: args.selectionStrategy ?? "balanced",
      createdAt,
    });
    return { versionId, created: true };
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

const EXECUTION_CLAIM = v.union(
  v.null(),
  v.object({ executionToken: v.string() }),
);

function staleExecutionAt(
  job: Doc<"evidenceResearchJobs"> | Doc<"evidenceExportJobs">,
) {
  return job.externalWorkStartedAt ?? job.executionClaimedAt ?? job.updatedAt;
}

const STALE_EXECUTION_MESSAGE =
  "Execution lease expired. External work was not retried because it is not replay-safe.";

/** Atomically gives at most one new workflow ownership of queued research work. */
export const claimResearchExecution = internalMutation({
  args: { jobId: v.id("evidenceResearchJobs") },
  returns: EXECUTION_CLAIM,
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceResearchJobs", args.jobId);
    if (job === null) return null;
    const now = Date.now();
    if (job.status === "queued") {
      const executionToken = crypto.randomUUID();
      await ctx.db.patch("evidenceResearchJobs", job._id, {
        status: "running",
        executionToken,
        executionClaimedAt: now,
        externalWorkStartedAt: undefined,
        errorMessage: "",
        updatedAt: now,
      });
      return { executionToken };
    }
    if (
      job.status === "running" &&
      now - staleExecutionAt(job) >= EXECUTION_STALE_MS
    ) {
      await ctx.db.patch("evidenceResearchJobs", job._id, {
        status: "failed",
        errorMessage: STALE_EXECUTION_MESSAGE,
        updatedAt: now,
      });
    }
    return null;
  },
});

/** Atomically gives at most one new workflow ownership of queued export work. */
export const claimExportExecution = internalMutation({
  args: { jobId: v.id("evidenceExportJobs") },
  returns: EXECUTION_CLAIM,
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceExportJobs", args.jobId);
    if (job === null) return null;
    const now = Date.now();
    if (job.status === "queued") {
      const executionToken = crypto.randomUUID();
      await ctx.db.patch("evidenceExportJobs", job._id, {
        status: "running",
        executionToken,
        executionClaimedAt: now,
        externalWorkStartedAt: undefined,
        errorMessage: "",
        updatedAt: now,
      });
      return { executionToken };
    }
    if (
      job.status === "running" &&
      now - staleExecutionAt(job) >= EXECUTION_STALE_MS
    ) {
      await ctx.db.patch("evidenceExportJobs", job._id, {
        status: "failed",
        errorMessage: STALE_EXECUTION_MESSAGE,
        updatedAt: now,
      });
    }
    return null;
  },
});

/**
 * Reserves the non-idempotent portion of an action. Even if the same action is
 * invoked twice with the owning token, only the first transaction may proceed.
 */
export const beginResearchExecution = internalMutation({
  args: {
    jobId: v.id("evidenceResearchJobs"),
    executionToken: v.string(),
  },
  returns: v.union(v.null(), v.object({ query: v.string() })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceResearchJobs", args.jobId);
    if (
      job === null ||
      job.status !== "running" ||
      job.executionToken !== args.executionToken ||
      job.externalWorkStartedAt !== undefined
    )
      return null;
    await ctx.db.patch("evidenceResearchJobs", job._id, {
      externalWorkStartedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { query: job.query };
  },
});

export const beginExportExecution = internalMutation({
  args: {
    jobId: v.id("evidenceExportJobs"),
    executionToken: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      datasetId: v.id("evidenceDatasets"),
      format: v.union(v.literal("jsonl"), v.literal("parquet")),
      recordLimit: v.number(),
      selectionStrategy: v.union(v.literal("balanced"), v.literal("recent")),
      cursor: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceExportJobs", args.jobId);
    if (
      job === null ||
      job.status !== "running" ||
      job.executionToken !== args.executionToken ||
      job.externalWorkStartedAt !== undefined
    )
      return null;
    await ctx.db.patch("evidenceExportJobs", job._id, {
      externalWorkStartedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return {
      datasetId: job.datasetId,
      format: job.format,
      recordLimit: job.recordLimit ?? DEFAULT_EXPORT_LIMIT,
      selectionStrategy: job.selectionStrategy ?? "balanced",
      cursor: job.cursor,
    };
  },
});

function ownsExecution(
  job: Doc<"evidenceResearchJobs"> | Doc<"evidenceExportJobs">,
  executionToken: string | undefined,
) {
  if (job.status !== "running") return false;
  // Missing tokens are accepted only for already-running workflows deployed
  // before token ownership existed. New claimed jobs always require equality.
  return executionToken === undefined
    ? job.executionToken === undefined
    : job.executionToken === executionToken;
}

export const completeResearchJob = internalMutation({
  args: {
    jobId: v.id("evidenceResearchJobs"),
    executionToken: v.optional(v.string()),
    resultJson: v.string(),
    resultStorageId: v.optional(v.id("_storage")),
    artifactContentType: v.optional(v.string()),
    artifactByteLength: v.optional(v.number()),
    artifactSha256: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceResearchJobs", args.jobId);
    if (job !== null && ownsExecution(job, args.executionToken)) {
      await ctx.db.patch("evidenceResearchJobs", job._id, {
        status: "completed",
        resultJson: args.resultJson.slice(0, 100_000),
        resultStorageId: args.resultStorageId,
        errorMessage: "",
        updatedAt: Date.now(),
      });
      if (
        args.resultStorageId !== undefined &&
        args.artifactContentType !== undefined &&
        args.artifactByteLength !== undefined &&
        args.artifactSha256 !== undefined
      ) {
        await ctx.db.insert("evidenceArtifacts", {
          ownerUserId: job.ownerUserId,
          agentId: job.agentId,
          kind: "research",
          researchJobId: job._id,
          storageId: args.resultStorageId,
          contentType: bounded(
            args.artifactContentType,
            "artifactContentType",
            160,
          ),
          byteLength: Math.max(0, Math.floor(args.artifactByteLength)),
          sha256: bounded(args.artifactSha256, "artifactSha256", 128),
          generatedAt: Date.now(),
          expiresAt: job.expiresAt,
          status: "available",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      await ctx.runMutation(enqueueWebhookRef, {
        eventKey: `research:${job._id}:completed`,
        eventType: "evidence.research.completed",
        payloadJson: JSON.stringify({
          researchJobId: job._id,
          status: "completed",
          expiresAt: job.expiresAt,
        }),
      });
    } else if (
      args.resultStorageId !== undefined &&
      args.resultStorageId !== job?.resultStorageId
    ) {
      await removeDownloadStorage(ctx, args.resultStorageId);
    }
    return null;
  },
});
export const completeExportJob = internalMutation({
  args: {
    jobId: v.id("evidenceExportJobs"),
    executionToken: v.optional(v.string()),
    resultJson: v.string(),
    resultStorageId: v.id("_storage"),
    datasetManifestStorageId: v.id("_storage"),
    checksum: v.string(),
    recordCount: v.number(),
    artifactContentType: v.string(),
    artifactByteLength: v.number(),
    // Optional during rolling deployment so already-scheduled v1 export
    // actions can finish; all newly generated exports supply v2 metrics.
    schemaVersion: v.optional(v.string()),
    sourceCount: v.optional(v.number()),
    configuredSourceCount: v.optional(v.number()),
    sourceCoverageScore: v.optional(v.number()),
    missingSourceKeys: v.optional(v.array(v.string())),
    citationCount: v.optional(v.number()),
    citationCoverageScore: v.optional(v.number()),
    entityCount: v.optional(v.number()),
    entityCoverageScore: v.optional(v.number()),
    claimCount: v.optional(v.number()),
    claimCoverageScore: v.optional(v.number()),
    completenessScore: v.optional(v.number()),
    freshnessScore: v.optional(v.number()),
    earliestObservedAt: v.optional(v.number()),
    latestObservedAt: v.optional(v.number()),
    qualityMetricsJson: v.optional(v.string()),
    selectionStrategy: v.optional(
      v.union(v.literal("balanced"), v.literal("recent")),
    ),
    scannedRecordCount: v.optional(v.number()),
    selectionScanTruncated: v.optional(v.boolean()),
    continueCursor: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceExportJobs", args.jobId);
    if (job !== null && ownsExecution(job, args.executionToken)) {
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
        continueCursor: args.continueCursor,
        scannedRecordCount: Math.max(
          0,
          Math.floor(args.scannedRecordCount ?? 0),
        ),
        artifactByteLength: Math.max(0, Math.floor(args.artifactByteLength)),
        updatedAt: Date.now(),
      });
      await ctx.db.insert("evidenceArtifacts", {
        ownerUserId: job.ownerUserId,
        agentId: job.agentId,
        kind: "export",
        exportJobId: job._id,
        storageId: args.resultStorageId,
        contentType: bounded(
          args.artifactContentType,
          "artifactContentType",
          160,
        ),
        byteLength: Math.max(0, Math.floor(args.artifactByteLength)),
        sha256: bounded(args.checksum, "checksum", 128),
        generatedAt: Date.now(),
        expiresAt: job.expiresAt,
        status: "available",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const artifactUsageKey = `export:${job._id}:artifact-bytes`;
      if (
        (await ctx.db
          .query("apiUsageLedger")
          .withIndex("by_entryKey", (q) => q.eq("entryKey", artifactUsageKey))
          .unique()) === null
      ) {
        const product = await ctx.db
          .query("apiProducts")
          .withIndex("by_productKey", (q) => q.eq("productKey", "evidence-export"))
          .unique();
        await ctx.db.insert("apiUsageLedger", {
          entryKey: artifactUsageKey,
          ownerUserId: job.ownerUserId,
          agentId: job.agentId,
          productId: product?._id,
          idempotencyKey: `${job.idempotencyKey}:artifact-bytes`.slice(0, 200),
          operation: "evidence.export.artifact_bytes",
          entryType: "debit",
          units: Math.max(0, Math.floor(args.artifactByteLength)),
          entitlementSnapshotJson: JSON.stringify({ billingEnabled: false }),
          costBasisJson: JSON.stringify({
            meter: "artifact_bytes",
            unitPriceMicroUsd: 0,
            billingEnabled: false,
          }),
          metadataJson: JSON.stringify({
            exportJobId: job._id,
            recordCount: args.recordCount,
            format: job.format,
          }),
          createdAt: Date.now(),
        });
      }
      const existingVersion = await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_datasetId_and_checksum", (q) =>
          q.eq("datasetId", job.datasetId).eq("checksum", args.checksum),
        )
        .unique();
      if (existingVersion === null) {
        const parentVersion = await ctx.db
          .query("evidenceDatasetVersions")
          .withIndex("by_datasetId_and_version", (q) =>
            q.eq("datasetId", job.datasetId),
          )
          .order("desc")
          .first();
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
            schemaVersion: bounded(
              args.schemaVersion ?? "symbaiex-evidence-document-v1",
              "schemaVersion",
              120,
            ),
            artifactByteLength: Math.max(
              0,
              Math.floor(args.artifactByteLength),
            ),
            sourceCount: Math.max(0, Math.floor(args.sourceCount ?? 0)),
            configuredSourceCount: Math.max(
              0,
              Math.floor(args.configuredSourceCount ?? 0),
            ),
            sourceCoverageScore: Math.max(
              0,
              Math.min(100, Math.round(args.sourceCoverageScore ?? 0)),
            ),
            missingSourceKeys: (args.missingSourceKeys ?? []).slice(0, 100),
            citationCount: Math.max(0, Math.floor(args.citationCount ?? 0)),
            citationCoverageScore: Math.max(
              0,
              Math.min(100, Math.round(args.citationCoverageScore ?? 0)),
            ),
            entityCount: Math.max(0, Math.floor(args.entityCount ?? 0)),
            entityCoverageScore: Math.max(
              0,
              Math.min(100, Math.round(args.entityCoverageScore ?? 0)),
            ),
            claimCount: Math.max(0, Math.floor(args.claimCount ?? 0)),
            claimCoverageScore: Math.max(
              0,
              Math.min(100, Math.round(args.claimCoverageScore ?? 0)),
            ),
            completenessScore: Math.max(
              0,
              Math.min(100, Math.round(args.completenessScore ?? 0)),
            ),
            freshnessScore: Math.max(
              0,
              Math.min(100, Math.round(args.freshnessScore ?? 0)),
            ),
            earliestObservedAt: args.earliestObservedAt,
            latestObservedAt: args.latestObservedAt,
            qualityMetricsJson: (args.qualityMetricsJson ?? "{}").slice(
              0,
              20_000,
            ),
            manifestStorageId: args.datasetManifestStorageId,
            artifactStorageId: args.resultStorageId,
            format: job.format,
            parentVersionId: parentVersion?._id,
            selectionStrategy:
              args.selectionStrategy ?? job.selectionStrategy ?? "balanced",
            scannedRecordCount: Math.max(
              0,
              Math.floor(args.scannedRecordCount ?? 0),
            ),
            selectionScanTruncated: args.selectionScanTruncated ?? false,
            continueCursor: args.continueCursor,
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
      } else {
        // The canonical snapshot already owns a manifest. This newly generated
        // duplicate is not an export artifact and must not linger unreferenced.
        // A caller may have supplied the canonical manifest ID, so first prove
        // that no dataset version references it before deleting anything.
        if (args.datasetManifestStorageId !== args.resultStorageId)
          await removeDownloadStorage(ctx, args.datasetManifestStorageId);
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
    } else {
      if (args.resultStorageId !== job?.resultStorageId)
        await removeDownloadStorage(ctx, args.resultStorageId);
      if (
        args.datasetManifestStorageId !== args.resultStorageId &&
        args.datasetManifestStorageId !== job?.resultStorageId
      )
        await removeDownloadStorage(ctx, args.datasetManifestStorageId);
    }
    return null;
  },
});
export const failResearchJob = internalMutation({
  args: {
    jobId: v.id("evidenceResearchJobs"),
    executionToken: v.optional(v.string()),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceResearchJobs", args.jobId);
    if (job !== null && ownsExecution(job, args.executionToken))
      await ctx.db.patch("evidenceResearchJobs", job._id, {
        status: "failed",
        errorMessage: args.errorMessage.slice(0, 1_000),
        updatedAt: Date.now(),
      });
    return null;
  },
});
export const failExportJob = internalMutation({
  args: {
    jobId: v.id("evidenceExportJobs"),
    executionToken: v.optional(v.string()),
    errorMessage: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("evidenceExportJobs", args.jobId);
    if (job !== null && ownsExecution(job, args.executionToken))
      await ctx.db.patch("evidenceExportJobs", job._id, {
        status: "failed",
        errorMessage: args.errorMessage.slice(0, 1_000),
        updatedAt: Date.now(),
      });
    return null;
  },
});

async function isDatasetVersionStorage(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
) {
  return (
    (
      await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_manifestStorageId", (q) =>
          q.eq("manifestStorageId", storageId),
        )
        .take(1)
    ).length > 0 ||
    (
      await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_artifactStorageId", (q) =>
          q.eq("artifactStorageId", storageId),
        )
        .take(1)
    ).length > 0
  );
}

async function removeDownloadStorage(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
) {
  // Dataset-version artifacts and manifests follow dataset retention rather
  // than the shorter job-download TTL. Never delete shared version storage.
  if (await isDatasetVersionStorage(ctx, storageId)) return false;
  if ((await ctx.db.system.get("_storage", storageId)) === null) return false;
  await ctx.storage.delete(storageId);
  return true;
}

/** Removes only expired stored artifacts; job records remain available as audit history. */
export const cleanupExpiredArtifacts = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ researchCleared: v.number(), exportCleared: v.number() }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 50)));
    const now = Date.now();
    const artifacts = await ctx.db
      .query("evidenceArtifacts")
      .withIndex("by_status_and_expiresAt", (q) =>
        q.eq("status", "available").lte("expiresAt", now),
      )
      .take(limit);
    let researchCleared = 0;
    let exportCleared = 0;
    for (const artifact of artifacts) {
      await removeDownloadStorage(ctx, artifact.storageId);
      await ctx.db.patch("evidenceArtifacts", artifact._id, {
        status: "purged",
        purgedAt: now,
        updatedAt: now,
      });
      if (artifact.researchJobId !== undefined) {
        researchCleared += 1;
        await ctx.db.patch("evidenceResearchJobs", artifact.researchJobId, {
          resultStorageId: undefined,
          artifactPurgedAt: now,
          updatedAt: now,
        });
      }
      if (artifact.exportJobId !== undefined) {
        exportCleared += 1;
        await ctx.db.patch("evidenceExportJobs", artifact.exportJobId, {
          resultStorageId: undefined,
          artifactPurgedAt: now,
          updatedAt: now,
        });
      }
    }
    const remaining = limit - artifacts.length;
    if (remaining <= 0) return { researchCleared, exportCleared };
    const legacyResearch = await ctx.db
      .query("evidenceResearchJobs")
      .withIndex("by_status_and_artifactPurgedAt_and_expiresAt", (q) =>
        q
          .eq("status", "completed")
          .eq("artifactPurgedAt", undefined)
          .lte("expiresAt", now),
      )
      .take(remaining);
    for (const job of legacyResearch) {
      const artifact = await ctx.db
        .query("evidenceArtifacts")
        .withIndex("by_researchJobId", (q) => q.eq("researchJobId", job._id))
        .unique();
      if (artifact !== null) continue;
      if (job.resultStorageId !== undefined)
        await removeDownloadStorage(ctx, job.resultStorageId);
      await ctx.db.patch("evidenceResearchJobs", job._id, {
        resultStorageId: undefined,
        artifactPurgedAt: now,
        updatedAt: now,
      });
      researchCleared += 1;
    }
    const exportSlots = Math.max(0, remaining - legacyResearch.length);
    if (exportSlots === 0) return { researchCleared, exportCleared };
    const legacyExports = await ctx.db
      .query("evidenceExportJobs")
      .withIndex("by_status_and_artifactPurgedAt_and_expiresAt", (q) =>
        q
          .eq("status", "completed")
          .eq("artifactPurgedAt", undefined)
          .lte("expiresAt", now),
      )
      .take(exportSlots);
    for (const job of legacyExports) {
      const artifact = await ctx.db
        .query("evidenceArtifacts")
        .withIndex("by_exportJobId", (q) => q.eq("exportJobId", job._id))
        .unique();
      if (artifact !== null) continue;
      if (job.resultStorageId !== undefined)
        await removeDownloadStorage(ctx, job.resultStorageId);
      await ctx.db.patch("evidenceExportJobs", job._id, {
        resultStorageId: undefined,
        artifactPurgedAt: now,
        updatedAt: now,
      });
      exportCleared += 1;
    }
    return { researchCleared, exportCleared };
  },
});

/** Applies each dataset's bounded retention policy while preserving lineage depth. */
export const cleanupDatasetVersions = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ deletedVersions: v.number(), deletedBytes: v.number() }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(20, Math.floor(args.limit ?? 10)));
    const datasets = await ctx.db
      .query("evidenceDatasets")
      .withIndex("by_visibility_and_status_and_updatedAt", (q) =>
        q.eq("visibility", "public").eq("status", "active"),
      )
      .take(20);
    let deletedVersions = 0;
    let deletedBytes = 0;
    for (const dataset of datasets) {
      if (deletedVersions >= limit) break;
      if (dataset.snapshotRetentionDays === undefined) continue;
      const minimum = Math.max(
        1,
        Math.min(50, Math.floor(dataset.minimumRetainedVersions ?? 10)),
      );
      const cutoff = Date.now() - dataset.snapshotRetentionDays * 86_400_000;
      const versions = await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_datasetId_and_version", (q) =>
          q.eq("datasetId", dataset._id),
        )
        .order("desc")
        .take(100);
      for (const version of versions.slice(minimum)) {
        if (deletedVersions >= limit || version.createdAt >= cutoff) continue;
        for (const storageId of [version.manifestStorageId, version.artifactStorageId]) {
          if (
            storageId !== undefined &&
            (await ctx.db.system.get("_storage", storageId)) !== null
          )
            await ctx.storage.delete(storageId);
        }
        deletedBytes += version.artifactByteLength ?? 0;
        await ctx.db.delete("evidenceDatasetVersions", version._id);
        deletedVersions += 1;
      }
    }
    return { deletedVersions, deletedBytes };
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
const DATASET_CATALOG = [
  {
    datasetKey: "ai-systems-evidence",
    name: "AI systems evidence",
    description:
      "Attributable public evidence across AI systems, software, research, releases, and security advisories.",
    licenseClass: "attributed" as const,
    includedKinds: [] as string[],
    includedLicenseClasses: ["public-domain", "open", "attributed"],
    sourceKeys: [] as string[],
  },
  {
    datasetKey: "security-advisories",
    name: "Security advisories and vulnerability changes",
    description:
      "Official, attributable advisory metadata from CISA, GitHub, and NVD with version and citation provenance.",
    licenseClass: "attributed" as const,
    includedKinds: ["advisory"],
    includedLicenseClasses: ["public-domain", "open", "attributed"],
    sourceKeys: [
      "cisa-kev",
      "github-global-advisories",
      "nvd-cve-2",
      "nvd-cve-change-history-2",
    ],
  },
  {
    datasetKey: "software-release-intelligence",
    name: "Software release intelligence",
    description:
      "Versioned release metadata for the code-owned open-source repository allowlist.",
    licenseClass: "attributed" as const,
    includedKinds: ["release"],
    includedLicenseClasses: ["open", "attributed"],
    sourceKeys: [
      "github-releases-openai-openai-node",
      "github-releases-vercel-next.js",
      "github-releases-get-convex-convex-backend",
    ],
  },
  {
    datasetKey: "research-metadata",
    name: "Research and benchmark metadata",
    description:
      "Curated bibliographic, first-party research, dataset, and benchmark metadata without third-party full text.",
    licenseClass: "attributed" as const,
    includedKinds: ["paper", "dataset", "benchmark", "document"],
    includedLicenseClasses: ["public-domain", "open", "attributed"],
    sourceKeys: ["crossref-curated-metadata", "symbaiex-first-party-research"],
  },
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
    let primaryDatasetId: Id<"evidenceDatasets"> | null = null;
    for (const definition of DATASET_CATALOG) {
      const existing = await ctx.db
        .query("evidenceDatasets")
        .withIndex("by_datasetKey", (q) =>
          q.eq("datasetKey", definition.datasetKey),
        )
        .unique();
      const values = {
        ...definition,
        includedKinds: [...definition.includedKinds],
        includedLicenseClasses: [...definition.includedLicenseClasses],
        sourceKeys: [...definition.sourceKeys],
        exportSchemaVersion: "symbaiex-evidence-document-v3",
        snapshotRetentionDays: 365,
        minimumRetainedVersions: 10,
        visibility: "public" as const,
        status: "active" as const,
        updatedAt: now,
      };
      const datasetId =
        existing === null
          ? await ctx.db.insert("evidenceDatasets", {
              ...values,
              createdAt: now,
            })
          : (await ctx.db.patch("evidenceDatasets", existing._id, values),
            existing._id);
      if (definition.datasetKey === "ai-systems-evidence")
        primaryDatasetId = datasetId;
    }
    if (primaryDatasetId === null)
      throw new Error("Primary evidence dataset was not initialized.");
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
    return { datasetId: primaryDatasetId, billingEnabled: false };
  },
});
