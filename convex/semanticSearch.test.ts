import { describe, expect, test } from "vitest";
import { OPENROUTER_EMBEDDING_MODEL } from "../lib/ai-models";
import {
  isCurrentFingerprint,
  semanticSearchConfig,
  settlementDelta,
} from "./semanticSearch";

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

  test("reconciles a conservative reservation to actual provider usage", () => {
    expect(settlementDelta(100, 60)).toBe(-40);
    expect(settlementDelta(100, 100)).toBe(0);
    expect(settlementDelta(100, 140)).toBe(40);
  });

  test("failure settlement refunds the whole reservation exactly once", () => {
    // The durable operation becomes `refunded`; a replay observes a terminal
    // state and never applies this delta a second time.
    expect(settlementDelta(125, 0)).toBe(-125);
  });

  test("rejects a vector whose public document or source changed", () => {
    expect(isCurrentFingerprint("10:20", 10, 20)).toBe(true);
    expect(isCurrentFingerprint("10:20", 11, 20)).toBe(false);
    expect(isCurrentFingerprint("10:20", 10, 21)).toBe(false);
  });
});
