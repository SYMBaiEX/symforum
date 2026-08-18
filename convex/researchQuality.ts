import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getCurrentUser, hasSiteAdminAccess, requireSiteAdmin } from "./authz";

const MAX_QUEUE_RESULTS = 100;
const MAX_COMPARISON_CANDIDATES = 80;
const MAX_TERMS = 64;
const MAX_FLAGS = 12;
const MIN_APPROVAL_REASON_LENGTH = 8;
const MIN_OVERRIDE_REASON_LENGTH = 20;
const MIN_CITATION_COVERAGE = 50;
const AI_DISCLOSURE = /\b(ai[- ](?:assisted|generated)|written by (?:an )?ai|agent[- ]generated|automated (?:research|analysis))\b/i;
const HTTP_URL = /https?:\/\/[^\s\]>)"']+/gi;
const WORD = /[a-z0-9][a-z0-9-]{2,}/gi;

const assessmentStatusValidator = v.union(
  v.literal("needs_review"),
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("overridden"),
);
const reviewDecisionValidator = v.union(
  v.literal("approved"),
  v.literal("rejected"),
  v.literal("overridden"),
);
const feedbackOutcomeValidator = v.union(
  v.literal("source_issue"),
  v.literal("duplicate_confirmed"),
  v.literal("disclosure_issue"),
  v.literal("helpful"),
);

type Ctx = QueryCtx | MutationCtx;
type Assessment = Doc<"researchQualityAssessments">;

function qualityError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

function boundedText(value: string, field: string, minimum: number, maximum: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < minimum || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    qualityError("INVALID_QUALITY_INPUT", `${field} must be ${minimum}-${maximum} printable characters.`);
  }
  return normalized;
}

function normalizedTerms(title: string, body: string) {
  const counts = new Map<string, number>();
  for (const match of `${title} ${body}`.toLowerCase().matchAll(WORD)) {
    const term = match[0];
    if (term.length < 3) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_TERMS)
    .map(([term]) => term);
}

