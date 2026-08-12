import { describe, expect, test } from "vitest";
import {
  estimatedModelCostMicroUsd,
  forumDayKey,
  openRouterDailyBudgetMicroUsd,
  spendBucketForKey,
} from "./ai-model-costs";

describe("AI model cost controls", () => {
  test("estimates only the configured paid Nemotron routes", () => {
    expect(
      estimatedModelCostMicroUsd(
        "nvidia/nemotron-3-super-120b-a12b",
        1_000_000,
        1_000_000,
      ),
    ).toBe(485_000);
    expect(
      estimatedModelCostMicroUsd(
        "nvidia/nemotron-3-super-120b-a12b:free",
        1_000_000,
        1_000_000,
      ),
    ).toBe(0);
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
