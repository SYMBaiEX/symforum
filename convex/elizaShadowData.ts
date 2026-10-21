import { DAY, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError, v } from "convex/values";
import { components, internal } from "./_generated/api";
import {
  env,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { requireSiteAdmin } from "./authz";
import { shadowKind, shadowStatus } from "./elizaShadowSchema";
import {
  reserveModelCallImpl,
  settleModelCallReservation,
} from "./aiRoutingControlData";
import {
  estimatedModelCostMicroUsd,
  forumDayKey,
  openRouterDailyBudgetMicroUsd,
} from "../lib/ai-model-costs";
import {
  ELIZA_SHADOW_MODEL,
  ELIZA_SHADOW_PRIVATE_MAX_BYTES,
  ELIZA_SHADOW_RETENTION_MS,
  ELIZA_SHADOW_TIMEOUT_MS,
  ELIZA_SHADOW_OUTPUT_MAX_BYTES,
  parseBoundedShadowJson,
  parseShadowInput,
  shadowBudgetMicroUsd,
  shadowInputHash,
  shadowWorkerOrigin,
  shadowWorkerResultSchema,
} from "../lib/eliza-shadow-contract";

const limiter = new RateLimiter(components.rateLimiter, {
  elizaShadowJobs: { kind: "fixed window", rate: 12, period: DAY, start: 0 },
});
const enqueueArgs = {
  jobKey: v.string(),
  kind: shadowKind,
  sourceRunKey: v.string(),
  promptVersion: v.string(),
  inputJson: v.string(),
  baselineJson: v.string(),
  evaluationJson: v.string(),
};
const enqueueReturns = v.object({
  status: v.union(
    v.literal("queued"),
    v.literal("disabled"),
    v.literal("duplicate"),
    v.literal("limited"),
  ),
  jobId: v.optional(v.id("elizaShadowJobs")),
});

export function shadowEnabled() {
  return (
    env.ELIZA_SHADOW_MODE === "shadow" &&
    (env.ELIZA_SHADOW_WORKER_SECRET?.length ?? 0) >= 32 &&
    shadowWorkerOrigin(env.ELIZA_SHADOW_WORKER_URL) !== null &&
    shadowBudgetMicroUsd(env.ELIZA_SHADOW_DAILY_BUDGET_USD) > 0
  );
}

export const enqueue = internalMutation({
  args: enqueueArgs,
  returns: enqueueReturns,
  handler: async (ctx, args) => enqueueImpl(ctx, args, false),
});

async function enqueueImpl(
  ctx: MutationCtx,
  args: {
    jobKey: string;
    kind: "suki-reply" | "belle-newsletter";
    sourceRunKey: string;
    promptVersion: string;
    inputJson: string;
    baselineJson: string;
    evaluationJson: string;
  },
  isCanary: boolean,
) {
  if (!shadowEnabled()) return { status: "disabled" as const };
  if (
    !args.jobKey ||
    args.jobKey.length > 240 ||
    args.sourceRunKey.length > 240 ||
    args.promptVersion.length > 160
  ) {
    throw new ConvexError("invalid_shadow_identity");
  }
  parseShadowInput(args.inputJson, args.kind);
  parseBoundedShadowJson(args.baselineJson, ELIZA_SHADOW_PRIVATE_MAX_BYTES);
  parseBoundedShadowJson(args.evaluationJson, ELIZA_SHADOW_PRIVATE_MAX_BYTES);
  const inputHash = await shadowInputHash(args.inputJson);
  const existing = await ctx.db
    .query("elizaShadowJobs")
    .withIndex("by_jobKey", (q) => q.eq("jobKey", args.jobKey))
    .unique();
  if (existing) {
    if (existing.inputHash !== inputHash)
      throw new ConvexError("shadow_fingerprint_conflict");
    return { status: "duplicate" as const, jobId: existing._id };
  }
  const capacity = await limiter.limit(ctx, "elizaShadowJobs", {
    key: args.kind,
  });
  if (!capacity.ok) return { status: "limited" as const };
  const now = Date.now();
  const jobId = await ctx.db.insert("elizaShadowJobs", {
    ...args,
    inputHash,
    status: "queued",
    isCanary,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + ELIZA_SHADOW_RETENTION_MS,
  });
  // Existing Convex scheduler owns execution. No worker polling or publishing API.
  await ctx.scheduler.runAfter(0, internal.elizaShadow.dispatch, { jobId });
  return { status: "queued" as const, jobId };
}

export const claim = internalMutation({
  args: { jobId: v.id("elizaShadowJobs") },
  returns: v.union(
    v.null(),
    v.object({
      inputJson: v.string(),
      inputHash: v.string(),
      model: v.string(),
      maxOutputTokens: v.number(),
    }),
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("elizaShadowJobs", jobId);
    if (!job || job.status !== "queued") return null;
    const now = Date.now();
    if (!shadowEnabled() || job.expiresAt <= now) {
      await ctx.db.patch("elizaShadowJobs", jobId, {
        status: job.expiresAt <= now ? "expired" : "disabled",
        updatedAt: now,
      });
      return null;
    }
    const input = parseShadowInput(job.inputJson, job.kind);
    const maxOutputTokens = job.isCanary
      ? 128
      : job.kind === "suki-reply"
        ? 2_400
        : 10_000;
    // UTF-8 byte count is deliberately conservative, including schema overhead.
    const inputTokens =
      new TextEncoder().encode(JSON.stringify(input)).byteLength + 512;
    const estimate = estimatedModelCostMicroUsd(
      ELIZA_SHADOW_MODEL,
      inputTokens,
      maxOutputTokens,
    );
    const shadowLimit = await limiter.limit(ctx, "elizaShadowSpend", {
      count: estimate,
      config: {
        kind: "fixed window",
        rate: shadowBudgetMicroUsd(env.ELIZA_SHADOW_DAILY_BUDGET_USD),
        period: DAY,
        start: 0,
      },
    });
    if (!shadowLimit.ok) {
      await ctx.db.patch("elizaShadowJobs", jobId, {
        status: "failed",
        errorCode: "shadow_daily_budget",
        updatedAt: now,
      });
      return null;
    }
    const reservationKey = `eliza-shadow:${jobId}`;
    const reservation = await reserveModelCallImpl(ctx, {
      reservationKey,
      model: ELIZA_SHADOW_MODEL,
      dayKey: forumDayKey(now),
      estimatedInputTokens: inputTokens,
      estimatedOutputTokens: maxOutputTokens,
      budgetLimitMicroUsd: openRouterDailyBudgetMicroUsd(
        env.OPENROUTER_DAILY_BUDGET_USD,
      ),
    });
    if (!reservation.accepted) {
      await ctx.db.patch("elizaShadowJobs", jobId, {
        status: "failed",
        errorCode: "shared_model_budget",
        updatedAt: now,
      });
      return null;
    }
    await ctx.db.patch("elizaShadowJobs", jobId, {
      status: "running",
      updatedAt: now,
      deadline: now + ELIZA_SHADOW_TIMEOUT_MS + 30_000,
      reservationKey,
      model: ELIZA_SHADOW_MODEL,
      reservedMicroUsd: reservation.estimatedMicroUsd,
    });
    await ctx.scheduler.runAfter(
      ELIZA_SHADOW_TIMEOUT_MS + 30_000,
      internal.elizaShadowData.expireRunning,
      { jobId },
    );
    return {
      inputJson: job.inputJson,
      inputHash: job.inputHash,
      model: ELIZA_SHADOW_MODEL,
      maxOutputTokens,
    };
  },
});

export const evaluationContext = internalQuery({
  args: { jobId: v.id("elizaShadowJobs") },
  returns: v.union(
    v.null(),
    v.object({
      kind: shadowKind,
      inputJson: v.string(),
      baselineJson: v.string(),
      evaluationJson: v.string(),
      isCanary: v.boolean(),
    }),
  ),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("elizaShadowJobs", jobId);
    if (!job || job.status !== "running") return null;
    return {
      kind: job.kind,
      inputJson: job.inputJson,
      baselineJson: job.baselineJson,
      evaluationJson: job.evaluationJson,
      isCanary: job.isCanary,
    };
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id("elizaShadowJobs"),
    resultJson: v.string(),
    comparisonJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = shadowWorkerResultSchema.parse(
      parseBoundedShadowJson(
        args.resultJson,
        ELIZA_SHADOW_OUTPUT_MAX_BYTES + 2_048,
      ),
    );
    parseBoundedShadowJson(args.comparisonJson, 32 * 1024);
    const job = await ctx.db.get("elizaShadowJobs", args.jobId);
    if (
      !job ||
      result.jobId !== args.jobId ||
      job.inputHash !== result.inputHash ||
      job.model !== result.model
    )
      throw new ConvexError("shadow_result_mismatch");
    const outputJson = JSON.stringify(result.output);
    if (job.status === "completed") {
      if (job.outputJson !== outputJson)
        throw new ConvexError("shadow_result_conflict");
      return null;
    }
    const now = Date.now();
    if (
      job.status !== "running" ||
      (job.deadline ?? 0) < now ||
      !job.reservationKey
    )
      throw new ConvexError("shadow_result_expired");
    if (
      result.outputTokens >
      (job.isCanary ? 128 : job.kind === "suki-reply" ? 2_400 : 10_000)
    )
      throw new ConvexError("shadow_token_limit");
    await settleModelCallReservation(ctx, {
      reservationKey: job.reservationKey,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      providerReportedCostMicroUsd: result.providerCostMicroUsd,
    });
    await ctx.db.patch("elizaShadowJobs", args.jobId, {
      status: "completed",
      outputJson,
      comparisonJson: args.comparisonJson,
      servedModel: result.servedModel,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      providerCostMicroUsd: result.providerCostMicroUsd,
      durationMs: result.durationMs,
      runtimeVersion: result.runtimeVersion,
      completedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const fail = internalMutation({
  args: {
    jobId: v.id("elizaShadowJobs"),
    errorCode: v.union(
      v.literal("worker_unavailable"),
      v.literal("invalid_worker_result"),
      v.literal("evaluation_unavailable"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("elizaShadowJobs", args.jobId);
    if (job?.status === "running")
      await ctx.db.patch("elizaShadowJobs", args.jobId, {
        status: "failed",
        errorCode: args.errorCode,
        updatedAt: Date.now(),
      });
    // Failed/ambiguous calls keep their conservative reservation. Never retry inference.
    return null;
  },
});

export const expireRunning = internalMutation({
  args: { jobId: v.id("elizaShadowJobs") },
  returns: v.null(),
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get("elizaShadowJobs", jobId);
    if (job?.status === "running" && (job.deadline ?? 0) <= Date.now()) {
      await ctx.db.patch("elizaShadowJobs", jobId, {
        status: "expired",
        errorCode: "worker_deadline",
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

const summaryValidator = v.object({
  jobId: v.id("elizaShadowJobs"),
  kind: shadowKind,
  sourceRunKey: v.string(),
  status: shadowStatus,
  inputHash: v.string(),
  createdAt: v.number(),
  isCanary: v.boolean(),
  model: v.optional(v.string()),
  runtimeVersion: v.optional(v.string()),
  comparisonJson: v.optional(v.string()),
  errorCode: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  outputTokens: v.optional(v.number()),
  durationMs: v.optional(v.number()),
  providerCostMicroUsd: v.optional(v.number()),
});

export const listAdmin = query({
  args: { kind: shadowKind },
  returns: v.array(summaryValidator),
  handler: async (ctx, { kind }) => {
    await requireSiteAdmin(ctx);
    return await listSummaries(ctx, kind);
  },
});
export const inspect = internalQuery({
  args: { kind: shadowKind },
  returns: v.array(summaryValidator),
  handler: async (ctx, { kind }) => await listSummaries(ctx, kind),
});

async function listSummaries(
  ctx: Pick<import("./_generated/server").QueryCtx, "db">,
  kind: "suki-reply" | "belle-newsletter",
) {
  const jobs = await ctx.db
    .query("elizaShadowJobs")
    .withIndex("by_kind_and_createdAt", (q) => q.eq("kind", kind))
    .order("desc")
    .take(40);
  return jobs.map((j) => ({
    jobId: j._id,
    kind: j.kind,
    sourceRunKey: j.sourceRunKey,
    status: j.status,
    inputHash: j.inputHash,
    createdAt: j.createdAt,
    isCanary: j.isCanary,
    model: j.model,
    runtimeVersion: j.runtimeVersion,
    comparisonJson: j.comparisonJson,
    errorCode: j.errorCode,
    inputTokens: j.inputTokens,
    outputTokens: j.outputTokens,
    durationMs: j.durationMs,
    providerCostMicroUsd: j.providerCostMicroUsd,
  }));
}

export const cleanup = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("elizaShadowJobs")
      .withIndex("by_expiresAt", (q) => q.lte("expiresAt", Date.now()))
      .take(25);
    for (const job of jobs) await ctx.db.delete("elizaShadowJobs", job._id);
    if (jobs.length === 25)
      await ctx.scheduler.runAfter(0, internal.elizaShadowData.cleanup, {});
    return jobs.length;
  },
});

/** Internal operator canaries never invoke either live agent or its publisher. */
export const enqueueCanary = internalMutation({
  args: { kind: shadowKind, nonce: v.string() },
  returns: enqueueReturns,
  handler: async (ctx, { kind, nonce }) => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(nonce))
      throw new ConvexError("invalid_canary_nonce");
    return await enqueueImpl(
      ctx,
      {
        jobKey: `eliza-shadow:canary:${kind}:${nonce}`,
        kind,
        sourceRunKey: `canary:${nonce}`,
        promptVersion: "shadow-canary-v1",
        baselineJson: "{}",
        evaluationJson: "{}",
        inputJson: JSON.stringify({
          version: 1,
          kind,
          system:
            kind === "suki-reply"
              ? "You are Suki. This is a non-publishing shadow runtime health check."
              : "You are Belle. This is a non-publishing newsletter draft runtime health check.",
          prompt:
            'Return {"healthy":true,"mode":"shadow"} only. Do not publish anything.',
          schema: {
            type: "object",
            properties: {
              healthy: { type: "boolean", const: true },
              mode: { type: "string", const: "shadow" },
            },
            required: ["healthy", "mode"],
            additionalProperties: false,
          },
        }),
      },
      true,
    );
  },
});
