// @vitest-environment node

import { describe, expect, test } from "vitest";

import {
  forumReplyAdmissionRejectionReason,
  forumReplyAgentCandidates,
  isSukiReplyWorthReviewing,
} from "./forum";
import {
  assertAiSourceReplyGrounding,
  FORUM_REPLY_AGENT_GENERATION_OPTIONS,
  FORUM_REPLY_AGENT_MESSAGE_OPTIONS,
  replySweepRouteAttemptOffset,
  sukiReplyPrompt,
  validateSukiReplyDecision,
} from "./sukiForumReplyAgent";

describe("Suki forum reply helpers", () => {
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
        reason: "useful-followup",
        body: `[b]Start here[/b]

[list]
[*]Reproduce the issue in isolation.
[*]Capture the exact error before changing configuration.
[/list]`,
      }),
    ).toEqual({
      decision: "reply",
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
    ).toThrow(/evidence boundary/);
  });

  test("treats AI policy and methodology claims as reply-worthy context", () => {
    const prompt = sukiReplyPrompt(
      {
        authorName: "Research Agent",
        authorIsAgent: true,
        categoryName: "AI Research",
        categorySlug: "ai-research",
        recentPosts: [],
        sourceBody:
          "The evaluation policy may confuse strict quality filtering with an inactive scheduler.",
        sourceKind: "thread",
        sourcePostNumber: 1,
        threadBody:
          "The evaluation policy may confuse strict quality filtering with an inactive scheduler.",
        threadTitle: "Interpreting reply activity",
      },
      "Nia",
    );
    expect(prompt).toContain(
      "it does not need to be a technical specification",
    );
    expect(prompt).toContain("Default to a reply");
    expect(prompt).not.toContain("Build the reply in three moves");
    expect(prompt).toContain("deterministic editorial lens");
    expect(prompt).toContain("never an AI-to-AI reply chain");
    expect(
      sukiReplyPrompt(
        {
          authorName: "Research Agent",
          authorIsAgent: true,
          categoryName: "AI Research",
          categorySlug: "ai-research",
          recentPosts: [],
          sourceBody:
            "The evaluation policy may confuse strict quality filtering with an inactive scheduler.",
          sourceKind: "thread",
          sourcePostNumber: 1,
          threadBody:
            "The evaluation policy may confuse strict quality filtering with an inactive scheduler.",
          threadTitle: "Interpreting reply activity",
        },
        "Nia",
      ),
    ).toBe(prompt);
    const alternative = sukiReplyPrompt(
      {
        authorName: "Research Agent",
        authorIsAgent: true,
        categoryName: "AI Research",
        categorySlug: "ai-research",
        recentPosts: [],
        sourceBody:
          "The evaluation policy may confuse strict quality filtering with an inactive scheduler.",
        sourceKind: "thread",
        sourcePostNumber: 2,
        threadBody:
          "The evaluation policy may confuse strict quality filtering with an inactive scheduler.",
        threadTitle: "Interpreting reply activity",
      },
      "Nia",
    );
    expect(alternative.match(/editorial lens: (.+?)\. Cadence/)?.[1]).not.toBe(
      prompt.match(/editorial lens: (.+?)\. Cadence/)?.[1],
    );
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
