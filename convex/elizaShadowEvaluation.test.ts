// @vitest-environment node

import { getFunctionName } from "convex/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ELIZA_SHADOW_INPUT_MAX_BYTES,
  ELIZA_SHADOW_PRIVATE_MAX_BYTES,
  parseShadowInput,
} from "../lib/eliza-shadow-contract";
import type { ActionCtx } from "./_generated/server";
import { evaluateShadowComparison } from "./elizaShadowEvaluation";
import {
  enqueueBelleNewsletterShadowComparison,
  scoreEditorialPackage,
} from "./newsletterAgent";
import {
  enqueueSukiShadowComparison,
  replyInstructions,
} from "./sukiForumReplyAgent";
import type { ArticleSnapshot } from "./sukiForumAgent";

afterEach(() => vi.restoreAllMocks());

function queuedContext() {
  const runMutation = vi.fn(
    async (
      _reference: Parameters<typeof getFunctionName>[0],
      _args: unknown,
    ) => ({ status: "queued" }),
  );
  return {
    runMutation,
    ctx: { runMutation } as unknown as Pick<ActionCtx, "runMutation">,
  };
}

const reply = {
  decision: "reply" as const,
  reason: "answer-the-question",
  body: "Compare the request identities before changing retry configuration.",
  contribution: "next-step" as const,
  evidenceSourceUrls: [],
  evidenceExcerpt: "",
};

function sukiArgs() {
  return {
    agentSlug: "suki",
    sourceRunKey: "reply:run-example",
    attempt: 0,
    candidate: {
      authorName: "PRIVATE_DISPLAY_NAME",
      authorId: "PRIVATE_USER_ID",
      conversationId: "PRIVATE_AGENT_HISTORY",
      authorIsAgent: false,
      categoryName: "Development",
      categorySlug: "development",
      recentPosts: [
        {
          authorName: "PRIVATE_OTHER_NAME",
          body: "The request repeats after reconnecting.",
          postNumber: 2,
        },
      ],
      sourceBody: "How should I investigate retry configuration?",
      sourceKind: "reply" as const,
      sourcePostNumber: 2,
      threadBody: "A public discussion about debugging duplicate requests.",
      threadTitle: "Debugging duplicate requests",
    },
    evidence: [],
    baseline: {
      decision: reply,
      generation: {
        model: "BASELINE_MODEL_ONLY",
        inputTokens: 200,
        outputTokens: 30,
        durationMs: 100,
      },
    },
  };
}

function source(id: number): ArticleSnapshot {
  return {
    id: `newsletter-${id}-${id - 1}`,
    sourceKey: `source-${id}`,
    sourceName: `publisher-${id}.example`,
    sourceFeedUrl: "https://news.ycombinator.com/",
    title: `Public source ${id}`,
    url: `https://publisher-${id}.example/report`,
    summary: "A public report about source-grounded engineering decisions.",
    boardSlugs: ["news-hacker-news"],
    articleTitle: `Public engineering source ${id}`,
    articleDescription: "A public description of the documented changes.",
    articleText: `Source ${id} reports the documented behavior. ${"Public engineering evidence. ".repeat(180)}`,
    imageCredit: "Original publisher",
    imageUrl: "https://images.example/PRIVATE_IMAGE_URL_NOT_NEEDED",
    sourceFetchSucceeded: true,
  };
}

function text(seed: string, minimum: number) {
  return `${seed} ${"documented behavior informs practical engineering choices ".repeat(40)}`.slice(
    0,
    minimum,
  );
}

