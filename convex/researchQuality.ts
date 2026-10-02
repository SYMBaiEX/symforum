import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getCurrentUser, hasSiteAdminAccess, requireSiteAdmin } from "./authz";
import { evaluateAgentPublicationHygiene } from "../lib/agent-publication-quality";
import {
  FORUM_AGENT_FEEDBACK_MIN_SAMPLE,
  forumAgentEditorialCohortKey,
  forumAgentModerationOutcomeScore,
} from "./forumAgentEditorialPolicy";
import {
  deleteResearchQualityAssessmentVisibilityDigest,
  upsertResearchQualityAssessmentVisibilityDigest,
} from "./researchQualityAssessmentVisibilityDigest";

const MAX_QUEUE_RESULTS = 100;
const MAX_COMPARISON_CANDIDATES = 80;
const MAX_TERMS = 64;
const MAX_FLAGS = 12;
const MIN_APPROVAL_REASON_LENGTH = 8;
const MIN_OVERRIDE_REASON_LENGTH = 20;
const MIN_CITATION_COVERAGE = 50;
const AI_DISCLOSURE =
  /\b(ai[- ](?:assisted|generated)|written by (?:an )?ai|agent[- ]generated|automated (?:research|analysis))\b/i;
const HTTP_URL = /https?:\/\/[^\s\]>)"']+/gi;
const WORD = /[a-z0-9][a-z0-9-]{2,}/gi;
const QUALITY_GATE_PREFIX = "RESEARCH_QUALITY_BLOCKED:";
const QUALITY_SCHEMA_VERSION = "research-publication-v2";
const MAX_CATEGORY_ANCESTORS = 16;

const enqueueEvidenceSyncRef = makeFunctionReference<
  "mutation",
  {
    threadId: Id<"forumThreads">;
    reason:
      | "published"
      | "content_changed"
      | "visibility_changed"
      | "category_changed"
      | "quality_changed"
      | "reconciliation";
  },
  { generation: number }
>("evidenceFirstParty:enqueueForumResearchThread");

const assessmentStatusValidator = v.union(
  v.literal("passed"),
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

function boundedText(
  value: string,
  field: string,
  minimum: number,
  maximum: number,
) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    qualityError(
      "INVALID_QUALITY_INPUT",
      `${field} must be ${minimum}-${maximum} printable characters.`,
    );
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
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
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

function sourceDomains(body: string, suppliedUrls: string[] = []) {
  const domains = new Set<string>();
  const urls = [...body.matchAll(HTTP_URL)]
    .map((match) => match[0])
    .concat(suppliedUrls);
  for (const value of urls) {
    try {
      domains.add(new URL(value).hostname.toLowerCase());
    } catch {
      // The regular expression is deliberately permissive; invalid URLs are
      // simply not evidence and cannot improve a score.
    }
  }
  return domains;
}

function claimEstimate(body: string) {
  const sentences = body
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return Math.min(
    100,
    sentences.filter((sentence) => /[a-z0-9]/i.test(sentence)).length,
  );
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
    duplicateOfThreadId:
      mostSimilar !== null && highestSimilarity >= 0.82
        ? mostSimilar.threadId
        : undefined,
    originalityScore: Math.max(0, Math.round((1 - highestSimilarity) * 100)),
  };
}

async function requireHumanSiteAdmin(ctx: Ctx) {
  const actor = await requireSiteAdmin(ctx);
  if (actor.isAgent === true) {
    qualityError(
      "HUMAN_REVIEW_REQUIRED",
      "An enrolled agent cannot review or override research quality.",
    );
  }
  return actor;
}

async function requireHumanModerator(ctx: Ctx) {
  const actor = await getCurrentUser(ctx);
  if (
    actor === null ||
    actor.isAgent === true ||
    (!hasSiteAdminAccess(actor) &&
      actor.forumRole !== "moderator" &&
      actor.forumRole !== "admin")
  ) {
    qualityError(
      "FORUM_MODERATOR_REQUIRED",
      "A human forum moderator is required.",
    );
  }
  return actor;
}

