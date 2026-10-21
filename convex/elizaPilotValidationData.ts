import { v } from "convex/values";
import { sha256Base64Url } from "./agentIdentityCrypto";
import {
  ELIZA_SHADOW_PRIVATE_MAX_BYTES,
  ELIZA_SHADOW_RETENTION_MS,
  parseBoundedShadowJson,
} from "../lib/eliza-shadow-contract";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery } from "./_generated/server";

const MAX_CATEGORY_ANCESTORS = 16;
const kind = v.union(v.literal("suki-reply"), v.literal("belle-newsletter"));
const status = v.union(
  v.literal("reserved"),
  v.literal("completed"),
  v.literal("blocked"),
  v.literal("failed"),
);
const pilotArtifactStatus = v.union(
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("review_failed"),
);
export type PilotArtifactStatus = "accepted" | "rejected" | "review_failed";
const belleArtifactSourceKey =
  /^snapshot:(\d{4}-\d{2}-\d{2}):run:(\d{4}-\d{2}-\d{2})(:eliza)?$/;

function isDateKey(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

const summary = v.object({
  nonce: v.string(),
  kind,
  sourceKey: v.string(),
  status,
  sourceHash: v.optional(v.string()),
  sourceCount: v.optional(v.number()),
  shadowJobId: v.optional(v.id("elizaShadowJobs")),
  shadowStatus: v.optional(v.string()),
  baselineDecision: v.optional(v.string()),
  errorCode: v.optional(v.string()),
});

/** One immutable operator attempt per nonce, reserved before any model work. */
export const reserve = internalMutation({
  args: { nonce: v.string(), kind, sourceKey: v.string() },
  returns: v.object({ duplicate: v.boolean(), run: summary }),
  handler: async (ctx, args) => {
    if (
      !/^[A-Za-z0-9_-]{16,80}$/.test(args.nonce) ||
      args.sourceKey.length > 160
    )
      throw new Error("invalid_pilot_identity");
    const existing = await ctx.db
      .query("elizaPilotRuns")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (existing) {
      if (existing.kind !== args.kind || existing.sourceKey !== args.sourceKey)
        throw new Error("pilot_nonce_conflict");
      return { duplicate: true, run: toSummary(existing) };
    }
    const now = Date.now();
    const id = await ctx.db.insert("elizaPilotRuns", {
      ...args,
      status: "reserved",
      createdAt: now,
      updatedAt: now,
    });
    return {
      duplicate: false,
      run: toSummary((await ctx.db.get("elizaPilotRuns", id))!),
    };
  },
});

export const finish = internalMutation({
  args: {
    nonce: v.string(),
    status: v.union(
      v.literal("completed"),
      v.literal("blocked"),
      v.literal("failed"),
    ),
    sourceHash: v.optional(v.string()),
    sourceCount: v.optional(v.number()),
    shadowJobId: v.optional(v.id("elizaShadowJobs")),
    shadowStatus: v.optional(v.string()),
    baselineDecision: v.optional(v.string()),
    errorCode: v.optional(v.string()),
  },
  returns: summary,
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("elizaPilotRuns")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!run) throw new Error("pilot_run_missing");
    if (run.status !== "reserved") return toSummary(run);
    const { nonce: _nonce, ...patch } = args;
    await ctx.db.patch("elizaPilotRuns", run._id, {
      ...patch,
      updatedAt: Date.now(),
    });
    return toSummary((await ctx.db.get("elizaPilotRuns", run._id))!);
  },
});

const artifactReceipt = v.object({
  artifactHash: v.string(),
  artifactExpiresAt: v.number(),
  artifactStatus: pilotArtifactStatus,
  duplicate: v.boolean(),
});

