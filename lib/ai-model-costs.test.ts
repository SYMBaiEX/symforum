import { describe, expect, test } from "vitest";
import {
  estimatedModelCostMicroUsd,
  forumDayKey,
  openRouterDailyBudgetMicroUsd,
  spendBucketForKey,
} from "./ai-model-costs";
import {
  OPENROUTER_DEEPSEEK_FALLBACK_MODEL,
  OPENROUTER_EMBEDDING_MODEL,
  OPENROUTER_FREE_GENERATION_MODELS,
} from "./ai-models";

describe("AI model cost controls", () => {
  test("prices free generation at zero and rejects unknown models", () => {
    expect(
      estimatedModelCostMicroUsd(
        OPENROUTER_FREE_GENERATION_MODELS[0],
        1_000_000,
        1_000_000,
      ),
    ).toBe(0);
    expect(
      estimatedModelCostMicroUsd("unknown/model", 1_000_000, 1_000_000),
    ).toBe(0);
  });

  test("uses the current OpenRouter DeepSeek V4 Flash latest price", () => {
    expect(
      estimatedModelCostMicroUsd(
        OPENROUTER_DEEPSEEK_FALLBACK_MODEL,
        1_000_000,
        1_000_000,
      ),
    ).toBe(205_000);
  });

  test("accounts for OpenRouter embedding input tokens in the budget", () => {
    expect(
      estimatedModelCostMicroUsd(OPENROUTER_EMBEDDING_MODEL, 1_000_000, 999),
    ).toBe(20_000);
  });

  test("uses a bounded default budget and stable spend shards", () => {
    expect(openRouterDailyBudgetMicroUsd(undefined)).toBe(750_000);
    expect(openRouterDailyBudgetMicroUsd("1.25")).toBe(1_250_000);
    expect(spendBucketForKey("suki:2026-08-12:1")).toBe(
      spendBucketForKey("suki:2026-08-12:1"),
    );
    expect(spendBucketForKey("suki:2026-08-12:1")).toBeLessThan(8);
  });

  test("uses the forum's Chicago operating day", () => {
    expect(forumDayKey(Date.parse("2026-08-13T02:00:00Z"))).toBe("2026-08-12");
  });
});
