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
    const onAttempt = vi.fn();
    const result = await runRoutedCandidates(
      [
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
    expect(run).toHaveBeenCalledTimes(2);
    expect(onAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        correlationId: "test:route-fallback",
        outcome: "failed",
        fallback: false,
      }),
    );
    expect(onAttempt).toHaveBeenNthCalledWith(
      2,
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