/** Store one bounded private Belle baseline/evaluation pair for a pilot nonce. */
export const recordArtifact = internalMutation({
  args: {
    nonce: v.string(),
    sourceKey: v.string(),
    baselineJson: v.string(),
    evaluationJson: v.string(),
    artifactStatus: pilotArtifactStatus,
  },
  returns: artifactReceipt,
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("elizaPilotRuns")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!run || run.kind !== "belle-newsletter")
      throw new Error("pilot_artifact_run_invalid");
    if (run.status !== "reserved")
      throw new Error("pilot_artifact_attempt_closed");
    const sourceKeyMatch = belleArtifactSourceKey.exec(args.sourceKey);
    if (
      args.sourceKey.length > 160 ||
      !sourceKeyMatch ||
      !isDateKey(sourceKeyMatch[1]!) ||
      !isDateKey(sourceKeyMatch[2]!)
    )
      throw new Error("pilot_artifact_source_invalid");
    if (run.sourceKey !== args.sourceKey)
      throw new Error("pilot_artifact_source_mismatch");

    parseBoundedShadowJson(args.baselineJson, ELIZA_SHADOW_PRIVATE_MAX_BYTES);
    parseBoundedShadowJson(args.evaluationJson, ELIZA_SHADOW_PRIVATE_MAX_BYTES);
    const payloadHash = await sha256Base64Url(
      JSON.stringify({
        sourceKey: args.sourceKey,
        baselineJson: args.baselineJson,
        evaluationJson: args.evaluationJson,
        artifactStatus: args.artifactStatus,
      }),
    );
    const hasExistingArtifact =
      run.baselineJson !== undefined ||
      run.evaluationJson !== undefined ||
      run.artifactStatus !== undefined ||
      run.artifactExpiresAt !== undefined ||
      run.artifactHash !== undefined;
    if (hasExistingArtifact) {
      if (
        run.baselineJson === args.baselineJson &&
        run.evaluationJson === args.evaluationJson &&
        run.artifactStatus === args.artifactStatus &&
        run.artifactHash === payloadHash &&
        run.artifactExpiresAt !== undefined
      ) {
        return {
          artifactHash: payloadHash,
          artifactExpiresAt: run.artifactExpiresAt,
          artifactStatus: args.artifactStatus,
          duplicate: true,
        };
      }
      throw new Error("pilot_artifact_conflict");
    }

    const artifactExpiresAt = Date.now() + ELIZA_SHADOW_RETENTION_MS;
    await ctx.db.patch("elizaPilotRuns", run._id, {
      baselineJson: args.baselineJson,
      evaluationJson: args.evaluationJson,
      artifactStatus: args.artifactStatus,
      artifactExpiresAt,
      artifactHash: payloadHash,
      updatedAt: Date.now(),
    });
    return {
      artifactHash: payloadHash,
      artifactExpiresAt,
      artifactStatus: args.artifactStatus,
      duplicate: false,
    };
  },
});

/** Read one still-retained private Belle artifact from an internal action. */
export const inspectBaseline = internalQuery({
  args: { nonce: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      nonce: v.string(),
      baselineJson: v.string(),
      evaluationJson: v.string(),
      artifactStatus: pilotArtifactStatus,
      artifactExpiresAt: v.number(),
      artifactHash: v.string(),
    }),
  ),
  handler: async (ctx, { nonce }) => {
    const run = await ctx.db
      .query("elizaPilotRuns")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .unique();
    if (
      !run ||
      run.kind !== "belle-newsletter" ||
      !run.baselineJson ||
      !run.evaluationJson ||
      !run.artifactStatus ||
      !run.artifactHash ||
      run.artifactExpiresAt === undefined ||
      run.artifactExpiresAt <= Date.now()
    )
      return null;
    return {
      nonce: run.nonce,
      baselineJson: run.baselineJson,
      evaluationJson: run.evaluationJson,
      artifactStatus: run.artifactStatus,
      artifactExpiresAt: run.artifactExpiresAt,
      artifactHash: run.artifactHash,
    };
  },
});

/** Read only the private artifact's outcome for validation-action decisions. */
export const readArtifactStatus = internalQuery({
  args: { nonce: v.string() },
  returns: v.union(v.null(), pilotArtifactStatus),
  handler: async (ctx, { nonce }) => {
    const run = await ctx.db
      .query("elizaPilotRuns")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .unique();
    if (
      !run ||
      run.kind !== "belle-newsletter" ||
      !run.artifactStatus ||
      !run.baselineJson ||
      !run.evaluationJson ||
      !run.artifactHash ||
      run.artifactExpiresAt === undefined ||
      run.artifactExpiresAt <= Date.now()
    )
      return null;
    return run.artifactStatus;
  },
});

/** Remove expired private payloads while retaining the one-attempt tombstone. */
export const cleanupArtifacts = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const runs = await ctx.db
      .query("elizaPilotRuns")
      .withIndex("by_artifactExpiresAt", (q) =>
        q.gt("artifactExpiresAt", 0).lte("artifactExpiresAt", now),
      )
      .take(50);
    for (const run of runs) {
      await ctx.db.patch("elizaPilotRuns", run._id, {
        baselineJson: undefined,
        evaluationJson: undefined,
        artifactStatus: undefined,
        artifactExpiresAt: undefined,
        artifactHash: undefined,
      });
    }
    if (runs.length === 50)
      await ctx.scheduler.runAfter(
        0,
        internal.elizaPilotValidationData.cleanupArtifacts,
        {},
      );
    return runs.length;
  },
});

