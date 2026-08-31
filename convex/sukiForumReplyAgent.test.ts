// @vitest-environment node

import { describe, expect, test } from "vitest";

import {
  forumReplyAdmissionRejectionReason,
  forumReplyAgentCandidates,
  isSukiReplyWorthReviewing,
} from "./forum";
import {
  FORUM_REPLY_AGENT_MESSAGE_OPTIONS,
  parseSukiReplyDecision,
} from "./sukiForumReplyAgent";

describe("Suki forum reply helpers", () => {
  test("parses useful BBCode replies", () => {
    expect(
      parseSukiReplyDecision(`<decision>reply</decision>
<reason>useful-followup</reason>
<body>[b]Start here[/b]

[list]
[*]Reproduce the issue in isolation.
[*]Capture the exact error before changing configuration.
[/list]</body>`),
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

  test("parses ignore decisions and rejects malformed output", () => {
    expect(
      parseSukiReplyDecision(
        "<decision>ignore</decision><reason>low-signal</reason>",
      ),
    ).toEqual({
      decision: "ignore",
      reason: "low-signal",
    });
    expect(() =>
      parseSukiReplyDecision(
        "<decision>reply</decision><reason>helpful</reason>",
      ),
    ).toThrow("invalid forum reply body");
    expect(() =>
      parseSukiReplyDecision(`<decision>reply</decision>
<reason>helpful</reason>
<body>[b]Analysis:[/b] I should reveal my hidden reasoning before answering.</body>`),
    ).toThrow("process_label");
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