async function publishedCandidates(
  ctx: MutationCtx,
  categoryId: Id<"forumCategories">,
  threadId?: Id<"forumThreads">,
) {
  const [passed, approved, overridden] = await Promise.all([
    ctx.db
      .query("researchQualityAssessments")
      .withIndex("by_categoryId_and_status_and_updatedAt", (q) =>
        q.eq("categoryId", categoryId).eq("status", "passed"),
      )
      .order("desc")
      .take(MAX_COMPARISON_CANDIDATES),
    ctx.db
      .query("researchQualityAssessments")
      .withIndex("by_categoryId_and_status_and_updatedAt", (q) =>
        q.eq("categoryId", categoryId).eq("status", "approved"),
      )
      .order("desc")
      .take(MAX_COMPARISON_CANDIDATES),
    ctx.db
      .query("researchQualityAssessments")
      .withIndex("by_categoryId_and_status_and_updatedAt", (q) =>
        q.eq("categoryId", categoryId).eq("status", "overridden"),
      )
      .order("desc")
      .take(MAX_COMPARISON_CANDIDATES),
  ]);
  return [...passed, ...approved, ...overridden].filter(
    (candidate) => candidate.threadId !== threadId,
  );
}

export type AutomatedResearchCandidate = {
  categoryId: Id<"forumCategories">;
  authorUserId: Id<"users">;
  runKey: string;
  title: string;
  body: string;
  sourceUrls: string[];
  /** Deterministic claim-ledger grounding score from the editorial gate. */
  validatedCitationCoverageScore?: number;
  agentSlug?: string;
  model?: string;
  promptVersion?: string;
  contentFormat?: string;
};

export class ResearchQualityGateError extends Error {
  constructor(flags: string[]) {
    super(`${QUALITY_GATE_PREFIX}${flags.join(",")}`);
    this.name = "ResearchQualityGateError";
  }
}

export function isResearchQualityGateError(error: unknown) {
  return (
    error instanceof ResearchQualityGateError ||
    (error instanceof Error && error.message.includes(QUALITY_GATE_PREFIX))
  );
}

export type AutomatedResearchScore = {
  sourceCount: number;
  uniqueSourceDomainCount: number;
  claimEstimate: number;
  citationCoverageScore: number;
  originalityScore: number;
  qualitySchemaVersion: string;
  agentSlug?: string;
  model?: string;
  promptVersion?: string;
  contentFormat?: string;
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
  lexicalDiversityScore: number;
  structureScore: number;
  naturalnessScore: number;
  sourceDiversityScore: number;
  contentQualityScore: number;
  sourceDomains: string[];
  aiAuthorshipDisclosed: boolean;
  contentFingerprint: string;
  normalizedTerms: string[];
  duplicateOfThreadId?: Id<"forumThreads">;
  flags: string[];
};

