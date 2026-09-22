import { makeFunctionReference } from "convex/server";
import {
  isPublicEvidenceClaim,
  isPublicEvidenceDocument,
} from "./evidenceVisibility";
import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const CLAIM_CAP = 500;
const DOCUMENT_CAP = 500;
const CITATIONS_PER_CLAIM_CAP = 20;
const BENCHMARK_KEY = "evidence-citation-coverage";
const MODEL = "deterministic-rules-v1";

const enqueueWebhookRef = makeFunctionReference<
  "mutation",
  {
    eventKey: string;
    eventType: "evidence.benchmark.completed";
    payloadJson: string;
  },
  { eventId: Id<"apiWebhookEvents"> | null; enqueued: number }
>("evidenceWebhooks:enqueueEvent");

const runValidator = v.object({
  runId: v.id("evidenceBenchmarkRuns"),
  benchmarkId: v.id("evidenceBenchmarks"),
  runKey: v.string(),
  model: v.string(),
  score: v.number(),
  metricsJson: v.string(),
  executedAt: v.number(),
});

function utcDayKey(now: number) {
  return new Date(now).toISOString().slice(0, 10);
}

function boundedDayKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConvexError({
      code: "INVALID_RUN_KEY",
      message: "dayKey must be YYYY-MM-DD.",
    });
  }
  return value;
}

