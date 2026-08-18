import { v } from "convex/values";
import {
  WEB_VITAL_BUDGETS,
  WEB_VITAL_METRICS,
  WEB_VITAL_ROUTE_TEMPLATES,
  type WebVitalMetricName,
} from "../lib/web-vitals";
import type { Id } from "./_generated/dataModel";
import {
  env,
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireSiteAdmin } from "./authz";

const operationalSloEnv = env as typeof env & {
  WEB_VITALS_SLO_ENABLED: string | undefined;
};

export const WEB_VITAL_SLO_POLICY_VERSION = "web-vitals-p75-v1";
const WINDOW_MS = 24 * 60 * 60 * 1_000;
const MINIMUM_SAMPLES = 20;
const SAMPLE_READ_LIMIT = 5_000;
const STATE_READ_LIMIT = 250;

const metricValidator = v.union(...WEB_VITAL_METRICS.map(v.literal));
const statusValidator = v.union(
  v.literal("unknown"),
  v.literal("healthy"),
  v.literal("breached"),
);
const stateValidator = v.object({
  route: v.string(),
  name: metricValidator,
  threshold: v.number(),
  minimumSamples: v.number(),
  status: statusValidator,
  sampleCount: v.number(),
  p75: v.union(v.number(), v.null()),
  lastSampleAt: v.union(v.number(), v.null()),
  lastEvaluatedAt: v.number(),
  breachedAt: v.union(v.number(), v.null()),
  recoveredAt: v.union(v.number(), v.null()),
});

/**
 * Hourly, fail-closed p75 evaluator over aggregate-only field Web Vitals.
 * One bounded indexed read avoids per-route scans; a saturated result is
 * unknown, never a potentially false healthy result.
 */
export const evaluate = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({
    enabled: v.boolean(),
    evaluated: v.number(),
    breached: v.number(),
    healthy: v.number(),
    unknown: v.number(),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (!sloEnabled()) {
      return {
        enabled: false,
        evaluated: 0,
        breached: 0,
        healthy: 0,
        unknown: 0,
        truncated: false,
      };
    }

    const now = args.now ?? Date.now();
    const events = await ctx.db
      .query("webVitalEvents")
      .withIndex("by_createdAt", (q) =>
        q.gte("createdAt", now - WINDOW_MS).lte("createdAt", now),
      )
      .order("desc")
      .take(SAMPLE_READ_LIMIT);
    const truncated = events.length === SAMPLE_READ_LIMIT;
    const grouped = new Map<string, typeof events>();
    for (const event of events) {
      const key = `${event.route}:${event.name}`;
      const group = grouped.get(key) ?? [];
      group.push(event);
      grouped.set(key, group);
    }

    let breached = 0;
    let healthy = 0;
    let unknown = 0;
    for (const route of WEB_VITAL_ROUTE_TEMPLATES) {
      for (const name of WEB_VITAL_METRICS) {
        const observations = grouped.get(`${route}:${name}`) ?? [];
        const result = summarize(observations, name, truncated);
        if (result.status === "breached") breached += 1;
        else if (result.status === "healthy") healthy += 1;
        else unknown += 1;
        await persistState(ctx, route, name, result, now);
      }
    }
    return {
      enabled: true,
      evaluated: WEB_VITAL_ROUTE_TEMPLATES.length * WEB_VITAL_METRICS.length,
      breached,
      healthy,
      unknown,
      truncated,
    };
  },
});

export const summaryAdmin = query({
  args: {},
  returns: v.object({
    policyVersion: v.string(),
    enabled: v.boolean(),
    sampledStates: v.number(),
    counts: v.object({
      breached: v.number(),
      healthy: v.number(),
      unknown: v.number(),
    }),
    states: v.array(stateValidator),
  }),
  handler: async (ctx) => {
    await requireSiteAdmin(ctx);
    const [breached, healthy, unknown] = await Promise.all([
      ctx.db
        .query("webVitalSloStates")
        .withIndex("by_policyVersion_and_status", (q) =>
          q
            .eq("policyVersion", WEB_VITAL_SLO_POLICY_VERSION)
            .eq("status", "breached"),
        )
        .take(STATE_READ_LIMIT),
      ctx.db
        .query("webVitalSloStates")
        .withIndex("by_policyVersion_and_status", (q) =>
          q
            .eq("policyVersion", WEB_VITAL_SLO_POLICY_VERSION)
            .eq("status", "healthy"),
        )
        .take(STATE_READ_LIMIT),
      ctx.db
        .query("webVitalSloStates")
        .withIndex("by_policyVersion_and_status", (q) =>
          q
            .eq("policyVersion", WEB_VITAL_SLO_POLICY_VERSION)
            .eq("status", "unknown"),
        )
        .take(STATE_READ_LIMIT),
    ]);
    const states = [...breached, ...unknown, ...healthy]
      .map((state) => ({
        route: state.route,
        name: state.name,
        threshold: state.threshold,
        minimumSamples: state.minimumSamples,
        status: state.status,
        sampleCount: state.sampleCount,
        p75: state.p75 ?? null,
        lastSampleAt: state.lastSampleAt ?? null,
        lastEvaluatedAt: state.lastEvaluatedAt,
        breachedAt: state.breachedAt ?? null,
        recoveredAt: state.recoveredAt ?? null,
      }))
      .sort(
        (left, right) =>
          statusOrder(left.status) - statusOrder(right.status) ||
          left.route.localeCompare(right.route) ||
          left.name.localeCompare(right.name),
      );
    return {
      policyVersion: WEB_VITAL_SLO_POLICY_VERSION,
      enabled: sloEnabled(),
      sampledStates: states.length,
      counts: {
        breached: breached.length,
        healthy: healthy.length,
        unknown: unknown.length,
      },
      states,
    };
  },
});

