import { describe, expect, test, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  openRouterModelForStage,
  openRouterModelsForStage,
  routedModelCandidates,
  runRoutedCandidates,
  type RoutedModel,
} from "./ai-model-routing";

function candidate(persistedModel: string): RoutedModel {
  return {
    provider: "openrouter",
    modelId: persistedModel,
    persistedModel,
    model: {} as LanguageModel,
  };
}

describe("OpenRouter-only model routing", () => {
  test("routes forum topic selection to Nano and writing to Super", () => {
    expect(openRouterModelForStage("suki:forum-topic")).toBe(
      "nvidia/nemotron-3-nano-30b-a3b:free",
    );
    expect(openRouterModelForStage("suki:forum-draft")).toBe(
      "nvidia/nemotron-3-super-120b-a12b:free",
    );
    expect(openRouterModelsForStage("suki:forum-topic")).toEqual([
      "nvidia/nemotron-3-nano-30b-a3b:free",
      "nvidia/nemotron-3-nano-30b-a3b",
      "openai/gpt-4.1-mini",
    ]);
  });

  test("only creates OpenRouter candidates and preserves paid fallbacks", async () => {
    const candidates = await routedModelCandidates({
      openRouterApiKey: "test-openrouter-key",
    });

    expect(candidates.map(({ provider }) => provider)).toEqual([
      "openrouter",
      "openrouter",
      "openrouter",
    ]);
    expect(candidates.map(({ persistedModel }) => persistedModel)).toEqual([
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia/nemotron-3-super-120b-a12b",
      "openai/gpt-4.1-mini",
    ]);
  });

  test("skips circuit-disabled OpenRouter models", async () => {
    const candidates = await routedModelCandidates({
      openRouterApiKey: "test-openrouter-key",
      disabledModelIds: ["nvidia/nemotron-3-super-120b-a12b:free"],
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].persistedModel).toBe(
      "nvidia/nemotron-3-super-120b-a12b",
    );
    expect(candidates[1].persistedModel).toBe("openai/gpt-4.1-mini");
  });

  test("falls through OpenRouter models and records the successful attempt", async () => {
    const run = vi.fn(async (route: RoutedModel) => {
      if (route.persistedModel.endsWith(":free")) {
        throw new Error("free route unavailable");
      }
      return "paid-result";
    });
    const onAttempt = vi.fn();
    const result = await runRoutedCandidates(
      [
        candidate("nvidia/nemotron-3-super-120b-a12b:free"),
        candidate("nvidia/nemotron-3-super-120b-a12b"),
      ],
      {
        stage: "test-openrouter-fallback",
        correlationId: "test:route-fallback",
        feature: "routing-test",
        totalTimeoutMs: 5_000,
        run,
        onAttempt,
      },
    );

    expect(result.value).toBe("paid-result");
    expect(result.route).toMatchObject({
      provider: "openrouter",
      persistedModel: "nvidia/nemotron-3-super-120b-a12b",
    });
    expect(run).toHaveBeenCalledTimes(2);
    expect(onAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ outcome: "failed", fallback: false }),
    );
    expect(onAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ outcome: "completed", fallback: true }),
    );
  });

  test("fails clearly when no OpenRouter key is configured", async () => {
    await expect(routedModelCandidates({})).rejects.toThrow(
      /OPENROUTER_API_KEY/,
    );
  });
});
