// @vitest-environment node
import { afterEach, describe, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { runStructuredProbe } from "./modelRouting";
import type { ActionCtx } from "./_generated/server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("free-only structured operator probe", () => {
  test.each([true, false])(
    "does not use a paid fallback (valid=%s)",
    async (valid) => {
      vi.stubEnv("OPENROUTER_API_KEY", "synthetic-key");
      const bodies: Record<string, unknown>[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)));
          return new Response(
            JSON.stringify({
              id: "synthetic-probe",
              object: "chat.completion",
              created: 1_760_000_000,
              model: "vendor/served:free",
              choices: [
                {
                  index: 0,
                  message: {
                    role: "assistant",
                    content: valid
                      ? JSON.stringify({
                          topic: "Structured routing health check",
                          title: "Structured routing health check passed",
                          draft:
                            "This synthetic payload validates structured tool submission without publishing a thread or changing any forum content.",
                          sourceUrls: ["https://symbaiex.com/agents.md"],
                          message: "SYMBiEX structured model route healthy",
                        })
                      : null,
                  },
                  finish_reason: valid ? "stop" : "length",
                },
              ],
              usage: {
                prompt_tokens: 100,
                completion_tokens: valid ? 100 : 8000,
                total_tokens: valid ? 200 : 8100,
                completion_tokens_details: {
                  reasoning_tokens: valid ? 0 : 8000,
                },
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }),
      );
      const runMutation = vi.fn(
        async (
          reference: Parameters<typeof getFunctionName>[0],
          args: unknown,
        ) => {
          void reference;
          void args;
          return null;
        },
      );
      const ctx = {
        runQuery: vi.fn(async () => ({ disabledModelIds: [] })),
        runMutation,
      } as unknown as ActionCtx;
      const result = runStructuredProbe(ctx, undefined, true, {
        validationTag: "receipt-protocol-v2",
      });
      if (valid) {
        await expect(result).resolves.toEqual({
          provider: "openrouter",
          model: "vendor/served:free",
          response: "SYMBiEX structured model route healthy",
        });
        const usage = runMutation.mock.calls.find(
          ([reference]) =>
            getFunctionName(reference) ===
            "forumAgentEditorialData:recordUsage",
        );
        expect(usage?.[1]).toMatchObject({
          model: "openrouter/free",
          servedModel: "vendor/served:free",
        });
      } else {
        await expect(result).rejects.toThrow(
          "empty structured output (finish=length",
        );
      }
      expect(bodies).toHaveLength(1);
      expect(JSON.stringify(bodies[0].messages)).toContain(
        "receipt-protocol-v2",
      );
      expect(bodies[0]).toMatchObject({
        model: "openrouter/free",
        max_tokens: 8000,
        provider: { require_parameters: true },
        reasoning: { enabled: false },
      });
    },
  );
  test("invalid diagnostic tags fail before configuration, admission or HTTP", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctx = {} as ActionCtx;
    await expect(
      runStructuredProbe(ctx, undefined, true, {
        validationTag: "invalid tag with whitespace",
      }),
    ).rejects.toThrow("invalid_canary_validation_tag");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("bounds the explicit newsletter structured probe and accounts for its route", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-key");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            id: "synthetic-qwen-probe",
            object: "chat.completion",
            created: 1_760_000_000,
            model: "mistralai/mistral-small-3.2-24b-instruct",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: JSON.stringify({
                    topic: "Structured routing health check",
                    title: "Structured routing health check passed",
                    draft:
                      "This synthetic payload validates the fixed newsletter route and schema contract without publishing a thread or changing any forum content.",
                    sourceUrls: ["https://symbaiex.com/agents.md"],
                    message: "SYMBiEX structured model route healthy",
                  }),
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 100,
              total_tokens: 200,
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
    const runMutation = vi.fn(
      async (
        reference: Parameters<typeof getFunctionName>[0],
        args: unknown,
      ) => {
        if (
          getFunctionName(reference) === "aiRoutingControlData:reserveModelCall"
        ) {
          return { accepted: true, reservationKey: "qwen-probe-reservation" };
        }
        void args;
        return null;
      },
    );
    const ctx = {
      runQuery: vi.fn(async () => ({ disabledModelIds: [] })),
      runMutation,
    } as unknown as ActionCtx;

    await expect(
      runStructuredProbe(ctx, undefined, false, {
        model: "mistralai/mistral-small-3.2-24b-instruct",
      }),
    ).resolves.toEqual({
      provider: "openrouter",
      model: "mistralai/mistral-small-3.2-24b-instruct",
      response: "SYMBiEX structured model route healthy",
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      model: "mistralai/mistral-small-3.2-24b-instruct",
      max_tokens: 8_000,
      provider: {
        require_parameters: true,
        max_price: { prompt: "0.2", completion: "0.5" },
      },
    });
    expect(bodies[0].reasoning).toBeUndefined();
    expect(bodies[0].reasoning_effort).toBeUndefined();

    const reservation = runMutation.mock.calls.find(
      ([reference]) =>
        getFunctionName(reference) === "aiRoutingControlData:reserveModelCall",
    );
    expect(reservation?.[1]).toMatchObject({
      model: "mistralai/mistral-small-3.2-24b-instruct",
    });
    const usage = runMutation.mock.calls.find(
      ([reference]) =>
        getFunctionName(reference) === "forumAgentEditorialData:recordUsage",
    );
    expect(usage?.[1]).toMatchObject({
      model: "mistralai/mistral-small-3.2-24b-instruct",
      servedModel: "mistralai/mistral-small-3.2-24b-instruct",
    });
  });

  test("default live canary stays on the health-canary worker route through a model fallback", async () => {
    const workerUrl = "https://eliza-worker.example";
    const workerSecret = "synthetic-worker-secret-that-is-long-enough";
    vi.stubEnv("OPENROUTER_API_KEY", "synthetic-key");
    vi.stubEnv("ELIZA_RUNTIME_MODE", "live");
    vi.stubEnv("ELIZA_RUNTIME_WORKER_URL", workerUrl);
    vi.stubEnv("ELIZA_RUNTIME_WORKER_SECRET", workerSecret);

    const requests: Array<Record<string, unknown>> = [];
    const responses: Array<Record<string, unknown>> = [];
    const workerFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(`${workerUrl}/complete`);
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Bearer ${workerSecret}`,
        );
        const envelope = JSON.parse(String(init?.body)) as Record<
          string,
          unknown
        >;
        requests.push(envelope);
        expect(envelope).toMatchObject({
          version: 2,
          agentSlug: "system",
          stage: "health-canary",
          body: {
            provider: { require_parameters: true },
            response_format: { type: "json_schema" },
          },
        });

        if (requests.length === 1) {
          expect(envelope.body).toMatchObject({ model: "openrouter/free" });
          return Response.json(
            {
              error: "provider_rejected_model",
              providerStatus: 404,
              outcomeUnknown: false,
            },
            { status: 404 },
          );
        }

        expect(envelope.body).toMatchObject({
          model: "~deepseek/deepseek-v4-flash-latest",
        });
        const completion = {
          id: "synthetic-live-canary",
          object: "chat.completion",
          created: 1_760_000_000,
          model: "deepseek/deepseek-v4-flash-latest",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: JSON.stringify({
                  topic: "Structured routing health check",
                  title: "Structured routing health check passed",
                  draft:
                    "This synthetic payload validates a live worker fallback and schema-valid tool submission without publishing a thread or changing forum content.",
                  sourceUrls: ["https://symbaiex.com/agents.md"],
                  message: "SYMBiEX structured model route healthy",
                }),
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 100,
            total_tokens: 200,
          },
        };
        return Response.json({
          ...envelope,
          runtimeVersion: "1.7.2",
          completion,
        });
      },
    );
    vi.stubGlobal("fetch", workerFetch);

    const runQuery = vi.fn(
      async (
        reference: Parameters<typeof getFunctionName>[0],
        _args: unknown,
      ) => {
        const functionName = getFunctionName(reference);
        if (functionName === "elizaRuntimeData:assertOperationReady")
          return null;
        if (functionName === "aiRoutingControlData:readRoutingControl")
          return { disabledModelIds: [] };
        throw new Error(`Unexpected query ${functionName}`);
      },
    );
    const runMutation = vi.fn(
      async (
        reference: Parameters<typeof getFunctionName>[0],
        args: unknown,
      ) => {
        const functionName = getFunctionName(reference);
        if (functionName === "aiRoutingControlData:reserveModelCall")
          return {
            accepted: true,
            reservationKey: "synthetic-paid-route-reservation",
          };
        if (functionName === "elizaRuntimeData:recordReceipt") {
          responses.push(args as Record<string, unknown>);
          return null;
        }
        return null;
      },
    );
    const ctx = { runQuery, runMutation } as unknown as ActionCtx;

    await expect(runStructuredProbe(ctx)).resolves.toEqual({
      provider: "openrouter",
      model: "deepseek/deepseek-v4-flash-latest",
      response: "SYMBiEX structured model route healthy",
    });

    expect(workerFetch).toHaveBeenCalledTimes(2);
    expect(
      requests.map(
        (request) => (request.body as Record<string, unknown>).model,
      ),
    ).toEqual(["openrouter/free", "~deepseek/deepseek-v4-flash-latest"]);
    expect(responses).toHaveLength(2);
    expect(responses[0]).toMatchObject({
      agentSlug: "system",
      stage: "health-canary",
      model: "openrouter/free",
      status: "failed",
      providerStatus: 404,
      outcomeUnknown: false,
    });
    expect(responses[1]).toMatchObject({
      agentSlug: "system",
      stage: "health-canary",
      model: "~deepseek/deepseek-v4-flash-latest",
      servedModel: "deepseek/deepseek-v4-flash-latest",
      status: "completed",
      runtimeVersion: "1.7.2",
      inputTokens: 100,
      outputTokens: 100,
    });
    const recordUsage = runMutation.mock.calls.find(
      ([reference]) =>
        getFunctionName(reference) === "forumAgentEditorialData:recordUsage",
    );
    expect(recordUsage?.[1]).toMatchObject({
      model: "~deepseek/deepseek-v4-flash-latest",
      servedModel: "deepseek/deepseek-v4-flash-latest",
    });
    expect(
      runMutation.mock.calls.filter(
        ([reference]) =>
          getFunctionName(reference) === "elizaRuntimeData:reserveCall",
      ),
    ).toHaveLength(2);
    expect(
      runQuery.mock.calls.map(([reference]) => getFunctionName(reference)),
    ).toEqual(
      expect.arrayContaining([
        "elizaRuntimeData:assertOperationReady",
        "aiRoutingControlData:readRoutingControl",
      ]),
    );
  });
});