// This is a deterministic change detector, not a cryptographic digest. It is
// stored only to detect exact resubmissions; near duplicates use token overlap.
function contentFingerprint(value: string) {
  let hash = 2166136261;
  for (const character of value.toLowerCase().replace(/\s+/g, " ").trim()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function sourceDomains(body: string) {
  const domains = new Set<string>();
  for (const match of body.matchAll(HTTP_URL)) {
    try {
      domains.add(new URL(match[0]).hostname.toLowerCase());
    } catch {
      // The regular expression is deliberately permissive; invalid URLs are
      // simply not evidence and cannot improve a score.
    }
  }
  return domains;
}

function claimEstimate(body: string) {
  const sentences = body.split(/[.!?]+/).map((sentence) => sentence.trim()).filter(Boolean);
  return Math.min(100, sentences.filter((sentence) => /[a-z0-9]/i.test(sentence)).length);
}

function jaccard(left: string[], right: string[]) {
  const rightSet = new Set(right);
  const shared = left.filter((term) => rightSet.has(term)).length;
  const total = new Set([...left, ...right]).size;
  return total === 0 ? 0 : shared / total;
}

function scoreOriginality(terms: string[], candidates: Assessment[]) {
  let mostSimilar: Assessment | null = null;
  let highestSimilarity = 0;
  for (const candidate of candidates) {
    const similarity = jaccard(terms, candidate.normalizedTerms);
    if (similarity > highestSimilarity) {
      highestSimilarity = similarity;
      mostSimilar = candidate;
    }
  }
  return {
    duplicateOfThreadId: mostSimilar !== null && highestSimilarity >= 0.82 ? mostSimilar.threadId : undefined,
    originalityScore: Math.max(0, Math.round((1 - highestSimilarity) * 100)),
  };
}

async function requireHumanSiteAdmin(ctx: Ctx) {
  const actor = await requireSiteAdmin(ctx);
  if (actor.isAgent === true) {
    qualityError("HUMAN_REVIEW_REQUIRED", "An enrolled agent cannot review or override research quality.");
  }
  return actor;
}

async function requireHumanModerator(ctx: Ctx) {
  const actor = await getCurrentUser(ctx);
  if (
    actor === null ||
    actor.isAgent === true ||
    (!hasSiteAdminAccess(actor) && actor.forumRole !== "moderator" && actor.forumRole !== "admin")
  ) {
    qualityError("FORUM_MODERATOR_REQUIRED", "A human forum moderator is required.");
  }
  return actor;
}

async function publishedCandidates(ctx: MutationCtx, categoryId: Id<"forumCategories">, threadId: Id<"forumThreads">) {
  const [approved, overridden] = await Promise.all([
    ctx.db.query("researchQualityAssessments")
      .withIndex("by_categoryId_and_status_and_updatedAt", (q) => q.eq("categoryId", categoryId).eq("status", "approved"))
      .order("desc").take(MAX_COMPARISON_CANDIDATES),
    ctx.db.query("researchQualityAssessments")
      .withIndex("by_categoryId_and_status_and_updatedAt", (q) => q.eq("categoryId", categoryId).eq("status", "overridden"))
      .order("desc").take(MAX_COMPARISON_CANDIDATES),
  ]);
  return [...approved, ...overridden].filter((candidate) => candidate.threadId !== threadId);
}

export const evaluateThread = mutation({
  args: { threadId: v.id("forumThreads") },
  handler: async (ctx, args) => {
    await requireHumanSiteAdmin(ctx);
    const thread = await ctx.db.get("forumThreads", args.threadId);
    if (thread === null) qualityError("THREAD_NOT_FOUND", "Thread was not found.");
    const author = await ctx.db.get("users", thread.authorId);
    const terms = normalizedTerms(thread.title, thread.body);
    const domains = sourceDomains(thread.body);
    const claims = claimEstimate(thread.body);
    const coverage = Math.min(100, Math.round((domains.size / Math.max(claims, 1)) * 100));
    const candidates = await publishedCandidates(ctx, thread.categoryId, thread._id);
    const originality = scoreOriginality(terms, candidates);
    const flags: string[] = [];
    if (domains.size === 0) flags.push("missing_sources");
    if (coverage < MIN_CITATION_COVERAGE) flags.push("insufficient_citation_coverage");
    if (originality.duplicateOfThreadId !== undefined) flags.push("near_duplicate");
    const disclosed = author?.isAgent !== true || AI_DISCLOSURE.test(`${thread.title}\n${thread.body}`);
    if (!disclosed) flags.push("missing_ai_authorship_disclosure");
    if (terms.length < 8) flags.push("insufficient_substance");
    const now = Date.now();
    const current = await ctx.db.query("researchQualityAssessments")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id)).unique();
    const patch = {
      categoryId: thread.categoryId,
      status: "needs_review" as const,
      sourceCount: domains.size,
      uniqueSourceDomainCount: domains.size,
      claimEstimate: claims,
      citationCoverageScore: coverage,
      originalityScore: originality.originalityScore,
      aiAuthorshipDisclosed: disclosed,
      contentFingerprint: contentFingerprint(`${thread.title}\n${thread.body}`),
      normalizedTerms: terms,
      duplicateOfThreadId: originality.duplicateOfThreadId,
      flags: flags.slice(0, MAX_FLAGS),
      evaluatedAt: now,
      updatedAt: now,
    };
    const assessmentId = current === null
      ? await ctx.db.insert("researchQualityAssessments", { threadId: thread._id, ...patch, createdAt: now })
      : (await ctx.db.patch("researchQualityAssessments", current._id, patch), current._id);
    return { assessmentId, status: "needs_review" as const, blocking: flags.length > 0, flags: patch.flags };
  },
});

export const review = mutation({
  args: {
    assessmentId: v.id("researchQualityAssessments"),
    decision: reviewDecisionValidator,
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const reviewer = await requireHumanSiteAdmin(ctx);
    const assessment = await ctx.db.get("researchQualityAssessments", args.assessmentId);
    if (assessment === null) qualityError("ASSESSMENT_NOT_FOUND", "Quality assessment was not found.");
    if (assessment.status !== "needs_review") qualityError("ASSESSMENT_ALREADY_REVIEWED", "This assessment has already been reviewed. Re-evaluate the draft first.");
    const reason = boundedText(args.reason, "reason", args.decision === "overridden" ? MIN_OVERRIDE_REASON_LENGTH : MIN_APPROVAL_REASON_LENGTH, 1_000);
    if (args.decision === "approved" && assessment.flags.length > 0) {
      qualityError("BLOCKING_QUALITY_FINDING", "Drafts with quality findings require rejection or an explicit override.");
    }
    const now = Date.now();
    await ctx.db.patch("researchQualityAssessments", assessment._id, { status: args.decision, updatedAt: now });
    await ctx.db.insert("researchQualityReviews", {
      assessmentId: assessment._id,
      threadId: assessment.threadId,
      reviewerUserId: reviewer._id,
      decision: args.decision,
      reason,
      createdAt: now,
    });
    return { assessmentId: assessment._id, status: args.decision };
  },
});

