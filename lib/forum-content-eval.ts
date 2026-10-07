import { z } from "zod";
import type { ForumContentCase } from "../evals/forum-content/schema";
import {
  validateForumAgentMarkup,
  validateForumContentCompleteness,
} from "./editorial-quality";

export const forumEvalDraftSchema = z
  .object({
    decision: z.enum(["publish", "abstain"]),
    title: z.string().max(150),
    body: z.string().max(16000),
    sourceIds: z.array(z.string()).max(12),
    reason: z.string().max(1000),
  })
  .strict();
export const forumEvalCriticSchema = z
  .object({
    accepted: z.boolean(),
    issues: z.array(z.string().max(1000)).max(12),
    scores: z
      .object({
        grounding: z.number().min(0).max(100),
        usefulness: z.number().min(0).max(100),
        naturalness: z.number().min(0).max(100),
        styleFit: z.number().min(0).max(100),
      })
      .strict(),
  })
  .strict();
export type ForumEvalDraft = z.infer<typeof forumEvalDraftSchema>;
export type ForumEvalCritic = z.infer<typeof forumEvalCriticSchema>;

/** Public depth specification, independent of any case's hidden assertions. */
export function forumEvalRequestedRange(
  style: string,
  depth: string,
): [number, number] {
  if (depth === "long") return [450, 900];
  if (depth === "medium") return [150, 350];
  return style === "social_question" ? [35, 100] : [40, 180];
}

