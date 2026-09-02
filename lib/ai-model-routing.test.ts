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
  OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_GENERATION_MODELS,
  OPENROUTER_PAID_FALLBACK_MODEL,
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
  test("routes every generation stage through the OpenRouter free router then paid fallback", () => {
    expect(OPENROUTER_FREE_GENERATION_MODELS).toEqual(["openrouter/free"]);
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
    expect(OPENROUTER_GENERATION_MODELS).toEqual([
      "openrouter/free",
      OPENROUTER_PAID_FALLBACK_MODEL,
    ]);
  });

  test("creates only the canonical OpenRouter free candidate", async () => {
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

  test("deduplicates candidates and retains the free emergency route", async () => {
    await expect(
      routedModelCandidates(
        { openRouterApiKey: "test-openrouter-key" },
        undefined,
        undefined,
        undefined,
        ["openrouter/free", "openrouter/free"],
      ),
    ).resolves.toHaveLength(1);
    await expect(
      routedModelCandidates({
        openRouterApiKey: "test-openrouter-key",
        disabledModelIds: OPENROUTER_GENERATION_MODELS,
      }),
    ).resolves.toMatchObject([
      { provider: "openrouter", persistedModel: "openrouter/free" },
    ]);
  });

  test("records a completed free-router attempt", async () => {
    const run = vi.fn(async () => "free-result");
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

    expect(result.value).toBe("free-result");
    expect(result.route).toMatchObject({
      provider: "openrouter",
      persistedModel: "openrouter/free",
    });
    expect(run).toHaveBeenCalledTimes(1);
    expect(onAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ outcome: "completed", fallback: false }),
    );
  });

  test("falls back within OpenRouter and marks the paid attempt in telemetry", async () => {
    const onAttempt = vi.fn();
    const result = await runRoutedCandidates(
      OPENROUTER_GENERATION_MODELS.map(candidate),
      {
        stage: "test-openrouter-paid-fallback",
        totalTimeoutMs: 5_000,
        onAttempt,
        run: async (route) => {
          if (route.persistedModel === "openrouter/free")
            throw new Error("free route unavailable");
          return "paid-result";
        },
      },
    );
    expect(result).toMatchObject({
      value: "paid-result",
      route: {
        provider: "openrouter",
        persistedModel: OPENROUTER_PAID_FALLBACK_MODEL,
      },
    });
    expect(onAttempt).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        model: OPENROUTER_PAID_FALLBACK_MODEL,
        outcome: "completed",
        fallback: true,
      }),
    );
  });

  test("uses OpenRouter-native fallbacks before an owner-console stream starts", async () => {
    const selected = await selectStreamingModel({
      openRouterApiKey: "test-openrouter-key",
    });

    expect(selected.persistedModel).toBe(OPENROUTER_GENERATION_MODELS[0]);
    expect(selected.providerOptions).toMatchObject({
      openrouter: { models: [OPENROUTER_PAID_FALLBACK_MODEL] },
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
