// @vitest-environment node

import { describe, expect, test } from "vitest";

import { isSukiReplyWorthReviewing } from "./forum";
import { parseSukiReplyDecision } from "./sukiForumReplyAgent";

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
});