async function ensureBenchmark(ctx: MutationCtx) {
  const existing = await ctx.db
    .query("evidenceBenchmarks")
    .withIndex("by_benchmarkKey", (q) => q.eq("benchmarkKey", BENCHMARK_KEY))
    .unique();
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("evidenceBenchmarks", {
    benchmarkKey: BENCHMARK_KEY,
    name: "Evidence citation coverage",
    description:
      "Deterministic coverage of public supported claims and citations.",
    visibility: "public",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get("evidenceBenchmarks", id))!;
}

async function countPublicCurrentDocuments(ctx: MutationCtx) {
  const docs = await ctx.db
    .query("evidenceDocuments")
    .withIndex("by_visibility_and_updatedAt", (q) =>
      q.eq("visibility", "public"),
    )
    .order("desc")
    .take(DOCUMENT_CAP + 1);
  const truncated = docs.length > DOCUMENT_CAP;
  const rows = (
    await Promise.all(
      docs
        .slice(0, DOCUMENT_CAP)
        .map(async (doc) =>
          (await isPublicEvidenceDocument(ctx, doc)) ? doc : null,
        ),
    )
  ).filter((doc) => doc !== null);
  return {
    scanned: rows.length,
    current: rows.filter((doc) => doc.currentVersionId !== null).length,
    truncated,
  };
}

export const runDailyCitationCoverage = internalMutation({
  args: { dayKey: v.optional(v.string()) },
  returns: runValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const day = args.dayKey ? boundedDayKey(args.dayKey) : utcDayKey(now);
    const runKey = `${BENCHMARK_KEY}:${day}`;
    const existingRun = await ctx.db
      .query("evidenceBenchmarkRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
      .unique();
    if (existingRun) {
      return {
        runId: existingRun._id,
        benchmarkId: existingRun.benchmarkId,
        runKey: existingRun.runKey,
        model: existingRun.model,
        score: existingRun.score,
        metricsJson: existingRun.metricsJson,
        executedAt: existingRun.executedAt,
      };
    }

    const benchmark = await ensureBenchmark(ctx);
    const claims = await ctx.db
      .query("evidenceClaims")
      .withIndex("by_visibility_and_status_and_observedAt", (q) =>
        q.eq("visibility", "public").eq("status", "supported"),
      )
      .order("desc")
      .take(CLAIM_CAP + 1);
    const claimsTruncated = claims.length > CLAIM_CAP;
    const publicClaims = (
      await Promise.all(
        claims
          .slice(0, CLAIM_CAP)
          .map(async (claim) =>
            (await isPublicEvidenceClaim(ctx, claim)) ? claim : null,
          ),
      )
    ).filter((claim) => claim !== null);
    let citedClaims = 0;
    let citationRowsScanned = 0;
    for (const claim of publicClaims) {
      const citations = await ctx.db
        .query("evidenceClaimCitations")
        .withIndex("by_claimId", (q) => q.eq("claimId", claim._id))
        .take(CITATIONS_PER_CLAIM_CAP + 1);
      citationRowsScanned += Math.min(
        citations.length,
        CITATIONS_PER_CLAIM_CAP,
      );
      let supported = false;
      for (const citation of citations.slice(0, CITATIONS_PER_CLAIM_CAP)) {
        if (citation.relation !== "supports") continue;
        const version = await ctx.db.get(
          "evidenceDocumentVersions",
          citation.documentVersionId,
        );
        if (!version) continue;
        const document = await ctx.db.get(
          "evidenceDocuments",
          version.documentId,
        );
        if (await isPublicEvidenceDocument(ctx, document)) {
          supported = true;
          break;
        }
      }
      if (supported) citedClaims += 1;
    }
    const documentCoverage = await countPublicCurrentDocuments(ctx);
    const score =
      publicClaims.length === 0 ? 1 : citedClaims / publicClaims.length;
    const metrics = {
      methodology:
        "public supported claims with at least one supports citation to a public document",
      methodologyVersion: "citation-coverage-v1",
      caps: {
        claims: CLAIM_CAP,
        documents: DOCUMENT_CAP,
        citationsPerClaim: CITATIONS_PER_CLAIM_CAP,
      },
      claims: {
        scanned: publicClaims.length,
        cited: citedClaims,
        truncated: claimsTruncated,
      },
      citations: { scanned: citationRowsScanned },
      currentVersionDocumentCoverage: {
        scanned: documentCoverage.scanned,
        current: documentCoverage.current,
        ratio:
          documentCoverage.scanned === 0
            ? 1
            : documentCoverage.current / documentCoverage.scanned,
        truncated: documentCoverage.truncated,
      },
    };
    const metricsJson = JSON.stringify(metrics);
    const runId = await ctx.db.insert("evidenceBenchmarkRuns", {
      benchmarkId: benchmark._id,
      runKey,
      model: MODEL,
      score,
      metricsJson,
      executedAt: now,
      createdAt: now,
    });
    const eventKey = `benchmark:${runKey}`;
    const existingEvent = await ctx.db
      .query("evidenceChangeEvents")
      .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
      .unique();
    if (!existingEvent) {
      await ctx.db.insert("evidenceChangeEvents", {
        eventKey,
        entityType: "benchmark",
        entityId: String(runId),
        kind: "created",
        visibility: "public",
        summary: `Evidence citation coverage benchmark completed for ${day}.`,
        occurredAt: now,
        createdAt: now,
      });
    }
    await ctx.runMutation(enqueueWebhookRef, {
      eventKey,
      eventType: "evidence.benchmark.completed",
      payloadJson: JSON.stringify({ runId, runKey, score, model: MODEL }),
    });
    return {
      runId,
      benchmarkId: benchmark._id,
      runKey,
      model: MODEL,
      score,
      metricsJson,
      executedAt: now,
    };
  },
});

export const listPublicRuns = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(runValidator),
  handler: async (ctx: QueryCtx, args) => {
    const limit = Math.min(50, Math.max(1, Math.floor(args.limit ?? 20)));
    const benchmark = await ctx.db
      .query("evidenceBenchmarks")
      .withIndex("by_benchmarkKey", (q) => q.eq("benchmarkKey", BENCHMARK_KEY))
      .unique();
    if (
      !benchmark ||
      benchmark.visibility !== "public" ||
      benchmark.status !== "active"
    )
      return [];
    const runs = await ctx.db
      .query("evidenceBenchmarkRuns")
      .withIndex("by_benchmarkId_and_executedAt", (q) =>
        q.eq("benchmarkId", benchmark._id),
      )
      .order("desc")
      .take(limit);
    return runs.map((run) => ({
      runId: run._id,
      benchmarkId: run.benchmarkId,
      runKey: run.runKey,
      model: run.model,
      score: run.score,
      metricsJson: run.metricsJson,
      executedAt: run.executedAt,
    }));
  },
});
