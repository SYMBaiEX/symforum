import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { LanguageModel } from "ai";
import {
  openRouterModelForStage,
  openRouterModelsForStage,
  routedModelCandidates,
  runRoutedCandidates,
  selectStreamingModel,
  type RoutedModel,
} from "./ai-model-routing";
import {
  OPENROUTER_DEEPSEEK_FALLBACK_MODEL,
  OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_GENERATION_MODELS,
} from "./ai-models";

function candidate(persistedModel: string): RoutedModel {
  return {
    provider: "openrouter",
    modelId: persistedModel,
    persistedModel,
    model: {} as LanguageModel,
  };
}

describe("OpenRouter-only model routing", () => {
  test("routes every generation stage through the free-first DeepSeek chain", () => {
    expect(openRouterModelForStage("suki:forum-topic")).toBe(
      OPENROUTER_FREE_GENERATION_MODELS[0],
    );
    expect(openRouterModelForStage("suki:forum-draft")).toBe(
      OPENROUTER_FREE_GENERATION_MODELS[0],
    );
    expect(openRouterModelForStage("suki:forum-revision-light")).toBe(
      OPENROUTER_FREE_GENERATION_MODELS[0],
    );
    expect(openRouterModelsForStage("suki:forum-topic")).toEqual(
      OPENROUTER_GENERATION_MODELS,
    );
  });

  test("creates only the canonical OpenRouter free-first candidates", async () => {
    const candidates = await routedModelCandidates({
      openRouterApiKey: "test-openrouter-key",
    });

    expect(candidates.every(({ provider }) => provider === "openrouter")).toBe(
      true,
    );
    expect(candidates.map(({ persistedModel }) => persistedModel)).toEqual(
      OPENROUTER_GENERATION_MODELS,
    );
  });

  test("deduplicates configured candidates and fails closed when all are disabled", async () => {
    await expect(
      routedModelCandidates(
        { openRouterApiKey: "test-openrouter-key" },
        undefined,
        undefined,
        undefined,
        [
          OPENROUTER_DEEPSEEK_FALLBACK_MODEL,
          OPENROUTER_DEEPSEEK_FALLBACK_MODEL,
        ],
      ),
    ).resolves.toHaveLength(1);
    await expect(
      routedModelCandidates({
        openRouterApiKey: "test-openrouter-key",
        disabledModelIds: OPENROUTER_GENERATION_MODELS,
      }),
    ).rejects.toThrow(/No enabled AI model route/);
  });

  test("keeps both free routes when the paid DeepSeek fallback is disabled", async () => {
    const candidates = await routedModelCandidates({
      openRouterApiKey: "test-openrouter-key",
      disabledModelIds: [OPENROUTER_DEEPSEEK_FALLBACK_MODEL],
    });

    expect(candidates.map(({ persistedModel }) => persistedModel)).toEqual(
      OPENROUTER_FREE_GENERATION_MODELS,
    );
  });

  test("falls through free failures and records the paid DeepSeek completion", async () => {
    const run = vi.fn(async (route: RoutedModel) => {
      if (route.persistedModel !== OPENROUTER_DEEPSEEK_FALLBACK_MODEL) {
        throw new Error("free route unavailable");
      }
      return "deepseek-result";
    });
    const onAttempt = vi.fn();
    const result = await runRoutedCandidates(
      OPENROUTER_GENERATION_MODELS.map(candidate),
      {
        stage: "test-openrouter-fallback",
        correlationId: "test:route-fallback",
        feature: "routing-test",
        totalTimeoutMs: 5_000,
        run,
        onAttempt,
      },
    );

    expect(result.value).toBe("deepseek-result");
    expect(result.route).toMatchObject({
      provider: "openrouter",
      persistedModel: OPENROUTER_DEEPSEEK_FALLBACK_MODEL,
    });
    expect(run).toHaveBeenCalledTimes(3);
    expect(onAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ outcome: "failed", fallback: false }),
    );
    expect(onAttempt).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ outcome: "completed", fallback: true }),
    );
  });

  test("uses OpenRouter-native fallbacks before an owner-console stream starts", async () => {
    const selected = await selectStreamingModel({
      openRouterApiKey: "test-openrouter-key",
    });

    expect(selected.persistedModel).toBe(OPENROUTER_GENERATION_MODELS[0]);
    expect(selected.providerOptions).toEqual({
      openrouter: { models: OPENROUTER_GENERATION_MODELS.slice(1) },
    });
  });

  test("fails clearly when no OpenRouter key is configured", async () => {
    await expect(routedModelCandidates({})).rejects.toThrow(
      /OPENROUTER_API_KEY/,
    );
  });

  test("keeps every active AI client on the direct OpenRouter boundary", () => {
    const files = [
      new URL("./ai-model-routing.ts", import.meta.url),
      new URL("../convex/semanticSearch.ts", import.meta.url),
      new URL("../convex/forumAgentMemory.ts", import.meta.url),
      new URL("../convex/forumAgentMaintenance.ts", import.meta.url),
      new URL("../app/api/admin/ai/route.ts", import.meta.url),
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).toContain("https://openrouter.ai/api/v1");
    expect(source).not.toMatch(
      /api\.deepseek\.com|AI_GATEWAY_API_KEY|MUSE_API|gateway\.ai/i,
    );
    expect(source).not.toMatch(/createAnthropic|createGoogleGenerativeAI/);
  });
});
