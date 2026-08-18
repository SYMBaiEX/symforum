import { describe, expect, test, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  openRouterModelForStage,
  openRouterModelsForStage,
  routedModelCandidates,
  runRoutedCandidates,
  type RoutedModel,
} from "./ai-model-routing";
import { OPENROUTER_LUNA_MODEL } from "./ai-models";

function candidate(persistedModel: string): RoutedModel {
  return {
    provider: "openrouter",
    modelId: persistedModel,
    persistedModel,
    model: {} as LanguageModel,
  };
}

describe("OpenRouter-only model routing", () => {
  test("routes forum topic, draft, and revision stages to Luna", () => {
    expect(openRouterModelForStage("suki:forum-topic")).toBe(
      OPENROUTER_LUNA_MODEL,
    );
    expect(openRouterModelForStage("suki:forum-draft")).toBe(
      OPENROUTER_LUNA_MODEL,
    );
    expect(openRouterModelForStage("suki:forum-revision-light")).toBe(
      OPENROUTER_LUNA_MODEL,
    );
    expect(openRouterModelsForStage("suki:forum-topic")).toEqual([
      OPENROUTER_LUNA_MODEL,
    ]);
  });

  test("only creates the canonical OpenRouter Luna candidate", async () => {
    const candidates = await routedModelCandidates({
      openRouterApiKey: "test-openrouter-key",
    });

    expect(candidates.map(({ provider }) => provider)).toEqual(["openrouter"]);
    expect(candidates.map(({ persistedModel }) => persistedModel)).toEqual([
      OPENROUTER_LUNA_MODEL,
    ]);
  });

  test("deduplicates configured Luna candidates and fails closed when disabled", async () => {
    await expect(
      routedModelCandidates(
        { openRouterApiKey: "test-openrouter-key" },
        undefined,
        undefined,
        undefined,
        [OPENROUTER_LUNA_MODEL, OPENROUTER_LUNA_MODEL],
      ),
    ).resolves.toHaveLength(1);
    await expect(
      routedModelCandidates({
        openRouterApiKey: "test-openrouter-key",
        disabledModelIds: [OPENROUTER_LUNA_MODEL],
      }),
    ).rejects.toThrow(/No enabled AI model route/);
  });

  test("records the successful Luna attempt", async () => {
    const run = vi.fn(async () => "luna-result");
    const onAttempt = vi.fn();
    const result = await runRoutedCandidates(
      [candidate(OPENROUTER_LUNA_MODEL)],
      {
        stage: "test-openrouter-fallback",
        correlationId: "test:route-fallback",
        feature: "routing-test",
        totalTimeoutMs: 5_000,
        run,
        onAttempt,
      },
    );

    expect(result.value).toBe("luna-result");
    expect(result.route).toMatchObject({
      provider: "openrouter",
      persistedModel: OPENROUTER_LUNA_MODEL,
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ outcome: "completed", fallback: false }),
    );
  });

  test("fails clearly when no OpenRouter key is configured", async () => {
    await expect(routedModelCandidates({})).rejects.toThrow(
      /OPENROUTER_API_KEY/,
    );
  });
});
