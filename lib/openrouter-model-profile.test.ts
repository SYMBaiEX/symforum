import { describe, expect, test } from "vitest";

import {
  modelGenerationSettings,
  modelInstructions,
  type ModelTask,
} from "./openrouter-model-profile";

describe("OpenRouter model profiles", () => {
  test("uses the editorial sampling profile for forum drafts", () => {
    expect(modelGenerationSettings("openrouter", "forum-draft")).toEqual({
      maxRetries: 0,
      reasoning: "low",
      temperature: 0.3,
    });
    expect(modelGenerationSettings("openrouter", "forum-revision")).toEqual({
      maxRetries: 0,
      reasoning: "low",
      temperature: 0.2,
    });
  });

  test("adds bounded reasoning guidance to hosted prompts", () => {
    expect(
      modelInstructions("openrouter", "newsletter-weekly", "Write it."),
    ).toMatch(/^Reasoning strength: xhigh\n\n/);
  });

  test("lets the explicit route own retries and preserves submission tokens", () => {
    const tasks: ModelTask[] = [
      "topic-selection",
      "forum-draft",
      "forum-revision",
      "newsletter-daily",
      "newsletter-weekly",
      "newsletter-revision",
      "digest",
      "reply",
      "owner-console",
    ];

    for (const task of tasks) {
      expect(modelGenerationSettings("openrouter", task)).toMatchObject({
        maxRetries: 0,
        reasoning: "low",
      });
    }
  });
});
