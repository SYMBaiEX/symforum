import { describe, expect, test } from "vitest";
import {
  estimatedModelCostMicroUsd,
  forumDayKey,
  hasModelPrice,
  openRouterBillingModel,
  openRouterDailyBudgetMicroUsd,
  spendBucketForKey,
} from "./ai-model-costs";
import {
  OPENROUTER_EMBEDDING_MODEL,
  OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_GENERATION_MODELS,
  OPENROUTER_PAID_FALLBACK_MODEL,
} from "./ai-models";

describe("AI model cost controls", () => {
  test("the retired GPT pilot has no allowed price or configured generation route", () => {
    expect(hasModelPrice("openai/gpt-4.1-mini")).toBe(false);
    expect(OPENROUTER_GENERATION_MODELS).not.toContain("openai/gpt-4.1-mini");
  });
  test("prices free generation at zero and rejects unknown models", () => {
    for (const model of OPENROUTER_FREE_GENERATION_MODELS) {
      expect(estimatedModelCostMicroUsd(model, 1_000_000, 1_000_000)).toBe(0);
    }
    expect(
      estimatedModelCostMicroUsd("unknown/model", 1_000_000, 1_000_000),
    ).toBe(0);
  });

  test("every configured generation and embedding route has explicit pricing", () => {
    for (const model of [
      ...OPENROUTER_GENERATION_MODELS,
      OPENROUTER_EMBEDDING_MODEL,
    ]) {
      expect(hasModelPrice(model), `${model} must have a price policy`).toBe(
        true,
      );
    }
    expect(hasModelPrice("unknown/model")).toBe(false);
  });

  test("accounts for OpenRouter embedding input tokens in the budget", () => {
    expect(
      estimatedModelCostMicroUsd(OPENROUTER_EMBEDDING_MODEL, 1_000_000, 999),
    ).toBe(20_000);
  });

  test("rounds positive sub-micro-dollar usage up instead of undercounting it", () => {
    expect(estimatedModelCostMicroUsd(OPENROUTER_EMBEDDING_MODEL, 1, 0)).toBe(
      1,
    );
    expect(
      estimatedModelCostMicroUsd(OPENROUTER_PAID_FALLBACK_MODEL, 1, 0),
    ).toBe(1);
    expect(
      estimatedModelCostMicroUsd(OPENROUTER_FREE_GENERATION_MODELS[0], 1, 1),
    ).toBe(0);
  });

  test("accounts for the OpenRouter paid fallback in the shared budget", () => {
    expect(
      estimatedModelCostMicroUsd(OPENROUTER_PAID_FALLBACK_MODEL, 1_000_000, 0),
    ).toBe(5_775);
    expect(
      estimatedModelCostMicroUsd(OPENROUTER_PAID_FALLBACK_MODEL, 0, 1_000_000),
    ).toBe(1_600_000);
    expect(
      estimatedModelCostMicroUsd(
        OPENROUTER_PAID_FALLBACK_MODEL,
        1_000_000,
        1_000_000,
      ),
    ).toBe(1_605_775);
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