async function scoreDraft(
  ctx: MutationCtx,
  candidate: AutomatedResearchCandidate,
): Promise<AutomatedResearchScore> {
  const author = await ctx.db.get("users", candidate.authorUserId);
  const terms = normalizedTerms(candidate.title, candidate.body);
  const domains = sourceDomains(candidate.body, candidate.sourceUrls);
  const claims = claimEstimate(candidate.body);
  // New automated publications reach this gate only after the deterministic
  // claim ledger has checked body coverage and each cited factual token. Use
  // that stronger signal when present. The legacy domain heuristic remains a
  // fail-closed fallback for manual evaluations and older callers.
  const expectedSources = Math.max(1, Math.ceil(claims / 4));
  const legacyCoverage = Math.min(
    100,
    Math.round((domains.size / expectedSources) * 100),
  );
  const coverage =
    candidate.validatedCitationCoverageScore === undefined
      ? legacyCoverage
      : Math.max(
          0,
          Math.min(100, Math.round(candidate.validatedCitationCoverageScore)),
        );
  const candidates = await publishedCandidates(ctx, candidate.categoryId);
  const originality = scoreOriginality(terms, candidates);
  const plainBody = candidate.body
    .replace(/\[code(?:=[^\]]*)?\][\s\S]*?\[\/code\]/gi, " code sample ")
    .replace(/\[(?:\/?)[a-z0-9*]+(?:=[^\]]*)?\]/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = plainBody.match(/[a-z0-9][a-z0-9'’-]*/gi) ?? [];
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));
  const sentences = plainBody
    .split(/[.!?]+/)
    .filter((sentence) => sentence.trim().length > 0);
  const paragraphs = candidate.body
    .split(/\n\s*\n/)
    .filter((paragraph) => paragraph.trim().length > 0);
  const lexicalRatio = words.length === 0 ? 0 : uniqueWords.size / words.length;
  const lexicalDiversityScore = Math.round(
    Math.max(0, Math.min(100, ((lexicalRatio - 0.25) / 0.35) * 100)),
  );
  const structureSignals = [
    /\[h[23]\]/i.test(candidate.body),
    /\[(?:chart|table|timeline|decision|riskmap|steps|sourcecards)(?:=|\])/i.test(
      candidate.body,
    ),
    /\[list(?:=|\])/i.test(candidate.body),
    paragraphs.length >= 4,
    sentences.length >= 6,
  ];
  const structureScore = Math.round(
    (structureSignals.filter(Boolean).length / structureSignals.length) * 100,
  );
  const hygiene = evaluateAgentPublicationHygiene([
    candidate.title,
    candidate.body,
  ]);
  const sourceDiversityScore = Math.min(100, domains.size * 34);
  const contentQualityScore = Math.round(
    coverage * 0.3 +
      originality.originalityScore * 0.2 +
      hygiene.naturalnessScore * 0.15 +
      structureScore * 0.15 +
      sourceDiversityScore * 0.1 +
      lexicalDiversityScore * 0.1,
  );
  const disclosed =
    author?.isAgent !== true ||
    AI_DISCLOSURE.test(`${candidate.title}\n${candidate.body}`);
  const flags: string[] = [];
  if (domains.size === 0) flags.push("missing_sources");
  if (coverage < MIN_CITATION_COVERAGE)
    flags.push("insufficient_citation_coverage");
  if (originality.duplicateOfThreadId !== undefined)
    flags.push("near_duplicate");
  if (!disclosed) flags.push("missing_ai_authorship_disclosure");
  if (terms.length < 8) flags.push("insufficient_substance");
  for (const issue of hygiene.issues.filter((issue) => issue.blocking)) {
    flags.push(`publication_${issue.code}`);
  }
  return {
    sourceCount: domains.size,
    uniqueSourceDomainCount: domains.size,
    claimEstimate: claims,
    citationCoverageScore: coverage,
    originalityScore: originality.originalityScore,
    qualitySchemaVersion: QUALITY_SCHEMA_VERSION,
    agentSlug: candidate.agentSlug,
    model: candidate.model,
    promptVersion: candidate.promptVersion,
    contentFormat: candidate.contentFormat,
    wordCount: words.length,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
    lexicalDiversityScore,
    structureScore,
    naturalnessScore: hygiene.naturalnessScore,
    sourceDiversityScore,
    contentQualityScore,
    sourceDomains: [...domains].sort().slice(0, 12),
    aiAuthorshipDisclosed: disclosed,
    contentFingerprint: contentFingerprint(
      `${candidate.title}\n${candidate.body}`,
    ),
    normalizedTerms: terms,
    duplicateOfThreadId: originality.duplicateOfThreadId,
    flags: flags.slice(0, MAX_FLAGS),
  };
}

async function upsertAssessment(
  ctx: MutationCtx,
  candidate: AutomatedResearchCandidate,
  score: AutomatedResearchScore,
  status: Assessment["status"],
  threadId?: Id<"forumThreads">,
) {
  const now = Date.now();
  const current =
    threadId === undefined
      ? await ctx.db
          .query("researchQualityAssessments")
          .withIndex("by_runKey", (q) => q.eq("runKey", candidate.runKey))
          .unique()
      : await ctx.db
          .query("researchQualityAssessments")
          .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
          .unique();
  const values = {
    threadId,
    categoryId: candidate.categoryId,
    authorUserId: candidate.authorUserId,
    runKey: candidate.runKey,
    candidateTitle: candidate.title.slice(0, 240),
    candidateExcerpt: candidate.body
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1_200),
    status,
    ...score,
    evaluatedAt: now,
    updatedAt: now,
  };
  const assessmentId =
    current === null
      ? await ctx.db.insert("researchQualityAssessments", {
          ...values,
          createdAt: now,
        })
      : (await ctx.db.patch("researchQualityAssessments", current._id, values),
        current._id);
  if (threadId === undefined && current?.threadId !== undefined) {
    await deleteResearchQualityAssessmentVisibilityDigest(ctx, assessmentId);
  } else {
    await upsertResearchQualityAssessmentVisibilityDigest(ctx, {
      _id: assessmentId,
      threadId,
      authorUserId: candidate.authorUserId,
      status,
    });
  }
  return assessmentId;
}