async function persistState(
  ctx: MutationCtx,
  route: string,
  name: WebVitalMetricName,
  result: Evaluation,
  now: number,
) {
  const existing = await ctx.db
    .query("webVitalSloStates")
    .withIndex("by_policyVersion_and_route_and_name", (q) =>
      q
        .eq("policyVersion", WEB_VITAL_SLO_POLICY_VERSION)
        .eq("route", route)
        .eq("name", name),
    )
    .unique();
  const breachBegins = result.status === "breached" && !existing?.breachActive;
  const recovery =
    result.status === "healthy" && existing?.breachActive === true;
  const values = {
    policyVersion: WEB_VITAL_SLO_POLICY_VERSION,
    route,
    name,
    threshold: WEB_VITAL_BUDGETS[name],
    minimumSamples: MINIMUM_SAMPLES,
    status: result.status,
    sampleCount: result.sampleCount,
    // `undefined` intentionally removes optional fields in Convex patches.
    // Omitting either key would retain a prior p75/timestamp after the state
    // becomes unknown, which would make an insufficient sample look current.
    p75: result.p75 ?? undefined,
    lastSampleAt: result.lastSampleAt ?? undefined,
    lastEvaluatedAt: now,
    breachActive:
      result.status === "unknown"
        ? (existing?.breachActive ?? false)
        : result.status === "breached",
    ...(breachBegins ? { breachedAt: now } : {}),
    ...(recovery ? { recoveredAt: now } : {}),
  };

  if (existing === null) {
    const id = await ctx.db.insert("webVitalSloStates", values);
    if (breachBegins)
      await recordBreach(ctx, id, route, name, result.p75!, now);
    return;
  }

  await ctx.db.patch("webVitalSloStates", existing._id, values);
  if (breachBegins) {
    await recordBreach(ctx, existing._id, route, name, result.p75!, now);
  } else if (recovery) {
    if (existing.openLogId !== undefined) {
      await ctx.db.patch("systemLogs", existing.openLogId, {
        status: "resolved",
        updatedAt: now,
        lastSeenAt: now,
      });
    }
    await recordRecovery(ctx, route, name, result.p75!, now);
  }
}

async function recordBreach(
  ctx: MutationCtx,
  stateId: Id<"webVitalSloStates">,
  route: string,
  name: WebVitalMetricName,
  p75: number,
  now: number,
) {
  const logId = await ctx.db.insert("systemLogs", {
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    occurrences: 1,
    level: "warn",
    status: "open",
    source: "convex",
    scope: "web-vitals-slo",
    eventType: "web_vitals_slo_breached",
    message: `${route} ${name} p75 ${p75} exceeds ${WEB_VITAL_BUDGETS[name]}.`,
    fingerprint: `web-vitals-slo:${WEB_VITAL_SLO_POLICY_VERSION}:${route}:${name}:breach`,
    component: "operationalSlo",
    action: "evaluate",
    metadataJson: JSON.stringify({
      route,
      name,
      p75,
      threshold: WEB_VITAL_BUDGETS[name],
    }),
  });
  await ctx.db.patch("webVitalSloStates", stateId, { openLogId: logId });
}

async function recordRecovery(
  ctx: MutationCtx,
  route: string,
  name: WebVitalMetricName,
  p75: number,
  now: number,
) {
  await ctx.db.insert("systemLogs", {
    createdAt: now,
    updatedAt: now,
    lastSeenAt: now,
    occurrences: 1,
    level: "info",
    status: "resolved",
    source: "convex",
    scope: "web-vitals-slo",
    eventType: "web_vitals_slo_recovered",
    message: `${route} ${name} p75 ${p75} recovered within ${WEB_VITAL_BUDGETS[name]}.`,
    fingerprint: `web-vitals-slo:${WEB_VITAL_SLO_POLICY_VERSION}:${route}:${name}:recovered:${now}`,
    component: "operationalSlo",
    action: "evaluate",
    metadataJson: JSON.stringify({
      route,
      name,
      p75,
      threshold: WEB_VITAL_BUDGETS[name],
    }),
  });
}

type Evaluation = {
  status: "unknown" | "healthy" | "breached";
  sampleCount: number;
  p75: number | null;
  lastSampleAt: number | null;
};

function summarize(
  events: Array<{ value: number; createdAt: number }>,
  name: WebVitalMetricName,
  truncated: boolean,
): Evaluation {
  if (truncated || events.length < MINIMUM_SAMPLES) {
    return {
      status: "unknown",
      sampleCount: events.length,
      p75: null,
      lastSampleAt: events[0]?.createdAt ?? null,
    };
  }
  const values = events.map((event) => event.value).sort((a, b) => a - b);
  const p75 = values[Math.ceil(values.length * 0.75) - 1];
  if (p75 === undefined) throw new Error("SLO evaluation requires samples.");
  return {
    status: p75 > WEB_VITAL_BUDGETS[name] ? "breached" : "healthy",
    sampleCount: events.length,
    p75,
    lastSampleAt: events[0]?.createdAt ?? null,
  };
}

function statusOrder(status: Evaluation["status"]) {
  return status === "breached" ? 0 : status === "unknown" ? 1 : 2;
}

function sloEnabled() {
  return (
    operationalSloEnv.WEB_VITALS_SLO_ENABLED?.trim().toLowerCase() === "true"
  );
}
