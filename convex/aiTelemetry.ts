import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import {
  applyRouteCircuitEvent,
  EMBEDDING_HEALTH_KEY,
  STRUCTURED_CANARY_KEY,
} from "./aiRoutingControlData";
import { requireOwner } from "./authz";
import {
  forumDayKey,
  openRouterDailyBudgetMicroUsd,
} from "../lib/ai-model-costs";
import { env } from "./_generated/server";

export const recordRouteEvent = internalMutation({
  args: {
    correlationId: v.string(),
    feature: v.string(),
    runKey: v.optional(v.string()),
    agentSlug: v.optional(v.string()),
    stage: v.string(),
    attempt: v.number(),
    // Keep legacy provider literals readable for historical telemetry rows;
    // all new route events are emitted as OpenRouter.
    provider: v.union(
      v.literal("openrouter"),
      v.literal("muse"),
      v.literal("gateway"),
    ),
    model: v.string(),
    outcome: v.union(v.literal("completed"), v.literal("failed")),
    fallback: v.boolean(),
    durationMs: v.number(),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const createdAt = Date.now();
    const eventId = await ctx.db.insert("aiRouteEvents", {
      ...args,
      errorMessage: args.errorMessage?.replace(/\s+/g, " ").slice(0, 400),
      createdAt,
    });
    await applyRouteCircuitEvent(ctx, {
      model: args.model,
      outcome: args.outcome,
      errorMessage: args.errorMessage,
      now: createdAt,
    });
    return eventId;
  },
});