export function selectForumEvalCases(
  cases: ForumContentCase[],
  split: "train" | "holdout",
  limit: number,
) {
  const groups = new Map<string, ForumContentCase[]>();
  for (const item of cases.filter((item) => item.split === split)) {
    groups.set(item.style, [...(groups.get(item.style) ?? []), item]);
  }
  const selected: ForumContentCase[] = [];
  while (selected.length < limit) {
    let added = false;
    for (const group of groups.values()) {
      const next = group.shift();
      if (next && selected.length < limit) {
        selected.push(next);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

/** Deliberately excludes all expected answers and split/family identifiers. */
export function forumEvalPublicInput(item: ForumContentCase) {
  return {
    task: item.task,
    style: item.style,
    depth: item.depth,
    audience: item.audience,
    instruction: item.instruction,
    context: item.context,
    evidence: item.evidence,
    requestedWordRangeIfPublishing: forumEvalRequestedRange(
      item.style,
      item.depth,
    ),
  };
}

export function forumEvalWordCount(body: string) {
  return body
    .replace(/\[\/?[a-z][^\]]*\]/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Feedback visible to any writer from the public task and its own output.
 * Its narrow input type prevents accidentally leaking hidden expected answers. */
export function forumEvalPublicFeedback(
  item: Pick<ForumContentCase, "style" | "depth" | "evidence">,
  draft: ForumEvalDraft,
) {
  const feedback: { code: string; message: string }[] = [];
  const available = new Set(item.evidence.map((source) => source.id));
  for (const id of draft.sourceIds) {
    if (!available.has(id))
      feedback.push({
        code: "unknown_source",
        message: `Source ID ${id} is not in the supplied evidence packet`,
      });
  }
  if (draft.decision === "publish") {
    if (!draft.title.trim() || !draft.body.trim())
      feedback.push({
        code: "empty_content",
        message: "A published contribution needs a title and a complete body",
      });
    const words = forumEvalWordCount(draft.body);
    const [minimum, maximum] = forumEvalRequestedRange(item.style, item.depth);
    if (words < minimum || words > maximum)
      feedback.push({
        code: "public_word_range",
        message: `${words} body words; the public ${item.depth} ${item.style} request specifies ${minimum}-${maximum}. Refine complete supported content to that depth, or abstain if evidence cannot support it.`,
      });
    for (const message of validateForumAgentMarkup(draft.body).feedback)
      feedback.push({ code: "markup", message });
    feedback.push(
      ...validateForumContentCompleteness(draft.body, { title: draft.title })
        .issues,
    );
  } else if (!draft.reason.trim())
    feedback.push({
      code: "missing_abstention_reason",
      message: "Explain why the available evidence cannot support publication",
    });
  return feedback;
}

export function forumEvalCallStartDelay(
  now: number,
  previousStart: number,
  intervalMs = 6000,
) {
  return Math.max(0, previousStart + intervalMs - now);
}

/** A model's favorable opinion cannot override an explicit safety or task failure.
 * Semantic mustInclude/mustAvoid are review notes, not substring assertions. */
export function scoreForumEval(
  item: ForumContentCase,
  draft: ForumEvalDraft,
  critic?: ForumEvalCritic,
) {
  const failures: { code: string; message: string }[] = [];
  const add = (code: string, message: string) =>
    failures.push({ code, message });
  if (draft.decision !== item.expected.publicationDecision)
    add(
      "decision",
      `Expected ${item.expected.publicationDecision}; received ${draft.decision}`,
    );
  const available = new Set(item.evidence.map((source) => source.id));
  for (const sourceId of draft.sourceIds)
    if (!available.has(sourceId))
      add("unknown_source", `Invented source ID: ${sourceId}`);
  if (draft.decision === "publish") {
    if (!draft.title.trim() || !draft.body.trim())
      add("empty_content", "Published content needs a title and body");
    const words = forumEvalWordCount(draft.body);
    const [min, max] = item.expected.wordRange;
    if (words < min || words > max)
      add("word_range", `${words} words; expected ${min}-${max}`);
    for (const id of item.expected.requiredSourceIds)
      if (!draft.sourceIds.includes(id))
        add("missing_source", `Required source ID: ${id}`);
    const text = `${draft.title}\n${draft.body}`;
    for (const check of item.expected.checks) {
      const found = check.kind.endsWith("contains")
        ? text.toLowerCase().includes(check.value.toLowerCase())
        : new RegExp(check.value, "i").test(text);
      if (check.kind.startsWith("not_") ? found : !found)
        add("explicit_check", check.reason);
    }
    for (const feedback of validateForumAgentMarkup(draft.body).feedback)
      add("markup", feedback);
    for (const issue of validateForumContentCompleteness(draft.body, {
      title: draft.title,
    }).issues)
      add(issue.code, issue.message);
  } else if (!draft.reason.trim())
    add("missing_abstention_reason", "Explain why publication is unsupported");
  const criticAccepted =
    critic !== undefined &&
    critic.accepted &&
    critic.issues.length === 0 &&
    critic.scores.grounding >= 80 &&
    critic.scores.usefulness >= 65 &&
    critic.scores.naturalness >= 60 &&
    critic.scores.styleFit >= 60;
  return {
    hardPassed: failures.length === 0,
    criticAccepted,
    accepted: failures.length === 0 && criticAccepted,
    failures,
    wordCount: forumEvalWordCount(draft.body),
    semanticReviewNotes: {
      mustInclude: item.expected.mustInclude,
      mustAvoid: item.expected.mustAvoid,
      notes: item.expected.evaluatorNotes,
    },
    limitation:
      "Shape and explicit checks are deterministic; blind model critique is a proxy, not verified factual entailment or real community outcomes.",
  };
}

export type ForumEvalMetricItem = {
  id: string;
  style: string;
  hardPassed?: boolean;
  accepted?: boolean;
  error?: string;
  servedModels?: string[];
  writerOutput?: boolean;
  judged?: boolean;
};
export function summarizeForumEval(
  results: ForumEvalMetricItem[],
  expectedCount: number,
) {
  const completed = results.filter(
    (item) =>
      !item.error && item.judged !== false && item.hardPassed !== undefined,
  );
  const writerOutputs = results.filter(
    (item) => item.writerOutput === true || item.hardPassed !== undefined,
  );
  const servedModels = [
    ...new Set(results.flatMap((item) => item.servedModels ?? [])),
  ];
  return {
    selected: expectedCount,
    attempted: results.length,
    completed: completed.length,
    writerOutputs: writerOutputs.length,
    errors: results.filter((item) => item.error).length,
    hardPassed: writerOutputs.filter((item) => item.hardPassed).length,
    accepted: completed.filter((item) => item.accepted).length,
    acceptanceDenominator: expectedCount,
    servedModels,
    routingVaried: servedModels.length > 1,
    byStyle: Object.fromEntries(
      [...new Set(results.map((item) => item.style))].map((style) => {
        const group = results.filter((item) => item.style === style);
        return [
          style,
          {
            selected: group.length,
            completed: group.filter(
              (item) =>
                !item.error &&
                item.judged !== false &&
                item.hardPassed !== undefined,
            ).length,
            writerOutputs: group.filter(
              (item) =>
                item.writerOutput === true || item.hardPassed !== undefined,
            ).length,
            hardPassed: group.filter((item) => item.hardPassed).length,
            accepted: group.filter(
              (item) => !item.error && item.judged !== false && item.accepted,
            ).length,
          },
        ];
      }),
    ),
  };
}
