import { describe, expect, test } from "vitest";
import {
  estimatedModelCostMicroUsd,
  forumDayKey,
  openRouterDailyBudgetMicroUsd,
  spendBucketForKey,
} from "./ai-model-costs";
import { OPENROUTER_LUNA_MODEL } from "./ai-models";

describe("AI model cost controls", () => {
  test("estimates the configured Luna route and rejects unknown models", () => {
    expect(
      estimatedModelCostMicroUsd(OPENROUTER_LUNA_MODEL, 1_000_000, 1_000_000),
    ).toBe(700_000);
    expect(
      estimatedModelCostMicroUsd("nvidia/nemotron-3-super-120b-a12b", 1, 1),
    ).toBe(0);
  });

  test("uses the current OpenRouter GPT-5.6 Luna price", () => {
    expect(
      estimatedModelCostMicroUsd(OPENROUTER_LUNA_MODEL, 1_000_000, 1_000_000),
    ).toBe(700_000);
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
