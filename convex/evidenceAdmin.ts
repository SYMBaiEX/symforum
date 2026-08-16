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
    ]);
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
    const now = Date.now();
    await ctx.db.patch("evidenceSources", source._id, {
      status: args.status,
      ingestionEnabled: args.status === "active",
      updatedAt: now,
    });
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