export const snapshotAdmin = query({
  args: {
    hours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const windowHours = Math.max(
      1,
      Math.min(720, Math.floor(args.hours ?? 24)),
    );
    const cutoff = Date.now() - windowHours * 3_600_000;
    const now = Date.now();
    const dayKey = forumDayKey(now);
    const [
      routes,
      runs,
      replies,
      usage,
      newsletters,
      circuits,
      spendBuckets,
      canary,
      embedding,
    ] = await Promise.all([
      ctx.db
        .query("aiRouteEvents")
        .withIndex("by_createdAt", (q) => q.gte("createdAt", cutoff))
        .order("desc")
        .take(500),
      ctx.db
        .query("forumAgentRuns")
        .withIndex("by_startedAt", (q) => q.gte("startedAt", cutoff))
        .order("desc")
        .take(500),
      ctx.db
        .query("forumAgentReplyRuns")
        .withIndex("by_updatedAt", (q) => q.gte("updatedAt", cutoff))
        .order("desc")
        .take(500),
      ctx.db
        .query("forumAgentUsageEvents")
        .withIndex("by_createdAt", (q) => q.gte("createdAt", cutoff))
        .order("desc")
        .take(1_000),
      ctx.db
        .query("dailyNewsletterRuns")
        .withIndex("by_startedAt", (q) => q.gte("startedAt", cutoff))
        .order("desc")
        .take(200),
      ctx.db.query("aiProviderCircuits").take(20),
      ctx.db
        .query("aiSpendBuckets")
        .withIndex("by_dayKey_and_provider_and_bucket", (q) =>
          q.eq("dayKey", dayKey).eq("provider", "openrouter"),
        )
        .take(16),
      ctx.db
        .query("aiOperationalStates")
        .withIndex("by_key", (q) => q.eq("key", STRUCTURED_CANARY_KEY))
        .unique(),
      ctx.db
        .query("aiOperationalStates")
        .withIndex("by_key", (q) => q.eq("key", EMBEDDING_HEALTH_KEY))
        .unique(),
    ]);

    const qualityScores = runs
      .map((run) => run.qualityScore)
      .filter((score): score is number => score !== undefined);
    const durations = usage.map((event) => event.durationMs);
    const inputTokens = usage.reduce(
      (total, event) => total + (event.inputTokens ?? 0),
      0,
    );
    const outputTokens = usage.reduce(
      (total, event) => total + (event.outputTokens ?? 0),
      0,
    );
    const estimatedCostMicroUsd = usage.reduce(
      (total, event) => total + (event.estimatedCostMicroUsd ?? 0),
      0,
    );
    const revisionEvents = usage.filter((event) => event.stage === "revision");
    const revisionGainValues = revisionEvents
      .filter(
        (event) =>
          event.qualityBefore !== undefined && event.qualityAfter !== undefined,
      )
      .map((event) => event.qualityAfter! - event.qualityBefore!);
    const presentationScores = runs
      .map((run) => run.presentationScore)
      .filter((score): score is number => score !== undefined);

    const models = new Map<
      string,
      {
        model: string;
        attempts: number;
        failures: number;
        fallbacks: number;
        stages: number;
        inputTokens: number;
        outputTokens: number;
        durationMs: number;
        estimatedCostMicroUsd: number;
      }
    >();
    for (const event of usage) {
      const row = models.get(event.model) ?? {
        model: event.model,
        attempts: 0,
        failures: 0,
        fallbacks: 0,
        stages: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        estimatedCostMicroUsd: 0,
      };
      row.stages += 1;
      row.inputTokens += event.inputTokens ?? 0;
      row.outputTokens += event.outputTokens ?? 0;
      row.durationMs += event.durationMs;
      row.estimatedCostMicroUsd += event.estimatedCostMicroUsd ?? 0;
      models.set(event.model, row);
    }
    for (const event of routes) {
      const row = models.get(event.model) ?? {
        model: event.model,
        attempts: 0,
        failures: 0,
        fallbacks: 0,
        stages: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicroUsd: 0,
        durationMs: 0,
      };
      row.attempts += 1;
      if (event.outcome === "failed") row.failures += 1;
      if (event.fallback) row.fallbacks += 1;
      models.set(event.model, row);
    }

    const agents = new Map<
      string,
      {
        agentSlug: string;
        runs: number;
        published: number;
        skipped: number;
        failed: number;
        replies: number;
        ignoredReplies: number;
        inputTokens: number;
        outputTokens: number;
        averageQuality: number;
        qualitySamples: number;
        estimatedCostMicroUsd: number;
      }
    >();
    const agentRow = (agentSlug: string) => {
      const row = agents.get(agentSlug) ?? {
        agentSlug,
        runs: 0,
        published: 0,
        skipped: 0,
        failed: 0,
        replies: 0,
        ignoredReplies: 0,
        inputTokens: 0,
        outputTokens: 0,
        averageQuality: 0,
        qualitySamples: 0,
        estimatedCostMicroUsd: 0,
      };
      agents.set(agentSlug, row);
      return row;
    };
    for (const run of runs) {
      const row = agentRow(run.agentSlug);
      row.runs += 1;
      if (run.status === "published") row.published += 1;
      if (run.status === "skipped") row.skipped += 1;
      if (run.status === "failed") row.failed += 1;
      if (run.qualityScore !== undefined) {
        row.averageQuality += run.qualityScore;
        row.qualitySamples += 1;
      }
    }
    for (const reply of replies) {
      const row = agentRow(reply.agentSlug);
      if (reply.status === "replied") row.replies += 1;
      if (reply.status === "ignored") row.ignoredReplies += 1;
      if (reply.status === "failed") row.failed += 1;
    }
    for (const event of usage) {
      const row = agentRow(event.agentSlug);
      row.inputTokens += event.inputTokens ?? 0;
      row.outputTokens += event.outputTokens ?? 0;
      row.estimatedCostMicroUsd += event.estimatedCostMicroUsd ?? 0;
    }

    const stages = new Map<
      string,
      {
        stage: string;
        events: number;
        inputTokens: number;
        outputTokens: number;
        durationMs: number;
        estimatedCostMicroUsd: number;
      }
    >();
    for (const event of usage) {
      const row = stages.get(event.stage) ?? {
        stage: event.stage,
        events: 0,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: 0,
        estimatedCostMicroUsd: 0,
      };
      row.events += 1;
      row.inputTokens += event.inputTokens ?? 0;
      row.outputTokens += event.outputTokens ?? 0;
      row.durationMs += event.durationMs;
      row.estimatedCostMicroUsd += event.estimatedCostMicroUsd ?? 0;
      stages.set(event.stage, row);
    }

    const intervalMs = windowHours <= 48 ? 3_600_000 : 86_400_000;
    const series = new Map<
      number,
      {
        at: number;
        generations: number;
        failures: number;
        inputTokens: number;
        outputTokens: number;
        estimatedCostMicroUsd: number;
      }
    >();
    for (const event of usage) {
      const at = Math.floor(event.createdAt / intervalMs) * intervalMs;
      const row = series.get(at) ?? {
        at,
        generations: 0,
        failures: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicroUsd: 0,
      };
      row.generations += 1;
      row.inputTokens += event.inputTokens ?? 0;
      row.outputTokens += event.outputTokens ?? 0;
      row.estimatedCostMicroUsd += event.estimatedCostMicroUsd ?? 0;
      series.set(at, row);
    }
    for (const event of routes) {
      if (event.outcome !== "failed") continue;
      const at = Math.floor(event.createdAt / intervalMs) * intervalMs;
      const row = series.get(at) ?? {
        at,
        generations: 0,
        failures: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostMicroUsd: 0,
      };
      row.failures += 1;
      series.set(at, row);
    }

    const recent = [
      ...routes.map((event) => ({
        kind: "route" as const,
        at: event.createdAt,
        correlationId: event.correlationId,
        agentSlug: event.agentSlug,
        stage: event.stage,
        model: event.model,
        status: event.outcome,
        detail: event.errorMessage,
        durationMs: event.durationMs,
      })),
      ...runs.map((run) => ({
        kind: "publication" as const,
        at: run.updatedAt,
        correlationId: run.runKey,
        agentSlug: run.agentSlug,
        stage: "publication",
        model: run.model,
        status: run.status,
        detail: run.errorMessage ?? run.title,
        durationMs: run.completedAt
          ? run.completedAt - run.startedAt
          : undefined,
      })),
      ...replies.map((reply) => ({
        kind: "reply" as const,
        at: reply.updatedAt,
        correlationId: reply.runKey,
        agentSlug: reply.agentSlug,
        stage: "reply",
        model: reply.model,
        status: reply.status,
        detail: reply.reason,
        durationMs: reply.completedAt
          ? reply.completedAt - reply.startedAt
          : undefined,
      })),
      ...newsletters.map((run) => ({
        kind: "newsletter" as const,
        at: run.updatedAt,
        correlationId: `newsletter:${run.runDate}`,
        agentSlug: "belle",
        stage: "newsletter",
        model: undefined,
        status: run.status,
        detail: run.errorMessage,
        durationMs: run.completedAt
          ? run.completedAt - run.startedAt
          : undefined,
      })),
    ]
      .sort((left, right) => right.at - left.at)
      .slice(0, 100);

    return {
      generatedAt: Date.now(),
      windowHours,
      totals: {
        routeAttempts: routes.length,
        routeFailures: routes.filter((event) => event.outcome === "failed")
          .length,
        fallbackAttempts: routes.filter((event) => event.fallback).length,
        agentRuns: runs.length,
        published: runs.filter((run) => run.status === "published").length,
        skipped: runs.filter((run) => run.status === "skipped").length,
        failed: runs.filter((run) => run.status === "failed").length,
        replies: replies.filter((reply) => reply.status === "replied").length,
        newsletters: newsletters.length,
        inputTokens,
        outputTokens,
        averageDurationMs: average(durations),
        p95DurationMs: percentile(durations, 0.95),
        averageQuality: average(qualityScores),
        estimatedSpendUsd: estimatedCostMicroUsd / 1_000_000,
        revisionRate:
          (usage.filter((event) => event.stage === "revision").length /
            Math.max(
              1,
              usage.filter((event) => event.stage === "draft").length,
            )) *
          100,
        averageRevisionGain: average(revisionGainValues),
        averagePresentation: average(presentationScores),
      },
      models: [...models.values()].sort(
        (left, right) => right.outputTokens - left.outputTokens,
      ),
      agents: [...agents.values()]
        .map((row) => ({
          ...row,
          averageQuality: row.qualitySamples
            ? Math.round((row.averageQuality / row.qualitySamples) * 100) / 100
            : 0,
        }))
        .sort(
          (left, right) =>
            right.runs + right.replies - (left.runs + left.replies),
        ),
      stages: [...stages.values()]
        .map((row) => ({
          ...row,
          averageDurationMs: row.events
            ? Math.round(row.durationMs / row.events)
            : 0,
        }))
        .sort((left, right) => right.events - left.events),
      series: [...series.values()].sort((left, right) => left.at - right.at),
      recent,
      operations: {
        budget: {
          dayKey,
          spentUsd:
            spendBuckets.reduce((sum, row) => sum + row.spentMicroUsd, 0) /
            1_000_000,
          limitUsd:
            openRouterDailyBudgetMicroUsd(env.OPENROUTER_DAILY_BUDGET_USD) /
            1_000_000,
        },
        circuits: circuits
          .filter((circuit) => circuit.disabledUntil > now)
          .map((circuit) => ({
            model: circuit.model,
            reason: circuit.reason,
            disabledUntil: circuit.disabledUntil,
          })),
        canary,
        embedding,
      },
      bounded: {
        routes: routes.length === 500,
        runs: runs.length === 500,
        replies: replies.length === 500,
        usage: usage.length === 1_000,
        newsletters: newsletters.length === 200,
      },
    };
  },
});

function average(values: number[]) {
  if (!values.length) return 0;
  return (
    Math.round(
      (values.reduce((sum, value) => sum + value, 0) / values.length) * 100,
    ) / 100
  );
}

function percentile(values: number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}
