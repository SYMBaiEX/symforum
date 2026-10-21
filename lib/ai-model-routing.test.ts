import { APICallError, generateText, Output, ToolLoopAgent } from "ai";
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { formatAISchemaDiagnostics } from "./ai-schema-diagnostics";
import {
  openRouterModelForStage,
  openRouterModelsForStage,
  ModelSpendBudgetExceededError,
  openRouterBillingModel,
  openRouterReservationModel,
  openRouterSettlementModel,
  openRouterSettlementRoute,
  routedModelCandidates,
  routedAttemptTimeoutMs,
  runRoutedCandidates,
  selectStreamingModel,
  type RoutedModel,
} from "./ai-model-routing";
import {
  OPENROUTER_FREE_GENERATION_MODELS,
  OPENROUTER_GENERATION_MODELS,
  OPENROUTER_IDEATION_MODELS,
  OPENROUTER_NEWSLETTER_MODEL,
  OPENROUTER_NEWSLETTER_PRICE_CEILING,
  OPENROUTER_PAID_FALLBACK_MODEL,
  openRouterStructuredOutputBudget,
} from "./ai-models";

function candidate(persistedModel: string): RoutedModel {
  return {
    provider: "openrouter",
    modelId: persistedModel,
    persistedModel,
    model: {} as LanguageModel,
  };
}

describe("AI schema diagnostics", () => {
  test("formats only known issue metadata and redacts unknown path keys", () => {
    const diagnostics = formatAISchemaDiagnostics({
      issues: [
        {
          code: "invalid_value",
          values: ["private-enum-value"],
          path: ["claims", 0, "kind"],
          message: "private generated value",
        },
        {
          code: "too_big",
          maximum: 12,
          path: ["claims"],
          message: "private generated value",
        },
        {
          code: "invalid_type",
          expected: "string",
          path: ["private-prompt-field"],
          message: "private generated value",
        },
      ],
    });

    expect(diagnostics).toBe(
      "schemaIssues=enum@claims[0].kind, too_big@claims(max=12), invalid_type@[field](expected=string)",
    );
    expect(diagnostics).not.toContain("private");
  });

  test("bounds issue count and output length across cyclic or malformed cause chains", () => {
    const nested: { issues?: unknown[]; cause?: unknown } = {
      issues: Array.from({ length: 12 }, () => ({
        code: "invalid_value",
        path: ["status"],
        values: ["private"],
      })),
    };
    nested.cause = nested;

    const diagnostics = formatAISchemaDiagnostics({ cause: nested });
    expect(diagnostics?.match(/enum@status/g)).toHaveLength(4);
    expect(diagnostics?.length).toBeLessThanOrEqual(300);
    expect(diagnostics).not.toContain("private");
    expect(formatAISchemaDiagnostics(new Error("private cause message"))).toBe(
      undefined,
    );
    expect(
      formatAISchemaDiagnostics(
        new Proxy(
          {},
          {
            getOwnPropertyDescriptor: () => {
              throw new Error("bad descriptor");
            },
          },
        ),
      ),
    ).toBeUndefined();
  });
});

