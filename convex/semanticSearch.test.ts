import { describe, expect, test } from "vitest";
import { OPENROUTER_EMBEDDING_MODEL } from "../lib/ai-models";
import { semanticSearchConfig } from "./semanticSearch";

describe("semantic search safety controls", () => {
  test("is disabled unless the explicit feature switch is true", () => {
    expect(semanticSearchConfig({}).enabled).toBe(false);
    expect(semanticSearchConfig({ enabled: "false" }).reason).toMatch(/not true/i);
  });

  test("uses the bounded approved OpenRouter embedding profile", () => {
    const value = semanticSearchConfig({ enabled: "true" });
    expect(value).toMatchObject({
      enabled: true,
      model: OPENROUTER_EMBEDDING_MODEL,
      dailyBudgetMicroUsd: 50_000,
    });
  });

  test("fails closed for an unpriced model or invalid budget", () => {
    expect(
      semanticSearchConfig({ enabled: "true", embeddingModel: "vendor/unpriced" }).enabled,
    ).toBe(false);
    expect(
      semanticSearchConfig({ enabled: "true", dailyBudgetUsd: "99" }).enabled,
    ).toBe(false);
  });
});
