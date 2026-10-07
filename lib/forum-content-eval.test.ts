import { describe, expect, it } from "vitest";
import { forumContentDataset } from "../evals/forum-content/dataset";
import {
  forumEvalPublicInput,
  forumEvalRequestedRange,
  forumEvalPublicFeedback,
  forumEvalCallStartDelay,
  scoreForumEval,
  selectForumEvalCases,
  summarizeForumEval,
  type ForumEvalCritic,
  type ForumEvalDraft,
} from "./forum-content-eval";
import { forumDraftPrompt } from "../convex/sukiForumAgent";
import { FORUM_EDITORIAL_CONTRACT } from "./forum-posting-prompts";

const critic: ForumEvalCritic = {
  accepted: true,
  issues: [],
  scores: { grounding: 100, usefulness: 100, naturalness: 100, styleFit: 100 },
};
function fixture() {
  const item = structuredClone(forumContentDataset.cases[0]!);
  item.expected = {
    publicationDecision: "publish",
    wordRange: [1, 100],
    mustInclude: ["A semantic concept, not an exact phrase"],
    mustAvoid: ["Overconfidence"],
    requiredSourceIds: [],
    checks: [],
    evaluatorNotes: "Inspect evidence independently",
  };
  const draft: ForumEvalDraft = {
    decision: "publish",
    title: "One useful next step",
    body: "Try the documented path first. It isolates the local problem without changing your configuration.",
    sourceIds: [],
    reason: "Evidence supports this bounded advice",
  };
  return { item, draft };
}
describe("forum content evaluation", () => {
  it("paces consecutive call starts without delaying an already spaced call", () => {
    expect(forumEvalCallStartDelay(10000, 9000)).toBe(5000);
    expect(forumEvalCallStartDelay(16000, 9000)).toBe(0);
  });
  it("public revision feedback cannot change when hidden expectations change", () => {
    const { item, draft } = fixture();
    draft.body = "[h2]Next steps[/h2]\n[note][/note]";
    draft.sourceIds = ["fabricated"];
    const before = forumEvalPublicFeedback(item, draft);
    item.expected = {
      publicationDecision: "abstain",
      wordRange: [0, 0],
      mustInclude: ["secret answer"],
      mustAvoid: ["secret exclusion"],
      requiredSourceIds: ["secret source"],
      checks: [
        {
          kind: "contains",
          value: "secret literal",
          reason: "private assertion",
        },
      ],
      evaluatorNotes: "hidden decision",
    };
    expect(forumEvalPublicFeedback(item, draft)).toEqual(before);
    expect(before.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "public_word_range",
        "unknown_source",
        "empty_callout",
      ]),
    );
    expect(JSON.stringify(before)).not.toContain("secret");
  });
  it("selects all styles before returning to extra training cases", () => {
    const selected = selectForumEvalCases(
      forumContentDataset.cases,
      "train",
      12,
    );
    expect(new Set(selected.map((item) => item.style)).size).toBe(12);
    expect(selected.every((item) => item.split === "train")).toBe(true);
  });
  it("provides public depth guidance independently of hidden case checks", () => {
    const { item } = fixture();
    item.expected.wordRange = [999, 9999];
    expect(forumEvalPublicInput(item).requestedWordRangeIfPublishing).toEqual([
      40, 180,
    ]);
    expect(forumEvalRequestedRange("social_question", "short")).toEqual([
      35, 100,
    ]);
    expect(forumEvalRequestedRange("help_reply", "medium")).toEqual([150, 350]);
    expect(forumEvalRequestedRange("deep_dive", "long")).toEqual([450, 900]);
  });
  it("evaluates the editorial contract embedded in the actual production writer prompt", () => {
    const prompt = forumDraftPrompt({
      category: {
        slug: "general",
        name: "General",
        description: "Community discussion",
      },
      selection: {
        categorySlug: "general",
        candidateIds: ["evidence"],
        angle: "A concise useful update",
        postType: "discussion",
        prefixSlug: "discussion",
        includePoll: false,
        contentFormat: "brief",
      },
      snapshots: [],
      config: {
        dailySlots: 1,
        name: "Synthetic reviewer",
        slug: "synthetic-reviewer",
        promptVersion: "eval-only",
        topicInstructions: "",
        writerInstructions: "",
        deskDescription: "Useful community posts",
      },
    });
    expect(prompt).toContain(FORUM_EDITORIAL_CONTRACT);
    expect(prompt).toContain("Plain short prose is valid");
  });
  it("keeps evaluator answers and split metadata out of writer and critic input", () => {
    const { item } = fixture();
    const input = forumEvalPublicInput(item);
    expect(input).not.toHaveProperty("expected");
    expect(input).not.toHaveProperty("split");
    expect(input).not.toHaveProperty("family");
    expect(JSON.stringify(input)).not.toContain(item.expected.mustInclude[0]);
  });
  it("allows short plain posts without mandatory ornamental structures", () => {
    const { item, draft } = fixture();
    expect(scoreForumEval(item, draft, critic).accepted).toBe(true);
  });
  it("does not convert semantic reviewer notes into literal assertions", () => {
    const { item, draft } = fixture();
    const result = scoreForumEval(item, draft, critic);
    expect(result.hardPassed).toBe(true);
    expect(result.semanticReviewNotes.mustInclude).toEqual(
      item.expected.mustInclude,
    );
  });
  it("rejects fabricated sources despite an adversarial perfect critic", () => {
    const { item, draft } = fixture();
    draft.sourceIds = ["invented-source"];
    const result = scoreForumEval(item, draft, critic);
    expect(result.accepted).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain(
      "unknown_source",
    );
  });
  it("checks explicit expectations and length ahead of model judgment", () => {
    const { item, draft } = fixture();
    item.expected.wordRange = [50, 100];
    item.expected.requiredSourceIds = ["source-one"];
    item.expected.checks = [
      {
        kind: "contains",
        value: "rollback",
        reason: "Include a rollback step",
      },
      {
        kind: "not_regex",
        value: "documented",
        reason: "Avoid this exact test phrase",
      },
    ];
    const result = scoreForumEval(item, draft, critic);
    expect(result.accepted).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining([
        "word_range",
        "missing_source",
        "explicit_check",
      ]),
    );
  });
  it("rejects incomplete published bodies even if the critic accepts", () => {
    const { item, draft } = fixture();
    draft.body = "[h2]Next steps[/h2]\n[note][/note]";
    const result = scoreForumEval(item, draft, critic);
    expect(result.accepted).toBe(false);
    expect(result.failures.map((failure) => failure.code)).toContain(
      "empty_callout",
    );
  });
  it("requires an abstention reason and the expected publication decision", () => {
    const { item, draft } = fixture();
    draft.decision = "abstain";
    draft.reason = "";
    expect(
      scoreForumEval(item, draft, critic).failures.map(
        (failure) => failure.code,
      ),
    ).toEqual(["decision", "missing_abstention_reason"]);
    item.expected.publicationDecision = "abstain";
    draft.reason = "The supplied source is about a different subject.";
    expect(scoreForumEval(item, draft, critic).accepted).toBe(true);
  });
  it("does not reuse initial judgment to claim an unjudged revision accepted", () => {
    const { item, draft } = fixture();
    expect(scoreForumEval(item, draft).hardPassed).toBe(true);
    expect(scoreForumEval(item, draft).accepted).toBe(false);
  });
  it("includes failures in denominators and exposes changing routed models", () => {
    expect(
      summarizeForumEval(
        [
          {
            id: "one",
            style: "short",
            hardPassed: true,
            accepted: true,
            servedModels: ["provider-a:free"],
          },
          {
            id: "two",
            style: "short",
            error: "timeout",
            servedModels: ["provider-b:free"],
          },
        ],
        3,
      ),
    ).toMatchObject({
      selected: 3,
      attempted: 2,
      completed: 1,
      errors: 1,
      accepted: 1,
      acceptanceDenominator: 3,
      routingVaried: true,
      byStyle: { short: { selected: 2, completed: 1, accepted: 1 } },
    });
  });
  it("retains deterministic writer results when the critic call fails", () => {
    const summary = summarizeForumEval(
      [
        {
          id: "critic-timeout",
          style: "short_discovery",
          writerOutput: true,
          judged: false,
          hardPassed: true,
          accepted: false,
          error: "TimeoutError",
        },
      ],
      1,
    );
    expect(summary).toMatchObject({
      writerOutputs: 1,
      completed: 0,
      hardPassed: 1,
      accepted: 0,
      errors: 1,
      acceptanceDenominator: 1,
    });
    expect(summary.byStyle.short_discovery).toMatchObject({
      writerOutputs: 1,
      completed: 0,
      hardPassed: 1,
      accepted: 0,
    });
  });
});
