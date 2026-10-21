"use node";

import { v } from "convex/values";
import { z } from "zod";
import {
  ELIZA_SHADOW_OUTPUT_MAX_BYTES,
  ELIZA_SHADOW_PRIVATE_MAX_BYTES,
  parseShadowInput,
  type ElizaShadowKind,
} from "../lib/eliza-shadow-contract";
import { evaluateAgentPublicationHygiene } from "../lib/agent-publication-quality";
import {
  lexicalSimilarity,
  validateForumAgentMarkup,
} from "../lib/editorial-quality";
import { assessForumReadability } from "../lib/forum-content-quality";
import { internalAction } from "./_generated/server";
import {
  assertAiSourceReplyGrounding,
  sukiReplyDecisionSchema,
  validateForumReplyEvidence,
  validateSukiReplyDecision,
  type SukiReplyDecision,
} from "./sukiForumReplyAgent";
import {
  dailyDraftSchema,
  editorialDraftLimits,
  editorialDraftWordCount,
  generatedDailyDraftSchema,
  generatedWeeklyDraftSchema,
  materializeEditorialChart,
  scoreEditorialPackage,
  validateEditorialDraft,
  weeklyDraftSchema,
} from "./newsletterAgent";

const EVALUATOR_VERSION = "eliza-shadow-deterministic-v2-derived-chart-rows";
const replyContextSchema = z.object({
  candidate: z.object({
    authorName: z.string().max(160),
    authorIsAgent: z.boolean(),
    categoryName: z.string().max(160),
    categorySlug: z.string().max(160),
    recentPosts: z
      .array(
        z.object({
          authorName: z.string().max(160),
          body: z.string().max(1_500),
          postNumber: z.number().int().positive(),
        }),
      )
      .max(6),
    sourceBody: z.string().max(3_000),
    sourceKind: z.enum(["thread", "reply"]),
    sourcePostNumber: z.number().int().positive(),
    threadBody: z.string().max(4_000),
    threadTitle: z.string().max(500),
  }),
  evidence: z
    .array(
      z.object({
        url: z.string().url().max(2_048),
        title: z.string().max(500),
        text: z.string().max(6_000),
      }),
    )
    .max(2),
});
const newsletterContextSchema = z.object({
  edition: z.enum(["daily-signal", "weekly-field-note"]),
  stories: z
    .array(
      z.object({
        hnItemId: z.number().int().positive(),
        title: z.string().max(500).optional(),
        host: z.string().max(500).optional(),
        sourceText: z.string(),
      }),
    )
    .min(1)
    .max(28),
  recent: z.object({
    headlines: z.array(z.string()).max(14),
    theses: z.array(z.string()).max(14),
    storyIds: z.array(z.number().int().positive()).max(112),
  }),
});

type EvaluationArgs = {
  kind: ElizaShadowKind;
  inputJson: string;
  evaluationJson: string;
  baselineJson: string;
  outputJson: string;
};

