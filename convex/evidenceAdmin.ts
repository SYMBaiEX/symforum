import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import {
  action,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireSiteAdmin } from "./authz";
import { bumpEvidencePublicationEpoch } from "./evidencePublicationEpoch";
import {
  enqueueNonPublicEvidenceSourceCleanup,
  enqueuePublicEvidenceSourceIndex,
} from "./semanticSearchIndexWorkflow";
import { requestUniversalSearchProjectionRebuild } from "./universalSearchProjection";

const sourceStatusValidator = v.union(v.literal("active"), v.literal("paused"));
const adapterValidator = v.union(
  v.literal("cisa-kev"),
  v.literal("github-advisories"),
  v.literal("github-releases"),
  v.literal("crossref"),
  v.literal("first-party-research"),
);

const requireAdminRef = makeFunctionReference<
  "query",
  Record<string, never>,
  null
>("evidenceAdmin:requireAdmin");
const ensureCatalogRef = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { datasetId: string; billingEnabled: boolean }
>("evidenceJobs:ensureCatalog");
const backfillEvidenceRef = makeFunctionReference<
  "action",
  { limit?: number },
  { examined: number; enriched: number }
>("evidenceIngestion:backfillDerivedEvidence");
const ingestionRefs = {
  "cisa-kev": makeFunctionReference<"action", Record<string, never>, unknown>(
    "evidenceIngestion:syncCisaKev",
  ),
  "github-advisories": makeFunctionReference<
    "action",
    Record<string, never>,
    unknown
  >("evidenceIngestion:syncGithubAdvisories"),
  "github-releases": makeFunctionReference<
    "action",
    Record<string, never>,
    unknown
  >("evidenceIngestion:syncGithubReleases"),
  crossref: makeFunctionReference<"action", Record<string, never>, unknown>(
    "evidenceIngestion:syncCrossref",
  ),
  "first-party-research": makeFunctionReference<
    "action",
    Record<string, never>,
    unknown
  >("evidenceFirstParty:sync"),
} as const;

const take = 50;
const latest = <T extends { updatedAt: number }>(rows: T[]) =>
  rows.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, take);

export const requireAdmin = internalQuery({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    return null;
  },
});