/**
 * The only automatic-publication gate. It persists a bounded, private review
 * record before throwing, so a blocked AI draft never receives a public
 * forumThread id and still reaches the human review queue.
 */
export async function requireAutomatedResearchPublication(
  ctx: MutationCtx,
  candidate: AutomatedResearchCandidate,
) {
  const score = await scoreDraft(ctx, candidate);
  if (score.flags.length > 0) {
    const assessmentId = await upsertAssessment(
      ctx,
      candidate,
      score,
      "needs_review",
    );
    return { allowed: false as const, assessmentId, flags: score.flags };
  }
  return { allowed: true as const, score };
}

/** Persist the deterministic pass only after the new public thread exists. */
export async function recordAutomatedResearchPublication(
  ctx: MutationCtx,
  candidate: AutomatedResearchCandidate,
  score: AutomatedResearchScore,
  threadId: Id<"forumThreads">,
) {
  const assessmentId = await upsertAssessment(
    ctx,
    candidate,
    score,
    "passed",
    threadId,
  );
  await ctx.runMutation(enqueueEvidenceSyncRef, {
    threadId,
    reason: "published",
  });
  return assessmentId;
}

/** Any edit makes an earlier automated pass stale until a new assessment. */
export async function invalidateResearchQualityForThread(
  ctx: MutationCtx,
  threadId: Id<"forumThreads">,
) {
  const assessment = await ctx.db
    .query("researchQualityAssessments")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
  if (assessment === null || assessment.status === "rejected") {
    // Legacy published evidence can outlive its assessment. Content edits must
    // still invalidate its artifacts and enqueue retraction in this transaction.
    // Ordinary human threads have no evidence and should not start sync actions.
    const source = await ctx.db
      .query("evidenceSources")
      .withIndex("by_sourceKey", (q) =>
        q.eq("sourceKey", "symbaiex-first-party-research"),
      )
      .unique();
    if (source === null) return;
    const document = await ctx.db
      .query("evidenceDocuments")
      .withIndex("by_sourceId_and_externalKey", (q) =>
        q
          .eq("sourceId", source._id)
          .eq("externalKey", `forum-research:${threadId}`),
      )
      .unique();
    if (document?.visibility !== "public") return;
    await ctx.runMutation(enqueueEvidenceSyncRef, {
      threadId,
      reason: "content_changed",
    });
    return;
  }
  const flags = [
    ...new Set([...assessment.flags, "content_changed_requires_reassessment"]),
  ].slice(0, MAX_FLAGS);
  await ctx.db.patch("researchQualityAssessments", assessment._id, {
    status: "needs_review",
    flags,
    updatedAt: Date.now(),
  });
  await upsertResearchQualityAssessmentVisibilityDigest(ctx, {
    ...assessment,
    status: "needs_review",
  });
  await ctx.runMutation(enqueueEvidenceSyncRef, {
    threadId,
    reason: "quality_changed",
  });
}

