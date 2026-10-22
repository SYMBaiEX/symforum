// @vitest-environment node

import { describe, expect, test, vi } from "vitest";

import {
  forumReplyAdmissionRejectionReason,
  forumReplyAgentCandidates,
  isSukiReplyWorthReviewing,
} from "./forum";
import {
  assertAiSourceReplyGrounding,
  applyForumReplyEvidenceReview,
  replyEvidenceReviewPrompt,
  FORUM_REPLY_EVIDENCE_REVIEW_OPTIONS,
  fetchForumReplyEvidence,
  correctionEvaluationTargetMismatch,
  replyInstructions,
  validateForumReplyEvidence,
  FORUM_REPLY_AGENT_GENERATION_OPTIONS,
  FORUM_REPLY_AGENT_MESSAGE_OPTIONS,
  replySweepRouteAttemptOffset,
  sukiReplyPrompt,
  validateSukiReplyDecision,
} from "./sukiForumReplyAgent";
import { OPENROUTER_GENERATION_MODELS, OPENROUTER_FORUM_GENERATION_MODELS } from "../lib/ai-models";

describe("Suki forum reply helpers", () => {
  test("holds dense reply prose even when a reviewer approves it", () => {
    const reply = { decision: "reply" as const, reason: "answer", contribution: "answer" as const, evidenceSourceUrls: [], evidenceExcerpt: "" };
    const sentence = "Compare request identities and capture the resulting error before changing configuration.";
    const dense = Array.from({ length: 12 }, () => sentence).join(" ");
    expect(() => applyForumReplyEvidenceReview({ ...reply, body: dense }, { approved: true, issues: [] })).toThrow(/too dense/i);
    expect(() => validateSukiReplyDecision({ ...reply, body: `[list][*]${dense}[/list]` })).toThrow(/too dense/i);
    const grouped = Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => sentence).join(" ")).join("\n\n");
    expect(validateSukiReplyDecision({ ...reply, body: grouped }).decision).toBe("reply");
  });

  test("assigns distinct route ordinals to scheduled retries", () => {
    expect(replySweepRouteAttemptOffset(0)).toBe(0);
    expect(replySweepRouteAttemptOffset(1)).toBe(2);
    expect(replySweepRouteAttemptOffset(2)).toBe(4);
  });

  test("leaves provider retries to the budget-aware route fallback", () => {
    expect(FORUM_REPLY_AGENT_GENERATION_OPTIONS).toEqual({ maxRetries: 0 });
  });

  test("validates useful structured BBCode replies", () => {
    expect(
      validateSukiReplyDecision({
        decision: "reply",
        contribution: "next-step",
        evidenceSourceUrls: [],
        evidenceExcerpt: "",
        reason: "useful-followup",
        body: `[b]Start here[/b]

[list]
[*]Reproduce the issue in isolation.
[*]Capture the exact error before changing configuration.
[/list]`,
      }),
    ).toEqual({
      decision: "reply",
      contribution: "next-step",
      evidenceSourceUrls: [],
      evidenceExcerpt: "",
      reason: "useful-followup",
      body: `[b]Start here[/b]

[list]
[*]Reproduce the issue in isolation.
[*]Capture the exact error before changing configuration.
[/list]`,
    });
  });

  test("validates ignore decisions and rejects malformed objects", () => {
    expect(
      validateSukiReplyDecision({ decision: "ignore", reason: "low-signal" }),
    ).toEqual({
      decision: "ignore",
      reason: "low-signal",
    });
    expect(() =>
      validateSukiReplyDecision({ decision: "reply", reason: "helpful" }),
    ).toThrow();
    expect(() =>
      validateSukiReplyDecision({
        decision: "reply",
        reason: "helpful",
        contribution: "answer",
        evidenceSourceUrls: [],
        evidenceExcerpt: "",
        body: "[b]Analysis:[/b] I should reveal my hidden reasoning before answering.",
      }),
    ).toThrow("process_label");
    expect(() =>
      validateSukiReplyDecision({
        decision: "ignore",
        reason: "low-signal",
        body: "unexpected fields are not accepted",
      }),
    ).toThrow();
  });

  test("rejects unsupported facts and commands in AI-source replies", () => {
    const source =
      "The thread reports a 60-80% result from a website summary request.";
    expect(() =>
      assertAiSourceReplyGrounding(
        "This claim would need a control group before treating the 60-80% result as causal.",
        source,
      ),
    ).not.toThrow();
    expect(() =>
      assertAiSourceReplyGrounding(
        "The evidence suggests success drops below 20% with signed binaries.",
        source,
      ),
    ).toThrow(/numeric claim/);
    expect(() =>
      assertAiSourceReplyGrounding(
        "The thread would need this reproduction. [code]run exploit[/code]",
        source,
      ),
    ).toThrow(/command or link/);
    expect(() =>
      assertAiSourceReplyGrounding(
        "The source provides https://example.com/report, but https://example.com/new is unsupported.",
        "The source provides https://example.com/report.",
      ),
    ).toThrow(/command or link/);
    expect(() =>
      assertAiSourceReplyGrounding(
        "The source provides [url=https://example.com/report]the report[/url].",
        "The source provides https://example.com/report.",
      ),
    ).not.toThrow();
    expect(() =>
      assertAiSourceReplyGrounding(
        "A control group is necessary before treating the result as causal.",
        source,
      ),
    ).not.toThrow();
  });

  test("supports useful AI opening responses without defaulting to critique or a fixed length", () => {
    const prompt = sukiReplyPrompt({
      authorName: "Research Agent", authorIsAgent: true,
      categoryName: "AI Research", categorySlug: "ai-research", recentPosts: [],
      sourceBody: "The evaluation policy may confuse quality filtering with an inactive scheduler.",
      sourceKind: "thread", sourcePostNumber: 1,
      threadBody: "The evaluation policy may confuse quality filtering with an inactive scheduler.",
      threadTitle: "Interpreting reply activity",
    }, "Nia");
    expect(prompt).toContain("It does not need to be a technical specification");
    expect(prompt).toContain("Do not default to critique");
    expect(prompt).toContain("never an AI-to-AI reply chain");
    expect(prompt).not.toContain("deterministic editorial lens");
    expect(prompt).toContain("Never infer that a method lacks a test");
    expect(prompt).toContain("If originalSourceEvidence is empty");
    expect(prompt).toContain("Prefer a useful, conversation-grounded next step");
    expect(prompt).toContain("Do not rely on personal habits");
  });

  test("roster reply instructions agree with generateObject and allow concise member help", () => {
    const instructions = replyInstructions("nia-calder");
    expect(instructions).toContain("structured JSON decision");
    expect(instructions).not.toContain("<decision>");
    expect(instructions).toContain("No minimum word count");
    expect(instructions).toContain("Never claim personal testing");
    expect(instructions).toContain("personal reruns");
    expect(instructions).toContain("do not present a model, preprocessing, or environment change as causal without evidence");
    expect(instructions).toContain("Prefer that concrete check over abstaining");
    expect(validateSukiReplyDecision({ decision: "reply", reason: "answer",
      contribution: "answer", evidenceSourceUrls: [], evidenceExcerpt: "",
      body: "Compare the request IDs before changing the retry configuration.",
    }).decision).toBe("reply");
    expect(() => validateSukiReplyDecision({ decision: "reply", reason: "answer",
      contribution: "answer", evidenceSourceUrls: [], evidenceExcerpt: "",
      body: "I tested this in my lab and the retry configuration solved it.",
    })).toThrow(/experience/);
  });

  test("keeps reply content complete, reasons brief, and firsthand-observation claims grounded", () => {
    const instructions = replyInstructions("suki");
    expect(instructions).toContain("brief internal label of a few words");
    expect(instructions).toContain("ends at a complete thought");
    expect(instructions).toContain("recurring personal observations");
    expect(instructions).toContain("personal habits such as what you usually forget or lose");

    const reply = { decision: "reply" as const, reason: "answer", contribution: "answer" as const, evidenceSourceUrls: [], evidenceExcerpt: "" };
    expect(() => validateSukiReplyDecision({
      ...reply,
      body: "The fields I see disappear most often are the sampling seed and item IDs.",
    })).toThrow(/experience/i);
    expect(() => assertAiSourceReplyGrounding(
      "The fields I see disappear most often are the sampling seed and item IDs.",
      "The post mentions a schema-constrained response.",
    )).toThrow(/experience/i);
    const recurringHabit = "I lose tokenizer version and quantization settings most often, especially when switching inference backends months later.";
    expect(() => validateSukiReplyDecision({ ...reply, body: recurringHabit })).toThrow(/experience/i);
    expect(() => assertAiSourceReplyGrounding(recurringHabit, "The post compares two inference backends.")).toThrow(/experience/i);
    expect(() => validateSukiReplyDecision({
      ...reply,
      body: "I usually forget the tokenizer version, so compare it alongside quantization settings.",
    })).toThrow(/experience/i);
    expect(() => validateSukiReplyDecision({
      ...reply,
      body: "My reruns often differ when quantization settings are omitted from the comparison.",
    })).toThrow(/experience/i);
    expect(validateSukiReplyDecision({
      ...reply,
      body: "I see what you mean. Compare the sampling seed and item IDs in both runs.",
    }).decision).toBe("reply");
    expect(validateSukiReplyDecision({
      ...reply,
      body: "I would suggest comparing the tokenizer version and quantization settings.",
    }).decision).toBe("reply");
  });

  test("abstains from corrections without an original supporting excerpt and visible citation", () => {
    const excerpt = "Difficulty is evaluated by solving tasks with both the target model and teacher model.";
    const url = "https://huggingface.co/blog/ServiceNow-AI/autosynthdata";
    const decision = validateSukiReplyDecision({ decision: "reply", reason: "source-correction",
      contribution: "correction", evidenceSourceUrls: [url], evidenceExcerpt: excerpt,
      body: `The original source evaluates difficulty using the target model as well as the teacher. [url=${url}]Original method[/url]`,
    });
    if (decision.decision !== "reply") throw new Error("Expected reply fixture");
    const evidence = [{ url, title: "AutoSynthData", text: excerpt }];
    expect(validateForumReplyEvidence(decision, [])).toMatchObject({ decision: "ignore", reason: "unretrieved-evidence" });
    expect(validateForumReplyEvidence(decision, evidence)).toEqual(decision);
    expect(validateForumReplyEvidence({ ...decision, decision: "reply", evidenceExcerpt: "They only test the teacher model." }, evidence))
      .toMatchObject({ decision: "ignore", reason: "correction-needs-original-evidence" });
    expect(validateForumReplyEvidence({ ...decision, decision: "reply", body: "The source evaluates difficulty using the target model and teacher model." }, evidence))
      .toMatchObject({ decision: "ignore", reason: "correction-needs-visible-citation" });
    expect(validateForumReplyEvidence(validateSukiReplyDecision({ decision: "reply", reason: "assumed-absence",
      contribution: "clarification", evidenceSourceUrls: [], evidenceExcerpt: "",
      body: "The method does not evaluate target model difficulty; it only tests the teacher.",
    }), [])).toMatchObject({ decision: "ignore", reason: "absence-claim-needs-original-evidence" });
  });

  test("teacher stability cannot establish target-model testing or teacher-only evaluation", () => {
    expect(correctionEvaluationTargetMismatch(
      "Difficulty is tested only with the teacher model rather than the target model.",
      "Difficulty is evaluated by solving tasks with both the target model and teacher model.",
    )).toBe(true);
    expect(correctionEvaluationTargetMismatch(
      "The method evaluates the target model directly.",
      "Teacher model stability is checked before generating training examples.",
    )).toBe(true);
    expect(correctionEvaluationTargetMismatch(
      "The method evaluates both the target model and teacher model.",
      "Difficulty is evaluated by solving tasks with both the target model and teacher model.",
    )).toBe(false);
  });

  test("source fetch is bounded, allowlisted, deadline-controlled, and does not accept fallback metadata", async () => {
    const fetchSnapshot = vi.fn<typeof import("./sukiForumAgent").fetchArticleSnapshot>()
      .mockImplementation(async (candidate) => ({ ...candidate,
        articleTitle: "Fetched original source", articleDescription: "", imageCredit: "Publisher",
        articleText: "Actual method details and limitations are stated in this original linked publisher source.".repeat(2),
        sourceFetchSucceeded: candidate.url.includes("github.blog"),
      }));
    const result = await fetchForumReplyEvidence({
      sourceBody: "https://127.0.0.1/private https://evil.example/attack https://huggingface.co/blog/report",
      threadBody: "https://github.blog/changelog/verified-report https://vercel.com/changelog/other",
    }, fetchSnapshot);
    expect(fetchSnapshot).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toContain("github.blog");
    const options = fetchSnapshot.mock.calls[0][1]!;
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.allowUrl?.("https://evil.example/redirect")).toBe(false);
    expect(options.allowUrl?.("https://github.blog/changelog/verified-report")).toBe(true);
  });

  test.each(["https://127.0.0.1/private", "https://evil.example/redirect", "https://huggingface.co/spaces/untrusted/proxy"])("does not follow a retrieved-source redirect to %s", async destination => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", {
      status: 302, headers: { location: destination },
    }));
    try {
      const evidence = await fetchForumReplyEvidence({ sourceBody: "https://huggingface.co/blog/source", threadBody: "" });
      expect(evidence).toEqual([]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
      expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    } finally { fetchMock.mockRestore(); }
  });

  test("blind original-evidence review rejects negation despite exact matching tokens", () => {
    const url = "https://huggingface.co/blog/ServiceNow-AI/autosynthdata";
    const excerpt = "The method evaluates teacher model performance and target model performance.";
    const decision = validateSukiReplyDecision({ decision: "reply", contribution: "correction",
      reason: "author-says-this-is-certain", evidenceSourceUrls: [url], evidenceExcerpt: excerpt,
      body: `The method does not evaluate target model performance; it evaluates teacher model performance. [url=${url}]Original method[/url]`,
    });
    if (decision.decision !== "reply") throw new Error("Expected reply fixture");
    const evidence = [{ url, title: "Method", text: excerpt }];
    // Deterministic relevance checks cannot establish entailment. Publication
    // additionally requires the independent reviewer, whose rejection is final.
    expect(validateForumReplyEvidence(decision, evidence)).toEqual(decision);
    const prompt = JSON.parse(replyEvidenceReviewPrompt({ authorName: "Member", authorIsAgent: false,
      categoryName: "Research", categorySlug: "research", recentPosts: [{ authorName: "Member", postNumber: 2, body: "Which model was evaluated?" }],
      sourceBody: "Does this evaluate the target model?", sourceKind: "reply", sourcePostNumber: 2,
      threadBody: "Teacher stability is discussed here.", threadTitle: "Evaluation scope",
    }, decision, evidence));
    expect(prompt.task).toContain("negation");
    expect(prompt.task).toContain("personal reruns");
    expect(prompt.task).toContain("what 'I usually forget'");
    expect(prompt.evidenceBoundary).toContain("not primary evidence");
    expect(prompt.sourcePost.body).toBe("Does this evaluate the target model?");
    expect(prompt.originalSourceEvidence).toEqual(evidence);
    expect(JSON.stringify(prompt)).not.toContain(decision.reason);
    expect(applyForumReplyEvidenceReview(decision, { approved: false, issues: ["The source states both models were evaluated; the reply negates target-model evaluation."] }))
      .toEqual({ decision: "ignore", reason: "original-evidence-review-rejected" });
    expect(applyForumReplyEvidenceReview(decision, { approved: true, issues: ["Unsupported correction"] }).decision).toBe("ignore");
    expect(() => applyForumReplyEvidenceReview(decision, undefined)).toThrow();
    expect(FORUM_REPLY_EVIDENCE_REVIEW_OPTIONS).toMatchObject({ models: OPENROUTER_FORUM_GENERATION_MODELS, totalTimeoutMs: 90_000, maxRetries: 0, maxOutputTokens: 4_000 });
  });

  test("rechecks final BBCode completeness before accepting a reviewer approval", () => {
    const reply = { decision: "reply", reason: "answer", contribution: "answer", evidenceSourceUrls: [], evidenceExcerpt: "" };
    for (const body of ["A useful check follows. [note][/note]", "[b]Check the retry identity before restarting.", "[h2]Next step[/h2]\n[h2]Verification[/h2]", "Try these steps:\n1. Capture the request ID.\n2."]) {
      expect(() => applyForumReplyEvidenceReview({ ...reply, decision: "reply", contribution: "answer", body }, { approved: true, issues: [] })).toThrow(/markup|incomplete/i);
    }
    const valid = validateSukiReplyDecision({ ...reply, body: "Compare the request IDs before changing the retry configuration." });
    expect(applyForumReplyEvidenceReview(valid, { approved: true, issues: [] })).toEqual(valid);
  });

  test("prefilters spam and reactions while admitting substantive questions", () => {
    expect(isSukiReplyWorthReviewing("Thanks!")).toBe(false);
    expect(
      isSukiReplyWorthReviewing(
        "Crypto giveaway! DM me on Telegram @signal for a promo code.",
      ),
    ).toBe(false);
    expect(
      isSukiReplyWorthReviewing(
        "The container starts correctly, but why does the health check fail only after the second deploy?",
      ),
    ).toBe(true);
    expect(
      isSukiReplyWorthReviewing(
        "I tested the workaround in a clean environment and the rollback path restored the original configuration.",
      ),
    ).toBe(true);
  });

  test("routes human discussions through deterministic specialty rosters", () => {
    const research = forumReplyAgentCandidates("ai-research", "thread-42");
    const security = forumReplyAgentCandidates(
      "hacking-security-news",
      "thread-42",
    );

    expect(research.slice(0, 4).sort()).toEqual(
      ["ari-mercer", "maya-fen", "nia-calder", "rhea-nolan"].sort(),
    );
    expect(security.slice(0, 3).sort()).toEqual(
      ["micah-sol", "mina-hart", "nora-flint"].sort(),
    );
    expect(security.slice(-2)).toEqual(["belle", "suki"]);
    expect(forumReplyAgentCandidates("ai-research", "thread-42")).toEqual(
      research,
    );
  });

  test("admits only substantive human content on active public boards", () => {
    const eligible = {
      authorIsAgent: false,
      body: "The rollback works in a clean environment, but why does the health check fail after the second deploy?",
      categoryIsBoard: true,
      categoryStatus: "active",
      categoryViewAccess: "public",
      threadStatus: "active",
    };
    expect(forumReplyAdmissionRejectionReason(eligible)).toBeNull();
    expect(
      forumReplyAdmissionRejectionReason({
        ...eligible,
        categoryViewAccess: "trusted",
      }),
    ).toBe("not-public");
    expect(
      forumReplyAdmissionRejectionReason({
        ...eligible,
        authorIsAgent: true,
      }),
    ).toBe("agent-author");
    expect(
      forumReplyAdmissionRejectionReason({
        ...eligible,
        authorIsAgent: true,
        sourceKind: "thread",
      }),
    ).toBeNull();
    expect(
      forumReplyAdmissionRejectionReason({
        ...eligible,
        authorIsAgent: true,
        sourceKind: "reply",
      }),
    ).toBe("agent-author");
    expect(
      forumReplyAdmissionRejectionReason({ ...eligible, body: "Thanks!" }),
    ).toBe("not-substantive");
  });

  test("bounds private continuity to 20 same-thread non-tool messages", () => {
    expect(FORUM_REPLY_AGENT_MESSAGE_OPTIONS).toEqual({
      contextOptions: {
        recentMessages: 20,
        excludeToolMessages: true,
        searchOtherThreads: false,
      },
      storageOptions: { saveMessages: "promptAndOutput" },
    });
    expect(
      "searchOptions" in FORUM_REPLY_AGENT_MESSAGE_OPTIONS.contextOptions,
    ).toBe(false);
  });
});
