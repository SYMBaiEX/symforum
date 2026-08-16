import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";

const HOUR_MS = 60 * 60 * 1_000;
const STUCK_JOB_MS = 30 * 60 * 1_000;
const HEALTH_KEY = "evidence-production";
const healthStatusValidator = v.union(
  v.literal("healthy"),
  v.literal("degraded"),
);
const healthResultValidator = v.object({
  status: healthStatusValidator,
  sourceCount: v.number(),
  staleSourceKeys: v.array(v.string()),
  failedSourceKeys: v.array(v.string()),
  stuckResearchJobs: v.number(),
  stuckExportJobs: v.number(),
  truncated: v.boolean(),
  summary: v.string(),
  lastCheckedAt: v.number(),
  lastChangedAt: v.number(),
});

function maximumSourceAge(sourceKey: string) {
  if (sourceKey === "cisa-kev") return 3 * HOUR_MS;
  if (sourceKey === "github-global-advisories") return 8 * HOUR_MS;
  if (sourceKey.startsWith("github-releases-")) return 4 * HOUR_MS;
  if (sourceKey === "crossref-curated-metadata") return 14 * HOUR_MS;
  if (sourceKey === "symbaiex-first-party-research") return 26 * HOUR_MS;
  return 26 * HOUR_MS;
}

/** Hourly bounded operational check for evidence sources and async jobs. */
export const check = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: healthResultValidator,
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const jobCutoff = now - STUCK_JOB_MS;
    const [
      sources,
      queuedResearch,
      runningResearch,
      queuedExports,
      runningExports,
    ] = await Promise.all([
      ctx.db
        .query("evidenceSources")
        .withIndex("by_status_and_visibility", (q) => q.eq("status", "active"))
        .take(50),
      ctx.db
        .query("evidenceResearchJobs")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "queued").lt("updatedAt", jobCutoff),
        )
        .take(50),
      ctx.db
        .query("evidenceResearchJobs")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "running").lt("updatedAt", jobCutoff),
        )
        .take(50),
      ctx.db
        .query("evidenceExportJobs")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "queued").lt("updatedAt", jobCutoff),
        )
        .take(50),
      ctx.db
        .query("evidenceExportJobs")
        .withIndex("by_status_and_updatedAt", (q) =>
          q.eq("status", "running").lt("updatedAt", jobCutoff),
        )
        .take(50),
    ]);
    const staleSourceKeys = sources
      .filter(
        (source) =>
          source.lastSucceededAt <= 0 ||
          now - source.lastSucceededAt > maximumSourceAge(source.sourceKey),
      )
      .map((source) => source.sourceKey)
      .sort();
    const failedSourceKeys = sources
      .filter(
        (source) =>
          source.lastErrorAt > source.lastSucceededAt ||
          source.lastErrorMessage.trim().length > 0,
      )
      .map((source) => source.sourceKey)
      .sort();
    const stuckResearchJobs = queuedResearch.length + runningResearch.length;
    const stuckExportJobs = queuedExports.length + runningExports.length;
    const truncated =
      sources.length === 50 ||
      queuedResearch.length === 50 ||
      runningResearch.length === 50 ||
      queuedExports.length === 50 ||
      runningExports.length === 50;
    const status =
      staleSourceKeys.length > 0 ||
      failedSourceKeys.length > 0 ||
      stuckResearchJobs > 0 ||
      stuckExportJobs > 0 ||
      truncated
        ? ("degraded" as const)
        : ("healthy" as const);
    const summary =
      status === "healthy"
        ? `${sources.length} active evidence sources healthy; no stuck jobs.`
        : [
            `${staleSourceKeys.length} stale source(s)`,
            `${failedSourceKeys.length} failed source(s)`,
            `${stuckResearchJobs} stuck research job(s)`,
            `${stuckExportJobs} stuck export job(s)`,
            truncated ? "bounded scan saturated" : null,
          ]
            .filter((part) => part !== null)
            .join("; ");
    const existing = await ctx.db
      .query("evidenceOperationalHealth")
      .withIndex("by_healthKey", (q) => q.eq("healthKey", HEALTH_KEY))
      .unique();
    const statusChanged = existing !== null && existing.status !== status;
    const lastChangedAt =
      existing === null || statusChanged ? now : existing.lastChangedAt;
    const value = {
      status,
      sourceCount: sources.length,
      staleSourceKeys,
      failedSourceKeys,
      stuckResearchJobs,
      stuckExportJobs,
      truncated,
      summary,
      lastCheckedAt: now,
      lastChangedAt,
    };
    if (existing === null) {
      await ctx.db.insert("evidenceOperationalHealth", {
        healthKey: HEALTH_KEY,
        ...value,
      });
    } else {
      await ctx.db.patch("evidenceOperationalHealth", existing._id, value);
    }
    if ((existing === null && status === "degraded") || statusChanged) {
      await recordTransition(ctx, status, summary, now);
    }
    return value;
  },
});

async function recordTransition(
  ctx: MutationCtx,
  status: "healthy" | "degraded",
  summary: string,
  now: number,
) {
  const degradedFingerprint = "evidence-health:degraded";
  if (status === "healthy") {
    const previous = await ctx.db
      .query("systemLogs")
      .withIndex("by_fingerprint_and_createdAt", (q) =>
        q.eq("fingerprint", degradedFingerprint),
      )
      .order("desc")
      .first();
    if (previous !== null && previous.status !== "resolved") {
      await ctx.db.patch("systemLogs", previous._id, {
        status: "resolved",
        updatedAt: now,
        lastSeenAt: now,
      });
    }
  }
  await ctx.db.insert("systemLogs", {
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    occurrences: 1,
    level: status === "degraded" ? "warn" : "info",
    status: "open",
    source: "convex",
    scope: "evidence-health",
    eventType:
      status === "degraded"
        ? "evidence_health_degraded"
        : "evidence_health_recovered",
    message: summary.slice(0, 700),
    fingerprint:
      status === "degraded"
        ? degradedFingerprint
        : `evidence-health:recovered:${now}`,
    component: "evidenceHealth",
    action: "check",
    metadataJson: JSON.stringify({ status }),
  });
}