export const evaluateThread = mutation({
  args: { threadId: v.id("forumThreads") },
  handler: async (ctx, args) => {
    await requireHumanSiteAdmin(ctx);
    const thread = await ctx.db.get("forumThreads", args.threadId);
    if (thread === null)
      qualityError("THREAD_NOT_FOUND", "Thread was not found.");
    const score = await scoreDraft(ctx, {
      categoryId: thread.categoryId,
      authorUserId: thread.authorId,
      runKey: `manual:${thread._id}`,
      title: thread.title,
      body: thread.body,
      sourceUrls: [],
    });
    const current = await ctx.db
      .query("researchQualityAssessments")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .unique();
    if (current !== null) {
      await deleteResearchQualityAssessmentVisibilityDigest(ctx, current._id);
      await ctx.db.delete("researchQualityAssessments", current._id);
    }
    const assessmentId = await upsertAssessment(
      ctx,
      {
        categoryId: thread.categoryId,
        authorUserId: thread.authorId,
        runKey: `manual:${thread._id}`,
        title: thread.title,
        body: thread.body,
        sourceUrls: [],
      },
      score,
      "needs_review",
      thread._id,
    );
    await ctx.runMutation(enqueueEvidenceSyncRef, {
      threadId: thread._id,
      reason: "quality_changed",
    });
    return {
      assessmentId,
      status: "needs_review" as const,
      blocking: score.flags.length > 0,
      flags: score.flags,
    };
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
    const assessment = await ctx.db.get(
      "researchQualityAssessments",
      args.assessmentId,
    );
    if (assessment === null)
      qualityError("ASSESSMENT_NOT_FOUND", "Quality assessment was not found.");
    if (assessment.status !== "needs_review")
      qualityError(
        "ASSESSMENT_ALREADY_REVIEWED",
        "This assessment has already been reviewed. Re-evaluate the draft first.",
      );
    const reason = boundedText(
      args.reason,
      "reason",
      args.decision === "overridden"
        ? MIN_OVERRIDE_REASON_LENGTH
        : MIN_APPROVAL_REASON_LENGTH,
      1_000,
    );
    if (args.decision === "approved" && assessment.flags.length > 0) {
      qualityError(
        "BLOCKING_QUALITY_FINDING",
        "Drafts with quality findings require rejection or an explicit override.",
      );
    }
    const now = Date.now();
    await ctx.db.patch("researchQualityAssessments", assessment._id, {
      status: args.decision,
      updatedAt: now,
    });
    await upsertResearchQualityAssessmentVisibilityDigest(ctx, {
      ...assessment,
      status: args.decision,
    });
    await ctx.db.insert("researchQualityReviews", {
      assessmentId: assessment._id,
      threadId: assessment.threadId,
      reviewerUserId: reviewer._id,
      decision: args.decision,
      reason,
      createdAt: now,
    });
    if (assessment.threadId !== undefined)
      await ctx.runMutation(enqueueEvidenceSyncRef, {
        threadId: assessment.threadId,
        reason: "quality_changed",
      });
    return { assessmentId: assessment._id, status: args.decision };
  },
});

export const publicationStatus = query({
  args: { threadId: v.id("forumThreads") },
  handler: async (ctx, args) => {
    const assessment = await ctx.db
      .query("researchQualityAssessments")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
    return {
      canPublish:
        assessment?.status === "passed" ||
        assessment?.status === "approved" ||
        assessment?.status === "overridden",
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
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAX_QUEUE_RESULTS
    ) {
      qualityError(
        "INVALID_QUEUE_LIMIT",
        `limit must be 1-${MAX_QUEUE_RESULTS}.`,
      );
    }
    const assessments = await ctx.db
      .query("researchQualityAssessments")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", "needs_review"),
      )
      .order("desc")
      .take(limit);
    return await Promise.all(
      assessments.map(async (assessment) => {
        const thread =
          assessment.threadId === undefined
            ? null
            : await ctx.db.get("forumThreads", assessment.threadId);
        return {
          assessment,
          thread:
            thread === null
              ? null
              : {
                  _id: thread._id,
                  title: thread.title,
                  slug: thread.slug,
                  categorySlug: thread.categorySlug,
                  status: thread.status,
                },
        };
      }),
    );
  },
});