export const dashboard = query({
  args: {},
  returns: v.object({
    bounds: v.object({
      sources: v.number(),
      documents: v.number(),
      jobs: v.number(),
    }),
    counts: v.object({
      sources: v.number(),
      documents: v.number(),
      changes: v.number(),
      researchJobs: v.number(),
      exportJobs: v.number(),
      products: v.number(),
      datasets: v.number(),
      benchmarks: v.number(),
    }),
    health: v.union(
      v.null(),
      v.object({
        status: v.union(v.literal("healthy"), v.literal("degraded")),
        sourceCount: v.number(),
        staleSourceKeys: v.array(v.string()),
        failedSourceKeys: v.array(v.string()),
        stuckResearchJobs: v.number(),
        stuckExportJobs: v.number(),
        truncated: v.boolean(),
        summary: v.string(),
        lastCheckedAt: v.number(),
        lastChangedAt: v.number(),
      }),
    ),
    sources: v.array(
      v.object({
        sourceId: v.id("evidenceSources"),
        sourceKey: v.string(),
        name: v.string(),
        status: v.union(
          v.literal("active"),
          v.literal("paused"),
          v.literal("retired"),
        ),
        ingestionEnabled: v.boolean(),
        lastSucceededAt: v.number(),
        lastErrorAt: v.number(),
        lastErrorMessage: v.string(),
        updatedAt: v.number(),
      }),
    ),
    changes: v.array(
      v.object({
        eventKey: v.string(),
        entityType: v.union(
          v.literal("document"),
          v.literal("claim"),
          v.literal("dataset"),
          v.literal("benchmark"),
        ),
        kind: v.union(
          v.literal("created"),
          v.literal("updated"),
          v.literal("status-changed"),
        ),
        summary: v.string(),
        occurredAt: v.number(),
      }),
    ),
    jobs: v.array(
      v.object({
        id: v.union(v.id("evidenceResearchJobs"), v.id("evidenceExportJobs")),
        type: v.union(v.literal("export"), v.literal("research")),
        status: v.union(
          v.literal("queued"),
          v.literal("running"),
          v.literal("completed"),
          v.literal("failed"),
          v.literal("cancelled"),
        ),
        errorMessage: v.string(),
        updatedAt: v.number(),
      }),
    ),
    operations: v.object({
      window: v.string(),
      completedExports: v.number(),
      failedExports: v.number(),
      exportedRecords: v.number(),
      scannedRecords: v.number(),
      artifactBytes: v.number(),
      readAmplification: v.number(),
      billableRecordUnits: v.number(),
      forumReplies: v.number(),
      forumReplyFailures: v.number(),
      routeFallbackRate: v.number(),
    }),
    datasetQuality: v.array(
      v.object({
        datasetKey: v.string(),
        version: v.string(),
        recordCount: v.number(),
        artifactByteLength: v.number(),
        sourceCoverageScore: v.number(),
        citationCoverageScore: v.number(),
        entityCoverageScore: v.number(),
        claimCoverageScore: v.number(),
        freshnessScore: v.number(),
        createdAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    const [
      activeSources,
      pausedSources,
      retiredSources,
      documents,
      changes,
      products,
      datasets,
      benchmarks,
      researchJobs,
      exportJobs,
      health,
      completedExports,
      failedExports,
      forumReplies,
      routeEvents,
    ] = await Promise.all([
      ctx.db
        .query("evidenceSources")
        .withIndex("by_status_and_visibility", (q) => q.eq("status", "active"))
        .take(take),
      ctx.db
        .query("evidenceSources")
        .withIndex("by_status_and_visibility", (q) => q.eq("status", "paused"))
        .take(take),
      ctx.db
        .query("evidenceSources")
        .withIndex("by_status_and_visibility", (q) => q.eq("status", "retired"))
        .take(take),
      ctx.db
        .query("evidenceDocuments")
        .withIndex("by_visibility_and_updatedAt", (q) =>
          q.eq("visibility", "public"),
        )
        .order("desc")
        .take(take),
      ctx.db
        .query("evidenceChangeEvents")
        .withIndex("by_visibility_and_occurredAt", (q) =>
          q.eq("visibility", "public"),
        )
        .order("desc")
        .take(12),
      ctx.db
        .query("apiProducts")
        .withIndex("by_visibility_and_status_and_updatedAt", (q) =>
          q.eq("visibility", "public").eq("status", "active"),
        )
        .order("desc")
        .take(take),
      ctx.db
        .query("evidenceDatasets")
        .withIndex("by_visibility_and_status_and_updatedAt", (q) =>
          q.eq("visibility", "public").eq("status", "active"),
        )
        .order("desc")
        .take(take),
      ctx.db
        .query("evidenceBenchmarks")
        .withIndex("by_visibility_and_status_and_updatedAt", (q) =>
          q.eq("visibility", "public").eq("status", "active"),
        )
        .order("desc")
        .take(take),
      ctx.db
        .query("evidenceResearchJobs")
        .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "queued"))
        .order("desc")
        .take(12),
      ctx.db
        .query("evidenceExportJobs")
        .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "queued"))
        .order("desc")
        .take(12),
      ctx.db
        .query("evidenceOperationalHealth")
        .withIndex("by_healthKey", (q) =>
          q.eq("healthKey", "evidence-production"),
        )
        .unique(),
      ctx.db
        .query("evidenceExportJobs")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "completed"),
        )
        .order("desc")
        .take(50),
      ctx.db
        .query("evidenceExportJobs")
        .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "failed"))
        .order("desc")
        .take(50),
      ctx.db
        .query("forumAgentReplyRuns")
        .withIndex("by_updatedAt")
        .order("desc")
        .take(50),
      ctx.db
        .query("aiRouteEvents")
        .withIndex("by_createdAt")
        .order("desc")
        .take(50),
    ]);
    const datasetQuality = [];
    for (const dataset of datasets) {
      const version = await ctx.db
        .query("evidenceDatasetVersions")
        .withIndex("by_datasetId_and_version", (q) =>
          q.eq("datasetId", dataset._id),
        )
        .order("desc")
        .first();
      if (version !== null)
        datasetQuality.push({
          datasetKey: dataset.datasetKey,
          version: version.version,
          recordCount: version.recordCount,
          artifactByteLength: version.artifactByteLength ?? 0,
          sourceCoverageScore: version.sourceCoverageScore ?? 0,
          citationCoverageScore: version.citationCoverageScore ?? 0,
          entityCoverageScore: version.entityCoverageScore ?? 0,
          claimCoverageScore: version.claimCoverageScore ?? 0,
          freshnessScore: version.freshnessScore ?? 0,
          createdAt: version.createdAt,
        });
    }
    const exportedRecords = completedExports.reduce(
      (sum, job) => sum + job.recordCount,
      0,
    );
    const scannedRecords = completedExports.reduce(
      (sum, job) => sum + (job.scannedRecordCount ?? 0),
      0,
    );
    const sources = [...activeSources, ...pausedSources, ...retiredSources]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, take)
      .map((source) => ({
        sourceId: source._id,
        sourceKey: source.sourceKey,
        name: source.name,
        status: source.status,
        ingestionEnabled: source.ingestionEnabled,
        lastSucceededAt: source.lastSucceededAt,
        lastErrorAt: source.lastErrorAt,
        lastErrorMessage: source.lastErrorMessage.slice(0, 240),
        updatedAt: source.updatedAt,
      }));
    return {
      bounds: { sources: take, documents: take, jobs: 12 },
      counts: {
        sources: sources.length,
        documents: documents.length,
        changes: changes.length,
        researchJobs: researchJobs.length,
        exportJobs: exportJobs.length,
        products: products.length,
        datasets: datasets.length,
        benchmarks: benchmarks.length,
      },
      health:
        health === null
          ? null
          : {
              status: health.status,
              sourceCount: health.sourceCount,
              staleSourceKeys: health.staleSourceKeys,
              failedSourceKeys: health.failedSourceKeys,
              stuckResearchJobs: health.stuckResearchJobs,
              stuckExportJobs: health.stuckExportJobs,
              truncated: health.truncated,
              summary: health.summary,
              lastCheckedAt: health.lastCheckedAt,
              lastChangedAt: health.lastChangedAt,
            },
      sources,
      changes: changes.map((event) => ({
        eventKey: event.eventKey,
        entityType: event.entityType,
        kind: event.kind,
        summary: event.summary.slice(0, 300),
        occurredAt: event.occurredAt,
      })),
      jobs: latest([...researchJobs, ...exportJobs]).map((job) => ({
        id: job._id,
        type: "datasetId" in job ? ("export" as const) : ("research" as const),
        status: job.status,
        errorMessage: job.errorMessage.slice(0, 240),
        updatedAt: job.updatedAt,
      })),
      operations: {
        window: "latest 50 rows per metric",
        completedExports: completedExports.length,
        failedExports: failedExports.length,
        exportedRecords,
        scannedRecords,
        artifactBytes: completedExports.reduce(
          (sum, job) => sum + (job.artifactByteLength ?? 0),
          0,
        ),
        readAmplification:
          exportedRecords === 0
            ? 0
            : Math.round((scannedRecords / exportedRecords) * 100) / 100,
        billableRecordUnits: completedExports.reduce(
          (sum, job) => sum + job.quotaUnits,
          0,
        ),
        forumReplies: forumReplies.filter((run) => run.status === "replied")
          .length,
        forumReplyFailures: forumReplies.filter(
          (run) => run.status === "failed",
        ).length,
        routeFallbackRate:
          routeEvents.length === 0
            ? 0
            : Math.round(
                (routeEvents.filter((event) => event.fallback).length /
                  routeEvents.length) *
                  100,
              ),
      },
      datasetQuality,
    };
  },
});