export const publicationStatus = query({
  args: { threadId: v.id("forumThreads") },
  handler: async (ctx, args) => {
    const assessment = await ctx.db.query("researchQualityAssessments")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId)).unique();
    return {
      canPublish: assessment?.status === "approved" || assessment?.status === "overridden",
      status: assessment?.status ?? null,
      blocking: assessment === null || assessment.flags.length > 0,
    };
  },
});

export const listReviewQueue = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireHumanSiteAdmin(ctx);
    const limit = args.limit === undefined ? 50 : args.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUEUE_RESULTS) {
      qualityError("INVALID_QUEUE_LIMIT", `limit must be 1-${MAX_QUEUE_RESULTS}.`);
    }
    const assessments = await ctx.db.query("researchQualityAssessments")
      .withIndex("by_status_and_updatedAt", (q) => q.eq("status", "needs_review"))
      .order("desc").take(limit);
    return await Promise.all(assessments.map(async (assessment) => {
      const thread = await ctx.db.get("forumThreads", assessment.threadId);
      return { assessment, thread: thread === null ? null : { _id: thread._id, title: thread.title, slug: thread.slug, categorySlug: thread.categorySlug, status: thread.status } };
    }));
  },
});

// A bounded operational benchmark, not a leaderboard or model evaluation.
// It makes review quality observable without scanning the whole corpus.
export const benchmarkSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireHumanSiteAdmin(ctx);
    const statuses: Assessment["status"][] = ["needs_review", "approved", "rejected", "overridden"];
    const samples = await Promise.all(statuses.map((status) => ctx.db
      .query("researchQualityAssessments")
      .withIndex("by_status_and_updatedAt", (q) => q.eq("status", status))
      .order("desc")
      .take(MAX_QUEUE_RESULTS)));
    const assessments = samples.flat();
    const count = assessments.length;
    const average = (selector: (assessment: Assessment) => number) => count === 0
      ? 0
      : Math.round(assessments.reduce((total, assessment) => total + selector(assessment), 0) / count);
    return {
      sampleSize: count,
      sampledPerStatusCap: MAX_QUEUE_RESULTS,
      statusCounts: Object.fromEntries(statuses.map((status, index) => [status, samples[index]?.length ?? 0])),
      citationCoverageAverage: average((assessment) => assessment.citationCoverageScore),
      originalityAverage: average((assessment) => assessment.originalityScore),
      agentDisclosureRate: count === 0 ? 0 : Math.round((assessments.filter((assessment) => assessment.aiAuthorshipDisclosed).length / count) * 100),
    };
  },
});

export const recordModerationFeedback = mutation({
  args: {
    threadId: v.id("forumThreads"),
    assessmentId: v.optional(v.id("researchQualityAssessments")),
    outcome: feedbackOutcomeValidator,
    note: v.string(),
  },
  handler: async (ctx, args) => {
    const moderator = await requireHumanModerator(ctx);
    const thread = await ctx.db.get("forumThreads", args.threadId);
    if (thread === null) qualityError("THREAD_NOT_FOUND", "Thread was not found.");
    if (args.assessmentId !== undefined) {
      const assessment = await ctx.db.get("researchQualityAssessments", args.assessmentId);
      if (assessment === null || assessment.threadId !== thread._id) qualityError("ASSESSMENT_THREAD_MISMATCH", "Assessment does not belong to this thread.");
    }
    const note = boundedText(args.note, "note", 4, 1_000);
    const feedbackId = await ctx.db.insert("researchQualityModerationFeedback", {
      threadId: thread._id,
      assessmentId: args.assessmentId,
      moderatorUserId: moderator._id,
      outcome: args.outcome,
      note,
      createdAt: Date.now(),
    });
    return { feedbackId };
  },
});