/** Pure comparison: no model, tool, publication, scheduling, or send calls. */
export function evaluateShadowComparison(args: EvaluationArgs) {
  const common = {
    version: 1 as const,
    kind: args.kind,
    evaluatorVersion: EVALUATOR_VERSION,
    semanticReviewPerformed: false,
    eligibleForAutomaticPromotion: false,
  };
  try {
    parseShadowInput(args.inputJson, args.kind);
    const context = parseBoundedJson(
      args.evaluationJson,
      ELIZA_SHADOW_PRIVATE_MAX_BYTES,
    );
    const baseline = parseBoundedJson(
      args.baselineJson,
      ELIZA_SHADOW_PRIVATE_MAX_BYTES,
    );
    const output = parseBoundedJson(
      args.outputJson,
      ELIZA_SHADOW_OUTPUT_MAX_BYTES,
    );
    if (args.kind === "suki-reply") {
      const replyContext = replyContextSchema.parse(context);
      const baselineRecord = z
        .object({ decision: z.unknown() })
        .parse(baseline);
      const baselineDecision = sukiReplyDecisionSchema.parse(
        baselineRecord.decision,
      );
      const shadow = evaluateReply(output, replyContext);
      const baselineMetrics = evaluateReply(baselineDecision, replyContext);
      const parsedOutput = sukiReplyDecisionSchema.safeParse(output);
      return {
        ...common,
        valid: shadow.deterministicValid,
        baseline: baselineMetrics,
        shadow,
        decisionAgreement:
          baselineDecision.decision === shadow.effectiveDecision,
        bodyLexicalSimilarity:
          baselineDecision.decision === "reply" &&
          parsedOutput.success &&
          parsedOutput.data.decision === "reply"
            ? lexicalSimilarity(baselineDecision.body, parsedOutput.data.body)
            : null,
        contextLimitations: [
          "Shadow receives no private Convex Agent conversation history.",
          "Public display names are pseudonymized; source and conversation excerpts are bounded.",
          "Deterministic evidence checks are not semantic entailment, factual truth, or usefulness review.",
          "Live baseline may have a separate semantic review; this evaluator does not perform one.",
        ],
      };
    }
    const newsletterContext = newsletterContextSchema.parse(context);
    const baselineRecord = z.object({ draft: z.unknown() }).parse(baseline);
    const baselineMetrics = evaluateNewsletter(
      baselineRecord.draft,
      newsletterContext,
    );
    const shadow = evaluateNewsletter(output, newsletterContext);
    return {
      ...common,
      valid: shadow.deterministicValid,
      baseline: baselineMetrics,
      shadow,
      scoreDelta:
        baselineMetrics.score !== null && shadow.score !== null
          ? shadow.score - baselineMetrics.score
          : null,
      wordCountDelta:
        baselineMetrics.wordCount !== null && shadow.wordCount !== null
          ? shadow.wordCount - baselineMetrics.wordCount
          : null,
      contextLimitations: [
        "Shadow receives no recent newsletter headlines, theses, or selected story IDs; unpublished editorial context stays in Convex.",
        "Public source article excerpts are compacted to at most 1500 characters; descriptions and titles are also bounded.",
        "Both drafts are scored against the same private original source evidence and recent editorial context.",
        "The live baseline may include an accepted revision; the shadow is a single draft.",
        "Deterministic source-token coverage is not semantic entailment or a factual-truth review.",
      ],
    };
  } catch (error) {
    return {
      ...common,
      valid: false,
      evaluationFailed: true,
      errors: safeEvaluationErrors(error),
      contextLimitations: [
        "No comparison was completed; no semantic review or promotion occurred.",
      ],
    };
  }
}

export const evaluate = internalAction({
  args: {
    kind: v.union(v.literal("suki-reply"), v.literal("belle-newsletter")),
    inputJson: v.string(),
    evaluationJson: v.string(),
    baselineJson: v.string(),
    outputJson: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, args) => JSON.stringify(evaluateShadowComparison(args)),
});

function parseBoundedJson(value: string, maximumBytes: number): unknown {
  if (Buffer.byteLength(value, "utf8") > maximumBytes) {
    throw new Error("shadow-json-size-limit");
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error("shadow-json-invalid");
  }
}

function safeEvaluationErrors(error: unknown): string[] {
  if (error instanceof z.ZodError) {
    // Zod issues include only contract paths/codes here, never untrusted input.
    return error.issues
      .slice(0, 12)
      .map(
        (issue) =>
          `contract:${issue.path.map(String).join(".") || "root"}:${issue.code}`,
      );
  }
  // Validators use fixed messages, but do not echo arbitrary thrown/provider data.
  return ["deterministic-validation-failed"];
}