// A bounded operational benchmark, not a leaderboard or model evaluation.
// It makes review quality observable without scanning the whole corpus.
export const benchmarkSummary = query({
  args: {},
  handler: async (ctx) => {
    await requireHumanSiteAdmin(ctx);
    const statuses: Assessment["status"][] = [
      "passed",
      "needs_review",
      "approved",
      "rejected",
      "overridden",
    ];
    const samples = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("researchQualityAssessments")
          .withIndex("by_status_and_updatedAt", (q) => q.eq("status", status))
          .order("desc")
          .take(MAX_QUEUE_RESULTS),
      ),
    );
    const assessments = samples.flat();
    const moderationAggregates = await ctx.db
      .query("forumAgentModerationOutcomeAggregates")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(MAX_QUEUE_RESULTS);
    const count = assessments.length;
    const average = (selector: (assessment: Assessment) => number) =>
      count === 0
        ? 0
        : Math.round(
            assessments.reduce(
              (total, assessment) => total + selector(assessment),
              0,
            ) / count,
          );
    return {
      sampleSize: count,
      sampledPerStatusCap: MAX_QUEUE_RESULTS,
      statusCounts: Object.fromEntries(
        statuses.map((status, index) => [status, samples[index]?.length ?? 0]),
      ),
      citationCoverageAverage: average(
        (assessment) => assessment.citationCoverageScore,
      ),
      originalityAverage: average((assessment) => assessment.originalityScore),
      contentQualityAverage: average(
        (assessment) => assessment.contentQualityScore ?? 0,
      ),
      naturalnessAverage: average(
        (assessment) => assessment.naturalnessScore ?? 0,
      ),
      structureAverage: average((assessment) => assessment.structureScore ?? 0),
      sourceDiversityAverage: average(
        (assessment) => assessment.sourceDiversityScore ?? 0,
      ),
      agentDisclosureRate:
        count === 0
          ? 0
          : Math.round(
              (assessments.filter(
                (assessment) => assessment.aiAuthorshipDisclosed,
              ).length /
                count) *
                100,
            ),
      // These human moderation outcomes are operational observability only.
      // Raw views, replies, and votes are deliberately excluded so agents
      // cannot improve their editorial standing by optimizing engagement.
      moderationCohortCount: moderationAggregates.length,
      moderationEligibleCohortCount: moderationAggregates.filter(
        (aggregate) =>
          aggregate.sampleCount >= aggregate.minimumSampleSize &&
          aggregate.score !== undefined,
      ).length,
      moderationFeedbackSampleSize: moderationAggregates.reduce(
        (total, aggregate) => total + aggregate.sampleCount,
        0,
      ),
      moderationHelpfulRate: (() => {
        const sampleSize = moderationAggregates.reduce(
          (total, aggregate) => total + aggregate.sampleCount,
          0,
        );
        if (sampleSize === 0) return 0;
        return Math.round(
          (moderationAggregates.reduce(
            (total, aggregate) => total + aggregate.helpfulCount,
            0,
          ) /
            sampleSize) *
            100,
        );
      })(),
    };
  },
});

/** Bounded bridge from approved forum research into first-party evidence. */
export const publishedResearchEvidenceValidator = v.object({
  threadId: v.id("forumThreads"),
  categorySlug: v.string(),
  slug: v.string(),
  title: v.string(),
  body: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  authorName: v.string(),
  agentSlug: v.string(),
  model: v.optional(v.string()),
  promptVersion: v.optional(v.string()),
  contentFormat: v.optional(v.string()),
  qualitySchemaVersion: v.optional(v.string()),
  contentQualityScore: v.optional(v.number()),
  citationCoverageScore: v.number(),
  originalityScore: v.number(),
  naturalnessScore: v.optional(v.number()),
  structureScore: v.optional(v.number()),
  sourceDiversityScore: v.optional(v.number()),
  sourceDomains: v.array(v.string()),
  sourceUrls: v.array(v.string()),
  claims: v.array(
    v.object({
      claimIndex: v.number(),
      claimText: v.string(),
      claimHash: v.string(),
      bodySpanText: v.optional(v.string()),
      sourceUrl: v.string(),
      snapshotHash: v.string(),
      supportStatus: v.union(
        v.literal("supported"),
        v.literal("partial"),
        v.literal("unsupported"),
      ),
      supportScore: v.number(),
    }),
  ),
});

const researchRetractionReasonValidator = v.union(
  v.literal("not_approved"),
  v.literal("thread_unavailable"),
  v.literal("category_not_public"),
  v.literal("author_unavailable"),
);

export const publishedResearchSyncDecisionValidator = v.union(
  v.object({
    state: v.literal("publish"),
    research: publishedResearchEvidenceValidator,
  }),
  v.object({
    state: v.literal("retract"),
    threadId: v.id("forumThreads"),
    reason: researchRetractionReasonValidator,
  }),
);

async function explicitlyPublicBoard(
  ctx: QueryCtx,
  categoryId: Id<"forumCategories">,
) {
  let category = await ctx.db.get("forumCategories", categoryId);
  if (category === null || (category.kind ?? "board") !== "board") return null;
  const requested = category;
  const visited = new Set<Id<"forumCategories">>();
  for (let depth = 0; depth < MAX_CATEGORY_ANCESTORS; depth += 1) {
    if (
      category === null ||
      category.status !== "active" ||
      (category.viewAccess ?? "public") !== "public" ||
      visited.has(category._id)
    )
      return null;
    visited.add(category._id);
    if (category.parentCategoryId === undefined) return requested;
    category = await ctx.db.get("forumCategories", category.parentCategoryId);
  }
  return null;
}