describe("OpenRouter-only model routing", () => {
  test("settles only explicitly resolved free variants at zero-cost", () => {
    expect(openRouterSettlementRoute("openrouter/free")).toBe("paid");
    expect(openRouterSettlementRoute("qwen/qwen3-235b-a22b:free")).toBe("free");
    expect(openRouterSettlementRoute("deepseek/deepseek-v4-flash-0731")).toBe(
      "paid",
    );
    expect(openRouterSettlementRoute("unexpected-provider-model")).toBe("paid");
    expect(openRouterSettlementModel("free")).toBe("openrouter/free");
    expect(openRouterSettlementModel("paid")).toBe(
      OPENROUTER_PAID_FALLBACK_MODEL,
    );
  });

  test("prices free aliases conservatively and bills ambiguous responses as paid", () => {
    expect(openRouterReservationModel("openrouter/free")).toBe(
      OPENROUTER_PAID_FALLBACK_MODEL,
    );
    expect(openRouterReservationModel("vendor/model:free")).toBe(
      OPENROUTER_PAID_FALLBACK_MODEL,
    );
    expect(openRouterReservationModel(OPENROUTER_PAID_FALLBACK_MODEL)).toBe(
      OPENROUTER_PAID_FALLBACK_MODEL,
    );
    expect(openRouterBillingModel("qwen/qwen3-235b-a22b:free")).toBe(
      "openrouter/free",
    );
    expect(openRouterBillingModel("openrouter/free", "openrouter/free")).toBe(
      "openrouter/free",
    );
    expect(openRouterBillingModel(undefined, "openrouter/free")).toBe(
      "openrouter/free",
    );
    expect(
      openRouterBillingModel("unexpected-provider-model", "openrouter/free"),
    ).toBe(OPENROUTER_PAID_FALLBACK_MODEL);
    expect(
      openRouterBillingModel(undefined, OPENROUTER_PAID_FALLBACK_MODEL),
    ).toBe(OPENROUTER_PAID_FALLBACK_MODEL);
    expect(openRouterBillingModel(undefined)).toBe(
      OPENROUTER_PAID_FALLBACK_MODEL,
    );
  });

  test("routes every generation stage through OpenRouter free first with a paid rescue", () => {
    expect(OPENROUTER_FREE_GENERATION_MODELS).toEqual(["openrouter/free"]);
    expect(openRouterModelForStage("suki:forum-topic")).toBe("openrouter/free");
    expect(openRouterModelForStage("suki:forum-draft")).toBe("openrouter/free");
    expect(openRouterModelForStage("suki:forum-revision-light")).toBe(
      "openrouter/free",
    );
    expect(openRouterModelsForStage("suki:forum-topic")).toEqual(
      OPENROUTER_GENERATION_MODELS,
    );
    expect(OPENROUTER_GENERATION_MODELS).toEqual([
      "openrouter/free",
      OPENROUTER_PAID_FALLBACK_MODEL,
    ]);
    expect(openRouterModelsForStage("operator:brainstorm-ideas")).toEqual(
      OPENROUTER_IDEATION_MODELS,
    );
    expect(
      openRouterStructuredOutputBudget(OPENROUTER_PAID_FALLBACK_MODEL, 3_000),
    ).toBe(6_000);
    expect(openRouterStructuredOutputBudget("openrouter/free", 3_000)).toBe(
      6_000,
    );
    expect(openRouterStructuredOutputBudget("another/model", 3_000)).toBe(
      4_500,
    );
  });

  test("creates only canonical OpenRouter candidates", async () => {
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

  test("keeps the fixed newsletter route separately priced and preserves token limits", () => {
    expect(openRouterReservationModel(OPENROUTER_NEWSLETTER_MODEL)).toBe(
      OPENROUTER_NEWSLETTER_MODEL,
    );
    expect(
      openRouterStructuredOutputBudget(OPENROUTER_NEWSLETTER_MODEL, 4_000),
    ).toBe(8_000);
    expect(
      openRouterStructuredOutputBudget(OPENROUTER_NEWSLETTER_MODEL, 6_000),
    ).toBe(12_000);
    expect(OPENROUTER_GENERATION_MODELS).not.toContain(
      OPENROUTER_NEWSLETTER_MODEL,
    );
  });

  test("enforces the fixed newsletter price ceilings and disables reasoning on the wire", async () => {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            id: "newsletter-price-test",
            object: "chat.completion",
            created: 1_760_000_000,
            model: OPENROUTER_NEWSLETTER_MODEL,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "ok" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
    try {
      const [route] = await routedModelCandidates(
        { openRouterApiKey: "synthetic-key" },
        [OPENROUTER_NEWSLETTER_MODEL],
      );
      await generateText({
        model: route.model,
        prompt: "Return ok.",
        maxOutputTokens: 4_000,
        maxRetries: 0,
        reasoning: "low",
        providerOptions: {
          openrouter: {
            reasoning: { enabled: true },
            provider: {
              allow_fallbacks: true,
              max_price: { prompt: 100, completion: 100 },
            },
          },
        },
      });
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toMatchObject({
        model: OPENROUTER_NEWSLETTER_MODEL,
        max_tokens: 4_000,
        provider: {
          allow_fallbacks: false,
          require_parameters: true,
          max_price: {
            prompt: String(OPENROUTER_NEWSLETTER_PRICE_CEILING.prompt),
            completion: String(OPENROUTER_NEWSLETTER_PRICE_CEILING.completion),
          },
        },
      });
      expect(bodies[0].reasoning).toEqual({ enabled: false });
      expect(bodies[0].reasoning_effort).toBeUndefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("sends structured object generation as strict JSON Schema", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://openrouter.ai/api/v1/chat/completions",
        );
        requestBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        return new Response(
          JSON.stringify({
            id: "chatcmpl-structured-test",
            object: "chat.completion",
            created: 1_760_000_000,
            model: "openrouter/free",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: '{"status":"ok"}' },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const [freeRoute] = await routedModelCandidates(
        { openRouterApiKey: "test-openrouter-key" },
        ["openrouter/free"],
      );
      const writer = new ToolLoopAgent({
        id: "structured-output-test",
        model: freeRoute.model,
        output: Output.object({
          schema: z.object({ status: z.enum(["ok", "failed"]) }),
        }),
        maxRetries: 0,
      });
      const result = await writer.generate({
        prompt: "Return a status object.",
      });

      expect(result.output).toEqual({ status: "ok" });
      expect(requestBodies).toHaveLength(1);
      expect(requestBodies[0].tool_choice).toBeUndefined();
      expect(requestBodies[0].model).toBe("openrouter/free");
      expect(requestBodies[0].provider).toEqual({ require_parameters: true });
      expect(requestBodies[0].reasoning).toEqual({ enabled: false });
      expect(requestBodies[0].reasoning_effort).toBeUndefined();
      expect(requestBodies[0].plugins).toEqual([{ id: "response-healing" }]);
      expect(requestBodies[0].response_format).toMatchObject({
        type: "json_schema",
        json_schema: {
          strict: true,
          schema: expect.objectContaining({ required: ["status"] }),
        },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("deduplicates candidates and retains the free emergency route", async () => {
    await expect(
      routedModelCandidates({ openRouterApiKey: "test-openrouter-key" }, [
        "openrouter/free",
        "openrouter/free",
      ]),
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

  test("records a completed primary attempt", async () => {
    const run = vi.fn(async () => "primary-result");
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

    expect(result.value).toBe("primary-result");
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

  test("carries provider-reported cost through wrapped and multi-step results", async () => {
    const wrapped = await runRoutedCandidates([candidate("openrouter/free")], {
      stage: "test-provider-cost",
      totalTimeoutMs: 5_000,
      run: async () => ({ result: { usage: { raw: { cost: 0.0000006 } } } }),
    });
    expect(wrapped.route.providerReportedCostMicroUsd).toBe(1);

    const multiStep = await runRoutedCandidates(
      [candidate("openrouter/free")],
      {
        stage: "test-provider-cost-multi-step",
        totalTimeoutMs: 5_000,
        run: async () => ({
          steps: [
            { usage: { raw: { cost: 0.0000012 } } },
            { usage: { raw: { cost: 0.0000013 } } },
          ],
        }),
      },
    );
    expect(multiStep.route.providerReportedCostMicroUsd).toBe(3);
  });

  test("does not infer a partial provider bill when one tool-loop step lacks it", async () => {
    const result = await runRoutedCandidates([candidate("openrouter/free")], {
      stage: "test-provider-cost-incomplete",
      totalTimeoutMs: 5_000,
      run: async () => ({
        usage: { raw: { cost: 0.000002 } },
        steps: [
          { usage: { raw: { cost: 0.000001 } } },
          { usage: { raw: { prompt_tokens: 3, completion_tokens: 2 } } },
        ],
      }),
    });
    expect(result.route.providerReportedCostMicroUsd).toBeUndefined();
  });

  test("reserves a priced paid attempt before calling its provider", async () => {
    const paid = candidate(OPENROUTER_PAID_FALLBACK_MODEL);
    const beforeAttempt = vi.fn(async () => "paid-reservation");
    const afterAttempt = vi.fn();
    const result = await runRoutedCandidates([paid], {
      stage: "budgeted-generation",
      totalTimeoutMs: 5_000,
      estimatedInputTokens: 1_000,
      maxOutputTokens: 500,
      beforeAttempt,
      afterAttempt,
      run: async () => "generated",
    });

    expect(beforeAttempt).toHaveBeenCalledWith(paid, {
      inputTokens: 1_000,
      outputTokens: 500,
      estimatedMicroUsd: 806,
    });
    expect(result.route.reservationKey).toBe("paid-reservation");
    expect(afterAttempt).toHaveBeenCalledWith(paid, {
      succeeded: true,
      reservationKey: "paid-reservation",
    });
  });

  test("does not reserve paid spend for a standalone zero-priced free route", async () => {
    const free = candidate("openrouter/free");
    const beforeAttempt = vi.fn(async () => "should-not-reserve");
    const onAttempt = vi.fn();
    const result = await runRoutedCandidates([free], {
      stage: "free-alias-budget",
      totalTimeoutMs: 5_000,
      estimatedInputTokens: 1_000,
      maxOutputTokens: 500,
      beforeAttempt,
      onAttempt,
      run: async () => "generated",
    });

    expect(beforeAttempt).not.toHaveBeenCalled();
    expect(result.route.reservationKey).toBeUndefined();
    expect(result.route.reservationModel).toBeUndefined();
    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedCostMicroUsd: 0 }),
    );
  });

  test("prices the routed alias when OpenRouter returns a versioned model id", async () => {
    const resolvedModelId = "deepseek/deepseek-v4-flash-0731";
    const onAttempt = vi.fn();
    const result = await runRoutedCandidates(
      [candidate(OPENROUTER_PAID_FALLBACK_MODEL)],
      {
        stage: "versioned-provider-model",
        totalTimeoutMs: 5_000,
        estimatedInputTokens: 1_000,
        maxOutputTokens: 500,
        onAttempt,
        run: async () => ({
          modelId: resolvedModelId,
          inputTokens: 1_000,
          outputTokens: 500,
        }),
      },
    );

    expect(result.value.modelId).toBe(resolvedModelId);
    expect(result.route.persistedModel).toBe(OPENROUTER_PAID_FALLBACK_MODEL);
    expect(onAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        model: OPENROUTER_PAID_FALLBACK_MODEL,
        outcome: "completed",
        estimatedCostMicroUsd: 806,
      }),
    );
  });

  test("fails closed when a paid spend reservation is rejected", async () => {
    const run = vi.fn(async () => "must-not-run");
    const onAttempt = vi.fn();
    await expect(
      runRoutedCandidates([candidate(OPENROUTER_PAID_FALLBACK_MODEL)], {
        stage: "budget-denied-generation",
        totalTimeoutMs: 5_000,
        estimatedInputTokens: 1_000,
        maxOutputTokens: 500,
        beforeAttempt: async () => {
          throw new ModelSpendBudgetExceededError("daily-budget");
        },
        onAttempt,
        run,
      }),
    ).rejects.toThrow(/daily-budget/);
    expect(run).not.toHaveBeenCalled();
    expect(onAttempt).not.toHaveBeenCalled();
  });

  test("falls back within OpenRouter and marks the paid rescue in telemetry", async () => {
    const onAttempt = vi.fn();
    const result = await runRoutedCandidates(
      OPENROUTER_GENERATION_MODELS.map(candidate),
      {
        stage: "test-openrouter-paid-fallback",
        totalTimeoutMs: 5_000,
        onAttempt,
        run: async (route) => {
          if (route.persistedModel === "openrouter/free")
            throw new Error("structured route unavailable");
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

  test("offsets retry ordinals without mislabeling the retried primary as fallback", async () => {
    const onAttempt = vi.fn();
    await runRoutedCandidates(OPENROUTER_GENERATION_MODELS.map(candidate), {
      stage: "scheduled-retry-ordinal",
      totalTimeoutMs: 5_000,
      attemptOffset: 2,
      onAttempt,
      run: async (route) => {
        if (route.persistedModel === "openrouter/free") {
          throw new Error("structured response failed");
        }
        return "paid-result";
      },
    });

    expect(onAttempt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        attempt: 3,
        model: "openrouter/free",
        outcome: "failed",
        fallback: false,
      }),
    );
    expect(onAttempt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        attempt: 4,
        model: OPENROUTER_PAID_FALLBACK_MODEL,
        outcome: "completed",
        fallback: true,
      }),
    );
  });

  test.each([401, 402])(
    "does not invoke another model after account-level HTTP %i failures",
    async (statusCode) => {
      const error = new APICallError({
        message: `OpenRouter returned ${statusCode}`,
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        statusCode,
        responseBody: JSON.stringify({
          error: {
            code: statusCode,
            metadata: { raw: "private-provider-payload" },
          },
        }),
      });
      const run = vi.fn(async () => {
        throw error;
      });
      const afterAttempt = vi.fn();
      const onAttempt = vi.fn();

      await expect(
        runRoutedCandidates(OPENROUTER_GENERATION_MODELS.map(candidate), {
          stage: "account-level-provider-failure",
          totalTimeoutMs: 5_000,
          afterAttempt,
          onAttempt,
          run,
        }),
      ).rejects.toBe(error);

      expect(run).toHaveBeenCalledTimes(1);
      expect(afterAttempt).toHaveBeenCalledTimes(1);
      expect(afterAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ persistedModel: "openrouter/free" }),
        { succeeded: false, reservationKey: undefined },
      );
      expect(onAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          outcome: "failed",
          model: "openrouter/free",
        }),
      );
      expect(onAttempt.mock.calls[0]?.[0].errorMessage).toContain(
        `http=${statusCode}`,
      );
      expect(onAttempt.mock.calls[0]?.[0].errorMessage).toContain(
        `code=${statusCode}`,
      );
      expect(onAttempt.mock.calls[0]?.[0].errorMessage).not.toContain(
        "private-provider-payload",
      );
    },
  );

  test.each([400, 403])(
    "keeps model-specific HTTP %i failures eligible for the configured fallback",
    async (statusCode) => {
      const error = new APICallError({
        message: `OpenRouter returned ${statusCode}`,
        url: "https://openrouter.ai/api/v1/chat/completions",
        requestBodyValues: {},
        statusCode,
      });
      const run = vi.fn(async (route: RoutedModel) => {
        if (route.persistedModel === "openrouter/free") throw error;
        return "paid-result";
      });

      await expect(
        runRoutedCandidates(OPENROUTER_GENERATION_MODELS.map(candidate), {
          stage: "model-specific-provider-failure",
          totalTimeoutMs: 5_000,
          run,
        }),
      ).resolves.toMatchObject({
        value: "paid-result",
        route: { persistedModel: OPENROUTER_PAID_FALLBACK_MODEL },
      });
      expect(run).toHaveBeenCalledTimes(2);
    },
  );

  test("reserves a usable structured-generation window for the paid rescue", () => {
    expect(
      routedAttemptTimeoutMs({
        remainingMs: 270_000,
        remainingFallbacks: 1,
        totalTimeoutMs: 270_000,
      }),
    ).toBe(162_000);
    expect(
      routedAttemptTimeoutMs({
        remainingMs: 108_000,
        remainingFallbacks: 0,
        totalTimeoutMs: 270_000,
      }),
    ).toBe(108_000);
  });

  test("uses OpenRouter-native fallbacks before an owner-console stream starts", async () => {
    const selected = await selectStreamingModel({
      openRouterApiKey: "test-openrouter-key",
    });

    expect(selected.persistedModel).toBe("openrouter/free");
    expect(selected.providerOptions).toMatchObject({
      openrouter: { models: [OPENROUTER_PAID_FALLBACK_MODEL] },
    });
  });

  test("keeps disabled provider circuits out of owner-console streaming routes", async () => {
    const selected = await selectStreamingModel({
      openRouterApiKey: "test-openrouter-key",
      disabledModelIds: ["openrouter/free"],
    });

    expect(selected.persistedModel).toBe(OPENROUTER_PAID_FALLBACK_MODEL);
    expect(selected.providerOptions).toBeUndefined();
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
      new URL("../apps/platform/app/api/admin/ai/route.ts", import.meta.url),
    ];
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).toContain("https://openrouter.ai/api/v1");
    expect(source).not.toMatch(
      /api\.deepseek\.com|AI_GATEWAY_API_KEY|MUSE_API|gateway\.ai/i,
    );
    expect(source).not.toMatch(/createAnthropic|createGoogleGenerativeAI/);
  });
});

describe("OpenRouter transport safeguards", () => {
  async function withResponse(
    content: string | null,
    run: (bodies: Record<string, unknown>[]) => Promise<void>,
    finishReason = "stop",
  ) {
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            id: "synthetic-test",
            object: "chat.completion",
            created: 1_760_000_000,
            model: "vendor/served:free",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content },
                finish_reason: finishReason,
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 1500,
              total_tokens: 1510,
              completion_tokens_details: { reasoning_tokens: 1499 },
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
    try {
      await run(bodies);
    } finally {
      vi.unstubAllGlobals();
    }
  }

  test.each([
    { native: { effort: "minimal" }, expected: { effort: "minimal" } },
    {
      native: { max_tokens: 256, exclude: true },
      expected: { max_tokens: 256, exclude: true },
    },
    { native: { enabled: false }, expected: { enabled: false } },
    { native: { exclude: true }, expected: { enabled: false, exclude: true } },
  ])(
    "preserves native reasoning controls: $native",
    async ({ native, expected }) => {
      await withResponse('{"status":"ok"}', async (bodies) => {
        const [route] = await routedModelCandidates(
          { openRouterApiKey: "test" },
          ["openrouter/free"],
        );
        const result = await generateText({
          model: route.model,
          prompt: "Synthetic probe",
          output: Output.object({
            schema: z.object({ status: z.literal("ok") }),
          }),
          reasoning: "low",
          maxRetries: 0,
          providerOptions: {
            openrouter: {
              reasoning: native,
              provider: { order: ["Nvidia"] },
              plugins: [{ id: "web" }, { id: "response-healing" }],
            },
          },
        });
        expect(result.output).toEqual({ status: "ok" });
        expect(bodies[0].reasoning).toEqual(expected);
        expect(bodies[0].reasoning_effort).toBeUndefined();
        expect(bodies[0].provider).toEqual({
          order: ["Nvidia"],
          require_parameters: true,
        });
        expect(bodies[0].plugins).toEqual([
          { id: "web" },
          { id: "response-healing" },
        ]);
      });
    },
  );

  test("translates paid reasoning settings without disabling thinking", async () => {
    await withResponse('{"status":"ok"}', async (bodies) => {
      const [route] = await routedModelCandidates(
        { openRouterApiKey: "test" },
        [OPENROUTER_PAID_FALLBACK_MODEL],
      );
      const result = await generateText({
        model: route.model,
        prompt: "Synthetic probe",
        reasoning: "low",
        output: Output.object({
          schema: z.object({ status: z.literal("ok") }),
        }),
        maxRetries: 0,
      });
      expect(result.output.status).toBe("ok");
      expect(bodies[0].reasoning).toEqual({ effort: "low" });
    });
  });

  test("leaves ordinary text calls free of schema healing", async () => {
    await withResponse("Synthetic response", async (bodies) => {
      const [route] = await routedModelCandidates(
        { openRouterApiKey: "test" },
        ["openrouter/free"],
      );
      const result = await generateText({
        model: route.model,
        prompt: "Synthetic probe",
        reasoning: "low",
        maxRetries: 0,
      });
      expect(result.text).toBe("Synthetic response");
      expect(bodies[0].plugins).toBeUndefined();
      expect(bodies[0].provider).toBeUndefined();
      expect(bodies[0].reasoning).toEqual({ effort: "low" });
    });
  });

  test.each([
    {
      content: null,
      finish: "length",
      diagnostic: "empty structured output",
    },
    {
      content: '{"status":',
      finish: "length",
      diagnostic: "structured output unavailable",
    },
    {
      content: '{"status":"wrong"}',
      finish: "stop",
      diagnostic: "structured output schema validation failed",
    },
  ])(
    "rejects $content and reports $finish without leaking generated content",
    async ({ content, finish, diagnostic }) => {
      await withResponse(
        content,
        async () => {
          const [route] = await routedModelCandidates(
            { openRouterApiKey: "test" },
            ["openrouter/free"],
          );
          const onAttempt = vi.fn();
          await expect(
            runRoutedCandidates([route], {
              stage: "synthetic",
              totalTimeoutMs: 10_000,
              onAttempt,
              run: async (candidate) => {
                const result = await generateText({
                  model: candidate.model,
                  prompt: "Synthetic probe",
                  output: Output.object({
                    schema: z.object({ status: z.literal("ok") }),
                  }),
                  maxRetries: 0,
                });
                return result.output;
              },
            }),
          ).rejects.toThrow("AI generation failed for synthetic");
          const event = onAttempt.mock.calls[0][0];
          expect(event.outcome).toBe("failed");
          expect(event.errorMessage).toContain(`finish=${finish}`);
          expect(event.errorMessage).toContain(diagnostic);
          expect(event.errorMessage).toContain("reasoningTokens=1499");
          expect(event.errorMessage).not.toContain('"wrong"');
          if (diagnostic === "structured output schema validation failed") {
            expect(event.errorMessage).toContain("schemaIssues=enum@status");
            expect(event.errorMessage).not.toContain("Synthetic probe");
          }
        },
        finish,
      );
    },
  );
});

describe("mandatory-reasoning free endpoints", () => {
  test.each([
    {
      status: 400,
      message: "Provider returned error",
      raw: "Reasoning is mandatory for this endpoint and cannot be disabled.",
      explicit: false,
      repeated: false,
      requests: 2,
      success: true,
    },
    {
      status: 200,
      code: 400,
      message: "Provider returned error",
      raw: "Reasoning is mandatory for this endpoint and cannot be disabled.",
      explicit: false,
      repeated: false,
      requests: 2,
      success: true,
    },
    {
      status: 400,
      message:
        "Reasoning is mandatory for this endpoint and cannot be disabled.",
      explicit: false,
      repeated: false,
      requests: 2,
      success: true,
    },
    {
      status: 400,
      message:
        "Reasoning is mandatory for this endpoint and cannot be disabled.",
      explicit: true,
      repeated: false,
      requests: 1,
      success: false,
    },
    {
      status: 400,
      message:
        "Reasoning is mandatory for this endpoint and cannot be disabled.",
      explicit: false,
      repeated: true,
      requests: 2,
      success: false,
    },
    {
      status: 401,
      message:
        "Reasoning is mandatory for this endpoint and cannot be disabled.",
      explicit: false,
      repeated: false,
      requests: 1,
      success: false,
    },
    {
      status: 400,
      message: "Invalid schema.",
      explicit: false,
      repeated: false,
      requests: 1,
      success: false,
    },
  ])(
    "bounded retry: $status, explicit=$explicit, repeated=$repeated",
    async (scenario) => {
      const bodies: Record<string, unknown>[] = [];
      const signals: (AbortSignal | null | undefined)[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)));
          signals.push(init?.signal);
          if (bodies.length === 1 || scenario.repeated) {
            return new Response(
              JSON.stringify({
                error: {
                  message: scenario.message,
                  code: "code" in scenario ? scenario.code : scenario.status,
                  ...("raw" in scenario
                    ? { metadata: { raw: scenario.raw } }
                    : {}),
                },
              }),
              {
                status: scenario.status,
                headers: { "content-type": "application/json" },
              },
            );
          }
          return new Response(
            JSON.stringify({
              id: "retry-test",
              created: 1_760_000_000,
              model: "vendor/reasoning-model:free",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: '{"status":"ok"}' },
                  finish_reason: "stop",
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 100,
                total_tokens: 110,
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }),
      );
      try {
        const [route] = await routedModelCandidates(
          { openRouterApiKey: "test" },
          ["openrouter/free"],
        );
        const result = generateText({
          model: route.model,
          prompt: "Synthetic request",
          maxOutputTokens: 6000,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(10_000),
          output: Output.object({
            schema: z.object({ status: z.literal("ok") }),
          }),
          providerOptions: scenario.explicit
            ? { openrouter: { reasoning: { enabled: false } } }
            : undefined,
        });
        if (scenario.success)
          expect((await result).output).toEqual({ status: "ok" });
        else await expect(result).rejects.toThrow(scenario.message);
        expect(bodies).toHaveLength(scenario.requests);
        expect(bodies.every((body) => body.model === "openrouter/free")).toBe(
          true,
        );
        expect(bodies[0].reasoning).toEqual({ enabled: false });
        if (bodies.length === 2) {
          expect(bodies[1].reasoning).toEqual({ effort: "low" });
          expect(bodies[1].max_tokens).toBe(6000);
          expect(signals[1]).toBe(signals[0]);
        }
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
