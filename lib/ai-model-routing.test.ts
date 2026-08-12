import { afterEach, describe, expect, test, vi } from "vitest";
import type { LanguageModel } from "ai";
import {
  clearMuseHealthCacheForTests,
  openRouterModelForStage,
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
  provider: "openrouter" | "muse" | "gateway",
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
  test("routes forum topic selection to Nano and writing to Super", () => {
    expect(openRouterModelForStage("suki:forum-topic")).toBe(
      "nvidia/nemotron-3-nano-30b-a3b:free",
    );
    expect(openRouterModelForStage("suki:forum-draft")).toBe(
      "nvidia/nemotron-3-super-120b-a12b:free",
    );
  });

  test("puts OpenRouter before Muse and the paid gateway", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as typeof fetch;
    const candidates = await routedModelCandidates({
      openRouterApiKey: "test-openrouter-key",
      museBaseUrl: "https://agent.example.com/v1",
      museApiKey: "test-muse-key",
      gatewayApiKey: "test-gateway-key",
    });

    expect(candidates.map(({ provider }) => provider)).toEqual([
      "openrouter",
      "muse",
      "gateway",
    ]);
    expect(candidates[0].persistedModel).toBe(
      "nvidia/nemotron-3-super-120b-a12b:free",
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

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

  test("falls through OpenRouter and Muse and records the gateway completion", async () => {
    const run = vi.fn(async (route: RoutedModel) => {
      if (route.provider !== "gateway") throw new Error("route unavailable");
      return "fallback-result";
    });
    const onAttempt = vi.fn();
    const result = await runRoutedCandidates(
      [
        candidate("openrouter", "nvidia/nemotron:free"),
        candidate("muse", "muse/Muse-Glimmer-30B"),
        candidate("gateway", "deepseek/fallback"),
      ],
      {
        stage: "test-fallback",
        correlationId: "test:route-fallback",
        feature: "routing-test",
        totalTimeoutMs: 5_000,
        run,
        onAttempt,
      },
    );

    expect(result.value).toBe("fallback-result");
    expect(result.route).toMatchObject({
      provider: "gateway",
      persistedModel: "deepseek/fallback",
    });
    expect(run).toHaveBeenCalledTimes(3);
    expect(onAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        correlationId: "test:route-fallback",
        outcome: "failed",
        fallback: false,
      }),
    );
    expect(onAttempt).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        correlationId: "test:route-fallback",
        outcome: "completed",
        fallback: true,
      }),
    );
  });

  test("marks an explicitly gateway-only continuation as a fallback", async () => {
    const onAttempt = vi.fn();
    const result = await runRoutedCandidates(
      [candidate("gateway", "deepseek/fallback")],
      {
        stage: "test-gateway-continuation",
        totalTimeoutMs: 5_000,
        attemptOffset: 1,
        run: async () => "gateway-result",
        onAttempt,
      },
    );

    expect(result.route.provider).toBe("gateway");
    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ attempt: 2, fallback: true }),
    );
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

  test("omits optional attribution provider options from gateway fallbacks", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("{}", { status: 200 }),
    ) as typeof fetch;
    const candidates = await routedModelCandidates(
      {
        museBaseUrl: "https://agent.example.com/v1",
        museApiKey: "test-muse-key",
        gatewayApiKey: "test-gateway-key",
      },
      {
        user: "iris-kellan",
        tags: ["agent:iris-kellan", "feature:forum-writing"],
      },
    );

    expect(candidates[1]).toMatchObject({
      provider: "gateway",
    });
    expect(candidates[1].providerOptions).toBeUndefined();
  });
});