/** Read only one public, active opening thread. No queue claim or forum writes. */
export const readPublicThread = internalQuery({
  args: { threadId: v.id("forumThreads") },
  returns: v.union(
    v.null(),
    v.object({
      authorName: v.string(),
      authorIsAgent: v.boolean(),
      categoryName: v.string(),
      categorySlug: v.string(),
      recentPosts: v.array(
        v.object({
          authorName: v.string(),
          body: v.string(),
          postNumber: v.number(),
        }),
      ),
      sourceBody: v.string(),
      sourceKind: v.literal("thread"),
      sourcePostNumber: v.number(),
      threadBody: v.string(),
      threadTitle: v.string(),
    }),
  ),
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get("forumThreads", threadId);
    if (!thread || thread.status !== "active") return null;
    let categoryId = thread.categoryId;
    let categoryName = "";
    let categorySlug = "";
    let reachedRoot = false;
    for (let depth = 0; depth < MAX_CATEGORY_ANCESTORS; depth++) {
      const category = await ctx.db.get("forumCategories", categoryId);
      if (
        !category ||
        category.status !== "active" ||
        category.viewAccess !== "public"
      )
        return null;
      if (depth === 0) {
        if ((category.kind ?? "board") !== "board") return null;
        categoryName = category.name;
        categorySlug = category.slug;
      }
      if (!category.parentCategoryId) {
        reachedRoot = true;
        break;
      }
      categoryId = category.parentCategoryId;
    }
    if (!reachedRoot) return null;
    const author = await ctx.db.get("users", thread.authorId);
    if (!author || (author.isAgent && author.agentSlug === "suki")) return null;
    const recent = await ctx.db
      .query("forumPosts")
      .withIndex("by_threadId_and_status_and_createdAt", (q) =>
        q.eq("threadId", threadId).eq("status", "active"),
      )
      .order("desc")
      .take(6);
    return {
      authorName: author.isAgent ? "AI participant" : "Member",
      authorIsAgent: author.isAgent === true,
      categoryName: categoryName.slice(0, 160),
      categorySlug: categorySlug.slice(0, 160),
      recentPosts: recent.reverse().map((post, index) => ({
        authorName: `Participant ${index + 1}`,
        body: post.body.slice(0, 1_500),
        postNumber: post.postNumber ?? 2,
      })),
      sourceBody: thread.body.slice(0, 3_000),
      sourceKind: "thread" as const,
      sourcePostNumber: 1,
      threadBody: thread.body.slice(0, 4_000),
      threadTitle: thread.title.slice(0, 500),
    };
  },
});

/** Internal-only inspection of one pilot's private baseline and comparison. */
export const inspectSelected = internalQuery({
  args: { nonce: v.string(), jobId: v.id("elizaShadowJobs") },
  returns: v.union(
    v.null(),
    v.object({
      run: summary,
      baselineJson: v.string(),
      outputJson: v.optional(v.string()),
      comparisonJson: v.optional(v.string()),
      evaluationJson: v.string(),
      errorCode: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { nonce, jobId }) => {
    const run = await ctx.db
      .query("elizaPilotRuns")
      .withIndex("by_nonce", (q) => q.eq("nonce", nonce))
      .unique();
    if (!run || run.shadowJobId !== jobId) return null;
    const job = await ctx.db.get("elizaShadowJobs", jobId);
    if (!job) return null;
    return {
      run: toSummary(run),
      baselineJson: job.baselineJson,
      outputJson: job.outputJson,
      comparisonJson: job.comparisonJson,
      evaluationJson: job.evaluationJson,
      errorCode: job.errorCode,
    };
  },
});

function toSummary(run: {
  nonce: string;
  kind: "suki-reply" | "belle-newsletter";
  sourceKey: string;
  status: "reserved" | "completed" | "blocked" | "failed";
  sourceHash?: string;
  sourceCount?: number;
  shadowJobId?: import("./_generated/dataModel").Id<"elizaShadowJobs">;
  shadowStatus?: string;
  baselineDecision?: string;
  errorCode?: string;
}) {
  return {
    nonce: run.nonce,
    kind: run.kind,
    sourceKey: run.sourceKey,
    status: run.status,
    sourceHash: run.sourceHash,
    sourceCount: run.sourceCount,
    shadowJobId: run.shadowJobId,
    shadowStatus: run.shadowStatus,
    baselineDecision: run.baselineDecision,
    errorCode: run.errorCode,
  };
}
