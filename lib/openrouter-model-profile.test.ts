import { describe, expect, test } from "vitest";

import {
  modelGenerationSettings,
  modelInstructions,
} from "./openrouter-model-profile";

describe("OpenRouter model profiles", () => {
  test("uses the editorial sampling profile for forum drafts", () => {
    expect(modelGenerationSettings("openrouter", "forum-draft")).toEqual({
      temperature: 0.3,
    });
    expect(modelGenerationSettings("openrouter", "forum-revision")).toEqual({
      temperature: 0.2,
    });
  });

  test("adds bounded reasoning guidance to hosted prompts", () => {
    expect(
      modelInstructions("openrouter", "newsletter-weekly", "Write it."),
    ).toMatch(/^Reasoning strength: xhigh\n\n/);
  });
});