function newsletterArgs(
  edition: "daily-signal" | "weekly-field-note" = "daily-signal",
) {
  const snapshots = Array.from(
    { length: edition === "daily-signal" ? 3 : 5 },
    (_, index) => source(index + 1),
  );
  const stories = snapshots.map((snapshot, index) => ({
    hnItemId: index + 1,
    summary: text(`Source ${index + 1} documents a reported change.`, 180),
    whyItMatters: text(
      "Operators should verify the source-specific effect before rollout.",
      150,
    ),
    takeaways: [
      text("Check the documented assumptions in staging.", 80),
      text("Keep recovery behavior separate from routing policy.", 80),
    ],
    signalScore: 80,
  }));
  const draft = {
    subject: "Practical checkpoints for source-grounded deployment decisions",
    headline: "Checkpoint evidence changes deployment verification",
    dek: text(
      "Separate reported changes from interpretation when planning a rollout.",
      120,
    ),
    thesis: text(
      "The sources alter distinct decisions about verification and recovery.",
      180,
    ),
    lead: text(
      "Start by checking which observed boundary actually changes local assumptions.",
      240,
    ),
    heroHnItemId: 1,
    chart: {
      title: "Editorial implementation signal",
      subtitle:
        "An editorial comparison of implementation relevance, not a measured benchmark.",
      items: stories.slice(0, 3).map((story) => ({
        hnItemId: story.hnItemId,
        label: `Source ${story.hnItemId}`,
        value: 80,
        note: "A source-specific implementation consideration.",
      })),
    },
    practicalMoves: [
      text(
        "Verify the checkpoint boundary before changing the rollout plan.",
        100,
      ),
      text(
        "Document the recovery assumption alongside the source record.",
        100,
      ),
      text(
        "Keep routing failures separate from observed recovery behavior.",
        100,
      ),
    ],
    whatToWatch: [
      text(
        "Watch whether later source updates narrow the documented behavior.",
        90,
      ),
      text(
        "Watch for independently reproduced evidence before extending the claim.",
        90,
      ),
    ],
    discussionQuestion:
      "Which source-specific verification step would change your current rollout plan?",
    stories,
    ...(edition === "weekly-field-note"
      ? {
          sections: Array.from({ length: 4 }, (_, index) => ({
            heading: `Engineering consideration ${index + 1}`,
            body: text(
              "Distinguish source observations from the operational interpretation.",
              350,
            ),
          })),
        }
      : {}),
  };
  const sources = snapshots.map((snapshot, index) => ({
    hnItemId: index + 1,
    host: snapshot.sourceName,
    sourceText: snapshot.articleText,
  }));
  const recent = {
    headlines: ["UNPUBLISHED_PRIVATE_HEADLINE"],
    theses: ["UNPUBLISHED_PRIVATE_THESIS"],
    storyIds: [99],
  };
  return {
    edition,
    runDate: "2026-10-20",
    snapshotDate: "2026-10-20",
    snapshots,
    sources,
    recent,
    baseline: {
      draft,
      evaluation: {
        quality: scoreEditorialPackage({ draft, edition, recent, sources }),
        wordCount: 900,
        feedback: [],
        needsRevision: false,
      },
      generation: {
        model: "BASELINE_MODEL_ONLY",
        initialModel: "INITIAL_MODEL_ONLY",
        revisionAttempted: true,
        revisionAccepted: true,
        inputTokens: 500,
        outputTokens: 300,
        durationMs: 100,
      },
    },
  };
}

async function queuedSuki() {
  const context = queuedContext();
  await enqueueSukiShadowComparison(context.ctx, sukiArgs());
  const [reference, args] = context.runMutation.mock.calls[0] as unknown as [
    Parameters<typeof getFunctionName>[0],
    {
      kind: "suki-reply";
      inputJson: string;
      baselineJson: string;
      evaluationJson: string;
    },
  ];
  return { reference, args };
}