async function researchSyncDecision(
  ctx: QueryCtx,
  threadId: Id<"forumThreads">,
): Promise<
  | {
      state: "publish";
      research: typeof publishedResearchEvidenceValidator.type;
    }
  | {
      state: "retract";
      threadId: Id<"forumThreads">;
      reason:
        | "not_approved"
        | "thread_unavailable"
        | "category_not_public"
        | "author_unavailable";
    }
> {
  const assessment = await ctx.db
    .query("researchQualityAssessments")
    .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
    .unique();
  if (
    assessment === null ||
    !["passed", "approved", "overridden"].includes(assessment.status)
  )
    return { state: "retract", threadId, reason: "not_approved" };

  const thread = await ctx.db.get("forumThreads", threadId);
  if (
    thread === null ||
    (thread.status !== "active" && thread.status !== "locked")
  )
    return { state: "retract", threadId, reason: "thread_unavailable" };
  const category = await explicitlyPublicBoard(ctx, thread.categoryId);
  if (category === null)
    return { state: "retract", threadId, reason: "category_not_public" };
  const author = await ctx.db.get("users", assessment.authorUserId);
  if (author?.isAgent !== true || !author.agentSlug)
    return { state: "retract", threadId, reason: "author_unavailable" };

  const [sourceUses, claims] = await Promise.all([
    ctx.db
      .query("forumAgentSourceUses")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .take(12),
    ctx.db
      .query("forumAgentClaimCitations")
      .withIndex("by_threadId_and_claimIndex", (q) =>
        q.eq("threadId", threadId),
      )
      .take(12),
  ]);
  return {
    state: "publish",
    research: {
      threadId,
      categorySlug: category.slug,
      slug: thread.slug,
      title: thread.title,
      body: thread.body,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      authorName: author.username ?? author.name ?? author.agentSlug,
      agentSlug: author.agentSlug,
      model: assessment.model,
      promptVersion: assessment.promptVersion,
      contentFormat: assessment.contentFormat,
      qualitySchemaVersion: assessment.qualitySchemaVersion,
      contentQualityScore: assessment.contentQualityScore,
      citationCoverageScore: assessment.citationCoverageScore,
      originalityScore: assessment.originalityScore,
      naturalnessScore: assessment.naturalnessScore,
      structureScore: assessment.structureScore,
      sourceDiversityScore: assessment.sourceDiversityScore,
      sourceDomains: assessment.sourceDomains ?? [],
      sourceUrls: sourceUses.map((source) => source.sourceUrl),
      claims: claims.map((claim) => ({
        claimIndex: claim.claimIndex,
        claimText: claim.claimText,
        claimHash: claim.claimHash,
        bodySpanText: claim.bodySpanText,
        sourceUrl: claim.sourceUrl,
        snapshotHash: claim.snapshotHash,
        supportStatus: claim.supportStatus,
        supportScore: claim.supportScore,
      })),
    },
  };
}

/** One dirty thread at a time; private ancestors fail closed before body reads. */
export const readResearchForEvidenceSync = internalQuery({
  args: { threadId: v.id("forumThreads") },
  returns: publishedResearchSyncDecisionValidator,
  handler: async (ctx, args) => await researchSyncDecision(ctx, args.threadId),
});

