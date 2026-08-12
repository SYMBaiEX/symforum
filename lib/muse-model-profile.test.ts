import { describe, expect, test } from "vitest";

import {
  modelGenerationSettings,
  modelInstructions,
  MUSE_TOP_K,
} from "./muse-model-profile";

describe("Muse model profiles", () => {
  test("uses Muse's recommended creative sampling for full forum drafts", () => {
    expect(modelGenerationSettings("muse", "forum-draft")).toEqual({
      temperature: 1,
      topP: 0.95,
    });
    expect(MUSE_TOP_K).toBe(64);
  });

  test("keeps fallback sampling conservative", () => {
    expect(modelGenerationSettings("openrouter", "forum-draft")).toEqual({
      temperature: 0.45,
    });
    expect(modelGenerationSettings("gateway", "forum-draft")).toEqual({
      temperature: 0.45,
    });
  });

  test("adds Muse's exact reasoning control without changing hosted prompts", () => {
    expect(modelInstructions("muse", "newsletter-weekly", "Write it.")).toMatch(
      /^Reasoning strength: xhigh\n\n/,
    );
    expect(modelInstructions("gateway", "newsletter-weekly", "Write it.")).toBe(
      "Write it.",
    );
    expect(
      modelInstructions("openrouter", "newsletter-weekly", "Write it."),
    ).toBe("Write it.");
  });
});
