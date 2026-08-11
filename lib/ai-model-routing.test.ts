import { afterEach, describe, expect, test, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  clearMuseHealthCacheForTests,
  routedModelCandidates,
  runRoutedCandidates,
  type RoutedModel,
} from "./ai-model-routing";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearMuseHealthCacheForTests();
});

function candidate(
  provider: "muse" | "gateway",
  persistedModel: string,
): RoutedModel {
  return {
    provider,
    modelId: persistedModel,
    persistedModel,
    model: {} as LanguageModel,
  };
}

describe("AI model routing", () => {
  test("uses Muse when the primary route succeeds", async () => {
    const run = vi.fn(async (route: RoutedModel) => `${route.provider}-result`);
    const result = await runRoutedCandidates(
      [
        candidate("muse", "muse/Muse-Glimmer-30B"),
        candidate("gateway", "deepseek/fallback"),
      ],
      { stage: "test-primary", totalTimeoutMs: 5_000, run },
    );

    expect(result.value).toBe("muse-result");
    expect(result.route.provider).toBe("muse");
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("falls back to the gateway and records the route that completed", async () => {
    const run = vi.fn(async (route: RoutedModel) => {
      if (route.provider === "muse") throw new Error("primary unavailable");
      return "fallback-result";
    });
    const result = await runRoutedCandidates(
      [
        candidate("muse", "muse/Muse-Glimmer-30B"),
        candidate("gateway", "deepseek/fallback"),
      ],
      { stage: "test-fallback", totalTimeoutMs: 5_000, run },
    );

    expect(result.value).toBe("fallback-result");
    expect(result.route).toMatchObject({
      provider: "gateway",
      persistedModel: "deepseek/fallback",
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  test("passes Muse's native top_k setting through provider options", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as typeof fetch;
    const [muse] = await routedModelCandidates({
      museBaseUrl: "https://agent.example.com/v1",
      museApiKey: "test-key",
    });

    expect(muse.provider).toBe("muse");
    expect(muse.providerOptions).toEqual({
      symbaiexMuse: { top_k: 64 },
    });
  });
});