/** Compatibility bridge for bounded operator diagnostics, not the cron path. */
export const listPublishedResearchForEvidenceSync = internalQuery({
  args: { limit: v.optional(v.number()) },
  returns: v.array(publishedResearchEvidenceValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 100)));
    const statuses: Assessment["status"][] = [
      "passed",
      "approved",
      "overridden",
    ];
    const samples = await Promise.all(
      statuses.map((status) =>
        ctx.db
          .query("researchQualityAssessments")
          .withIndex("by_status_and_updatedAt", (q) => q.eq("status", status))
          .order("desc")
          .take(limit),
      ),
    );
    const assessments = [...samples.flat()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .filter(
        (assessment, index, all) =>
          assessment.threadId !== undefined &&
          all.findIndex(
            (candidate) => candidate.threadId === assessment.threadId,
          ) === index,
      )
      .slice(0, limit);
    const results: Array<typeof publishedResearchEvidenceValidator.type> = [];
    for (const assessment of assessments) {
      const threadId = assessment.threadId!;
      const decision = await researchSyncDecision(ctx, threadId);
      if (decision.state === "publish") results.push(decision.research);
    }
    return results;
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
    if (thread === null)
      qualityError("THREAD_NOT_FOUND", "Thread was not found.");
    const previousFeedback = await ctx.db
      .query("researchQualityModerationFeedback")
      .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
      .first();
    if (previousFeedback !== null) {
      qualityError(
        "MODERATION_FEEDBACK_ALREADY_RECORDED",
        "A moderation outcome has already been recorded for this publication.",
      );
    }
    let assessment =
      args.assessmentId === undefined
        ? await ctx.db
            .query("researchQualityAssessments")
            .withIndex("by_threadId", (q) => q.eq("threadId", thread._id))
            .unique()
        : await ctx.db.get("researchQualityAssessments", args.assessmentId);
    if (args.assessmentId !== undefined) {
      if (assessment === null || assessment.threadId !== thread._id)
        qualityError(
          "ASSESSMENT_THREAD_MISMATCH",
          "Assessment does not belong to this thread.",
        );
    }
    const run = await ctx.db
      .query("forumAgentRuns")
      .withIndex("by_threadId_and_startedAt", (q) =>
        q.eq("threadId", thread._id),
      )
      .order("desc")
      .first();
    const runKey = run?.runKey ?? assessment?.runKey;
    const agentSlug = run?.agentSlug ?? assessment?.agentSlug;
    const promptVersion = run?.promptVersion ?? assessment?.promptVersion;
    const contentFormat = run?.contentFormat ?? assessment?.contentFormat;
    const citations =
      runKey === undefined
        ? []
        : await ctx.db
            .query("forumAgentClaimCitations")
            .withIndex("by_runKey_and_claimIndex", (q) =>
              q.eq("runKey", runKey),
            )
            .take(12);
    const eligibleForAggregate =
      run?.status === "published" &&
      runKey !== undefined &&
      agentSlug !== undefined &&
      promptVersion !== undefined &&
      contentFormat !== undefined &&
      citations.length >= 2 &&
      citations.length <= 12;
    const cohortKey = eligibleForAggregate
      ? forumAgentEditorialCohortKey({
          agentSlug,
          categorySlug: thread.categorySlug,
          contentFormat,
          promptVersion,
        })
      : undefined;
    const note = boundedText(args.note, "note", 4, 1_000);
    const now = Date.now();
    const feedbackId = await ctx.db.insert(
      "researchQualityModerationFeedback",
      {
        threadId: thread._id,
        assessmentId: assessment?._id,
        moderatorUserId: moderator._id,
        runKey,
        agentSlug,
        promptVersion,
        contentFormat,
        cohortKey,
        citationIds: citations.map((citation) => citation._id),
        eligibleForAggregate,
        outcome: args.outcome,
        note,
        createdAt: now,
      },
    );
    if (eligibleForAggregate && cohortKey !== undefined) {
      const current = await ctx.db
        .query("forumAgentModerationOutcomeAggregates")
        .withIndex("by_cohortKey", (q) => q.eq("cohortKey", cohortKey))
        .unique();
      const counts = {
        sampleCount: (current?.sampleCount ?? 0) + 1,
        helpfulCount:
          (current?.helpfulCount ?? 0) + (args.outcome === "helpful" ? 1 : 0),
        sourceIssueCount:
          (current?.sourceIssueCount ?? 0) +
          (args.outcome === "source_issue" ? 1 : 0),
        duplicateConfirmedCount:
          (current?.duplicateConfirmedCount ?? 0) +
          (args.outcome === "duplicate_confirmed" ? 1 : 0),
        disclosureIssueCount:
          (current?.disclosureIssueCount ?? 0) +
          (args.outcome === "disclosure_issue" ? 1 : 0),
      };
      const aggregate = {
        cohortKey,
        agentSlug,
        categorySlug: thread.categorySlug,
        contentFormat,
        promptVersion,
        ...counts,
        minimumSampleSize: FORUM_AGENT_FEEDBACK_MIN_SAMPLE,
        score: forumAgentModerationOutcomeScore(counts),
        updatedAt: now,
      };
      if (current === null) {
        await ctx.db.insert("forumAgentModerationOutcomeAggregates", aggregate);
      } else {
        await ctx.db.patch(
          "forumAgentModerationOutcomeAggregates",
          current._id,
          aggregate,
        );
      }
    }
    return { feedbackId, eligibleForAggregate };
  },
});