describe("shadow hooks", () => {
  test.each(["suki", "belle"])(
    "keeps the dedicated %s instructions independent of roster voices",
    (slug) => {
      expect(replyInstructions(slug)).toContain(
        slug === "suki" ? "You are Suki" : "You are Belle",
      );
    },
  );

  test("Suki enqueues only allowlisted public input, not identities, baseline, or private history", async () => {
    const { reference, args } = await queuedSuki();
    expect(getFunctionName(reference)).toBe("elizaShadowData:enqueue");
    const input = parseShadowInput(args.inputJson, "suki-reply");
    expect(input.schema).toHaveProperty("oneOf");
    expect(input.prompt).toContain("duplicate requests");
    expect(args.inputJson).not.toMatch(
      /PRIVATE_|BASELINE_MODEL_ONLY|answer-the-question/,
    );
    expect(args.evaluationJson).not.toMatch(/PRIVATE_/);
    expect(args.baselineJson).toContain("BASELINE_MODEL_ONLY");
    expect(Buffer.byteLength(args.inputJson)).toBeLessThanOrEqual(
      ELIZA_SHADOW_INPUT_MAX_BYTES,
    );
  });

  test.each(["belle", "roster-agent"])(
    "does not enable the reply pilot for %s",
    async (agentSlug) => {
      const { ctx, runMutation } = queuedContext();
      await enqueueSukiShadowComparison(ctx, { ...sukiArgs(), agentSlug });
      expect(runMutation).not.toHaveBeenCalled();
    },
  );

  test("Suki enqueue failure is swallowed with a fixed, content-free warning", async () => {
    const { ctx, runMutation } = queuedContext();
    runMutation.mockRejectedValue(new Error("SECRET_PROVIDER_ERROR_AND_KEY"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      enqueueSukiShadowComparison(ctx, sukiArgs()),
    ).resolves.toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(
      "Eliza shadow Suki observation skipped; live reply unchanged.",
    );
  });

  test.each(["daily-signal", "weekly-field-note"] as const)(
    "Belle %s omits private editorial frames and compacts public sources",
    async (edition) => {
      const { ctx, runMutation } = queuedContext();
      const args = newsletterArgs(edition);
      const before = JSON.stringify(args);
      await enqueueBelleNewsletterShadowComparison(ctx, args);
      const [reference, queued] = runMutation.mock.calls[0] as unknown as [
        Parameters<typeof getFunctionName>[0],
        { inputJson: string; evaluationJson: string; baselineJson: string },
      ];
      expect(getFunctionName(reference)).toBe("elizaShadowData:enqueue");
      const input = parseShadowInput(queued.inputJson, "belle-newsletter");
      expect(queued.inputJson).not.toMatch(
        /UNPUBLISHED_PRIVATE_|BASELINE_MODEL_ONLY|INITIAL_MODEL_ONLY|PRIVATE_IMAGE_URL/,
      );
      expect(input.prompt).toContain(
        '"headlines":[],"theses":[],"storyIds":[]',
      );
      expect(input.prompt).toContain("publisher-1.example/report");
      expect(input.prompt).not.toContain(args.snapshots[0].articleText);
      expect(queued.evaluationJson).toContain("UNPUBLISHED_PRIVATE_HEADLINE");
      expect(queued.evaluationJson).toContain(args.snapshots[0].articleText);
      expect(queued.baselineJson).toContain('"revisionAccepted":true');
      expect(Buffer.byteLength(queued.inputJson)).toBeLessThanOrEqual(
        ELIZA_SHADOW_INPUT_MAX_BYTES,
      );
      expect(JSON.stringify(args)).toBe(before);
    },
  );

  test("Belle skips an oversized private reference without changing live values", async () => {
    const { ctx, runMutation } = queuedContext();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const args = newsletterArgs();
    args.sources[0].sourceText = "界".repeat(
      Math.ceil(ELIZA_SHADOW_PRIVATE_MAX_BYTES / 3),
    );
    expect(args.sources[0].sourceText.length).toBeLessThan(
      ELIZA_SHADOW_PRIVATE_MAX_BYTES,
    );
    await expect(
      enqueueBelleNewsletterShadowComparison(ctx, args),
    ).resolves.toBeUndefined();
    expect(runMutation).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      "Eliza shadow Belle observation skipped; live newsletter unchanged.",
    );
    expect(args.baseline.draft.subject).toContain("Practical checkpoints");
  });

  test.each([
    ["daily-signal", 18],
    ["weekly-field-note", 28],
  ] as const)(
    "keeps the full %s source count inside transfer bounds",
    async (edition, count) => {
      const { ctx, runMutation } = queuedContext();
      const args = newsletterArgs(edition);
      args.snapshots = Array.from({ length: count }, (_, index) =>
        source(index + 1),
      );
      args.sources = args.snapshots.map((snapshot, index) => ({
        hnItemId: index + 1,
        host: snapshot.sourceName,
        sourceText: snapshot.articleText,
      }));
      await enqueueBelleNewsletterShadowComparison(ctx, args);
      expect(runMutation).toHaveBeenCalledTimes(1);
      const queued = runMutation.mock.calls[0][1] as {
        inputJson: string;
        evaluationJson: string;
      };
      const input = parseShadowInput(queued.inputJson, "belle-newsletter");
      expect(input.prompt).toContain(`publisher-${count}.example/report`);
      expect(Buffer.byteLength(queued.inputJson)).toBeLessThanOrEqual(
        ELIZA_SHADOW_INPUT_MAX_BYTES,
      );
      expect(Buffer.byteLength(queued.evaluationJson)).toBeLessThanOrEqual(
        ELIZA_SHADOW_PRIVATE_MAX_BYTES,
      );
    },
  );

  test("Belle enqueue failure cannot reject the accepted live draft", async () => {
    const { ctx, runMutation } = queuedContext();
    runMutation.mockRejectedValue(new Error("SECRET_WORKER_ERROR"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      enqueueBelleNewsletterShadowComparison(ctx, newsletterArgs()),
    ).resolves.toBeUndefined();
    expect(runMutation).toHaveBeenCalledTimes(1);
  });
});

describe("deterministic shadow evaluation", () => {
  test("compares the same reply without network calls or semantic-review claims", async () => {
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network-prohibited"));
    const { args } = await queuedSuki();
    const before = args.baselineJson;
    expect(
      evaluateShadowComparison({ ...args, outputJson: JSON.stringify(reply) }),
    ).toMatchObject({
      valid: true,
      semanticReviewPerformed: false,
      eligibleForAutomaticPromotion: false,
      decisionAgreement: true,
      shadow: {
        schemaValid: true,
        deterministicValid: true,
        effectiveDecision: "reply",
      },
    });
    expect(network).not.toHaveBeenCalled();
    expect(args.baselineJson).toBe(before);
  });

  test("rejects malformed structured output and unsafe public-copy markup", async () => {
    const { args } = await queuedSuki();
    expect(
      evaluateShadowComparison({
        ...args,
        outputJson: JSON.stringify({ decision: "reply", body: "incomplete" }),
      }),
    ).toMatchObject({ valid: false, shadow: { schemaValid: false } });
    expect(
      evaluateShadowComparison({
        ...args,
        outputJson: JSON.stringify({
          ...reply,
          body: "[b]Start here: compare the request identities before changing retry configuration.",
        }),
      }),
    ).toMatchObject({
      valid: false,
      shadow: { schemaValid: true, deterministicValid: false },
    });
  });

  test("records evidence abstention and decision disagreement for an unsupported correction", async () => {
    const { args } = await queuedSuki();
    expect(
      evaluateShadowComparison({
        ...args,
        outputJson: JSON.stringify({
          ...reply,
          contribution: "correction",
          evidenceSourceUrls: ["https://unknown.example/report"],
          evidenceExcerpt: "A statement without retrieved evidence.",
        }),
      }),
    ).toMatchObject({
      valid: false,
      decisionAgreement: false,
      shadow: { effectiveDecision: "ignore", errors: ["unretrieved-evidence"] },
    });
  });

  test("reuses the AI-source numeric grounding guard", async () => {
    const { args } = await queuedSuki();
    const context = JSON.parse(args.evaluationJson);
    context.candidate.authorIsAgent = true;
    expect(
      evaluateShadowComparison({
        ...args,
        evaluationJson: JSON.stringify(context),
        outputJson: JSON.stringify({
          ...reply,
          body: "This design improves throughput by 99% under load.",
        }),
      }),
    ).toMatchObject({ valid: false, shadow: { deterministicValid: false } });
  });

  test.each(["daily-signal", "weekly-field-note"] as const)(
    "scores Belle %s with the same source evidence and explicit reduced-context limitations",
    async (edition) => {
      const { ctx, runMutation } = queuedContext();
      const args = newsletterArgs(edition);
      await enqueueBelleNewsletterShadowComparison(ctx, args);
      const queued = runMutation.mock.calls[0][1] as unknown as {
        kind: "belle-newsletter";
        inputJson: string;
        evaluationJson: string;
        baselineJson: string;
      };
      expect(
        evaluateShadowComparison({
          ...queued,
          outputJson: JSON.stringify(args.baseline.draft),
        }),
      ).toMatchObject({
        semanticReviewPerformed: false,
        eligibleForAutomaticPromotion: false,
        scoreDelta: 0,
        wordCountDelta: 0,
        baseline: {
          schemaValid: true,
          score: args.baseline.evaluation.quality.score,
        },
        contextLimitations: expect.arrayContaining([
          expect.stringContaining("1500 characters"),
          expect.stringContaining(
            "unpublished editorial context stays in Convex",
          ),
        ]),
      });
    },
  );

  test("Belle rejects selected IDs outside the original source packet", async () => {
    const { ctx, runMutation } = queuedContext();
    const args = newsletterArgs();
    await enqueueBelleNewsletterShadowComparison(ctx, args);
    const queued = runMutation.mock.calls[0][1] as unknown as {
      kind: "belle-newsletter";
      inputJson: string;
      evaluationJson: string;
      baselineJson: string;
    };
    const draft = structuredClone(args.baseline.draft);
    draft.stories[0].hnItemId = 999;
    expect(
      evaluateShadowComparison({
        ...queued,
        outputJson: JSON.stringify(draft),
      }),
    ).toMatchObject({ valid: false, shadow: { deterministicValid: false } });
  });

  test("a wrong kind or invalid JSON fails closed without echoing content", async () => {
    const { args } = await queuedSuki();
    const result = evaluateShadowComparison({
      ...args,
      kind: "belle-newsletter",
      outputJson: "SECRET_INVALID_JSON",
    });
    expect(result).toMatchObject({
      valid: false,
      evaluationFailed: true,
      semanticReviewPerformed: false,
    });
    expect(JSON.stringify(result)).not.toContain("SECRET_INVALID_JSON");
  });
});