export const setSourceStatus = mutation({
  args: { sourceId: v.id("evidenceSources"), status: sourceStatusValidator },
  returns: v.object({
    sourceId: v.id("evidenceSources"),
    status: sourceStatusValidator,
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireSiteAdmin(ctx);
    const source = await ctx.db.get("evidenceSources", args.sourceId);
    if (source === null)
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Evidence source was not found.",
      });
    const ingestionEnabled = args.status === "active";
    const statusChanged = source.status !== args.status;
    const ingestionChanged = source.ingestionEnabled !== ingestionEnabled;
    if (!statusChanged && !ingestionChanged)
      return {
        sourceId: source._id,
        status: args.status,
        updatedAt: source.updatedAt,
      };
    const now = Date.now();
    await ctx.db.patch("evidenceSources", source._id, {
      status: args.status,
      ingestionEnabled,
      updatedAt: now,
    });
    if (
      statusChanged &&
      source.visibility === "public" &&
      source.status === "active" &&
      args.status !== "active"
    ) {
      await bumpEvidencePublicationEpoch(ctx);
      await enqueueNonPublicEvidenceSourceCleanup(ctx, source._id);
    }
    if (statusChanged && source.visibility === "public")
      await requestUniversalSearchProjectionRebuild(ctx);
    if (
      source.status !== "active" &&
      args.status === "active" &&
      source.visibility === "public"
    ) {
      await enqueuePublicEvidenceSourceIndex(ctx, source._id);
    }
    return { sourceId: source._id, status: args.status, updatedAt: now };
  },
});

async function reauthorize(ctx: ActionCtx): Promise<void> {
  await ctx.runQuery(requireAdminRef, {});
}

export const runIngestion = action({
  args: { adapter: adapterValidator },
  returns: v.object({ adapter: adapterValidator, result: v.any() }),
  handler: async (ctx, args) => {
    await reauthorize(ctx);
    const result = await ctx.runAction(ingestionRefs[args.adapter], {});
    return { adapter: args.adapter, result };
  },
});

export const initializeCatalog = action({
  args: {},
  returns: v.object({ initialized: v.boolean(), message: v.string() }),
  handler: async (ctx) => {
    await reauthorize(ctx);
    await ctx.runMutation(ensureCatalogRef, {});
    return {
      initialized: true,
      message: "Default evidence catalog is ready; billing remains disabled.",
    };
  },
});

export const backfillEvidence = action({
  args: { limit: v.optional(v.number()) },
  returns: v.object({ examined: v.number(), enriched: v.number() }),
  handler: async (ctx, args) => {
    await reauthorize(ctx);
    return await ctx.runAction(backfillEvidenceRef, {
      limit: Math.max(1, Math.min(100, Math.floor(args.limit ?? 50))),
    });
  },
});
