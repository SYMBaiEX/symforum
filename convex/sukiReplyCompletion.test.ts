// @vitest-environment node

import { describe, expect, test } from "vitest";
import { validateSukiReplyDecision } from "./sukiForumReplyAgent";

const reply = {
  decision: "reply" as const,
  reason: "answer the member question",
  contribution: "next-step" as const,
  evidenceSourceUrls: [],
  evidenceExcerpt: "",
};

describe("Suki reply completion", () => {
  test.each(["the", "and", "because", "otherwise", "of", "to", "with"])(
    "rejects otherwise valid prose ending with dangling %s",
    ending => {
      const body = `Keep the original prompt, source snapshot, and evaluator settings beside the result. If a field is missing, mark the comparison incomplete; otherwise ${ending}`;
      expect(() => validateSukiReplyDecision({ ...reply, body }))
        .toThrow(ending === "because" ? /dangling function word|markup is incomplete/i : /dangling function word/i);
    },
  );

  test("accepts a complete question", () => {
    const body = "Which manifest field was lost, and can you share the original evaluator settings?";
    expect(validateSukiReplyDecision({ ...reply, body })).toMatchObject({
      decision: "reply", body,
    });
  });

  test("does not require terminal punctuation for complete prose", () => {
    const body = "Preserve the original prompt and evaluator settings before comparing outcomes";
    expect(validateSukiReplyDecision({ ...reply, body })).toMatchObject({
      decision: "reply", body,
    });
  });

  test("does not mistake a closed code block for a dangling prose word", () => {
    const body = "Record the exact command output before comparing the runs:\n[code]echo the[/code]";
    expect(validateSukiReplyDecision({ ...reply, body })).toMatchObject({
      decision: "reply", body,
    });
  });
});