function evaluateReply(
  value: unknown,
  context: z.infer<typeof replyContextSchema>,
) {
  const parsed = sukiReplyDecisionSchema.safeParse(value);
  if (!parsed.success) {
    return {
      schemaValid: false,
      deterministicValid: false,
      effectiveDecision: null,
      errors: safeEvaluationErrors(parsed.error),
      naturalnessScore: null,
      markupValid: null,
      readabilityValid: null,
      wordCount: null,
    };
  }
  const reply = parsed.data;
  const body = reply.decision === "reply" ? reply.body : "";
  const hygiene = evaluateAgentPublicationHygiene(body);
  const markup = validateForumAgentMarkup(body);
  const readability = assessForumReadability(body);
  let decision: SukiReplyDecision = reply;
  const errors: string[] = [];
  try {
    decision = validateSukiReplyDecision(reply);
    decision = validateForumReplyEvidence(decision, context.evidence);
    if (reply.decision === "reply" && decision.decision === "ignore") {
      errors.push(decision.reason);
    }
    if (context.candidate.authorIsAgent && decision.decision === "reply") {
      assertAiSourceReplyGrounding(
        decision.body,
        context.candidate.sourceBody,
        context.evidence,
      );
    }
  } catch (error) {
    errors.push(...safeEvaluationErrors(error));
  }
  return {
    schemaValid: true,
    deterministicValid: errors.length === 0,
    effectiveDecision: decision.decision,
    errors,
    naturalnessScore:
      reply.decision === "reply" ? hygiene.naturalnessScore : null,
    markupValid: reply.decision === "reply" ? markup.valid : null,
    readabilityValid: reply.decision === "reply" ? readability.valid : null,
    wordCount:
      reply.decision === "reply" ? (body.match(/\S+/g)?.length ?? 0) : null,
  };
}

function evaluateNewsletter(
  value: unknown,
  context: z.infer<typeof newsletterContextSchema>,
) {
  const generatedSchema =
    context.edition === "daily-signal"
      ? generatedDailyDraftSchema
      : generatedWeeklyDraftSchema;
  const parsed = generatedSchema.safeParse(value);
  const invalid = {
    schemaValid: parsed.success,
    deterministicValid: false,
    score: null,
    wordCount: null,
    errors: [] as string[],
  };
  if (!parsed.success) {
    return { ...invalid, errors: safeEvaluationErrors(parsed.error) };
  }
  try {
    const storiesById = new Map(
      context.stories.map((story) => [story.hnItemId, story]),
    );
    // Old captured outputs may still contain chart.items. Never trust or remap
    // those independent IDs or labels; both transports derive rows identically.
    const materialized = materializeEditorialChart(parsed.data, storiesById);
    const schema =
      context.edition === "daily-signal" ? dailyDraftSchema : weeklyDraftSchema;
    const complete = schema.safeParse(materialized);
    if (!complete.success) {
      return { ...invalid, schemaValid: false, errors: safeEvaluationErrors(complete.error) };
    }
    const draft = complete.data;
    validateEditorialDraft(draft, storiesById);
    const quality = scoreEditorialPackage({
      draft,
      edition: context.edition,
      recent: context.recent,
      sources: draft.stories.map((story) =>
        storiesById.get(story.hnItemId)!,
      ),
    });
    const wordCount = editorialDraftWordCount(draft);
    const limits = editorialDraftLimits(context.edition);
    const errors = quality.blockingIssues.map(() => "editorial-blocking-issue");
    if (quality.score < limits.threshold)
      errors.push("editorial-score-below-threshold");
    if (wordCount < limits.minimumWords || wordCount > limits.maximumWords) {
      errors.push("editorial-word-count-outside-limits");
    }
    return {
      schemaValid: true,
      deterministicValid: errors.length === 0,
      errors,
      score: quality.score,
      sourceCoverage: quality.sourceCoverage,
      sourceDiversity: quality.sourceDiversity,
      originality: quality.originality,
      utility: quality.utility,
      blockingIssueCount: quality.blockingIssues.length,
      wordCount,
      limits,
    };
  } catch (error) {
    return { ...invalid, errors: safeEvaluationErrors(error) };
  }
}
