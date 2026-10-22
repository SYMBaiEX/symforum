import { generateText, Output, tool, ToolLoopAgent } from "ai";
import { afterEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  routedModelCandidates,
  runWithModelFallback,
} from "./ai-model-routing";
import { elizaRuntimeFetch } from "./eliza-runtime-transport";
import { OPENROUTER_NEWSLETTER_MODEL } from "./ai-models";
import { ELIZA_EDITORIAL_PERSONAS } from "./eliza-runtime-personas";

const origin = "https://eliza-worker.example";
const workerSecret = "private-worker-secret-32-characters-long";
const config = {
  openRouterApiKey: "provider-key-must-not-leak",
  elizaRuntime: { url: origin, secret: workerSecret },
};
const context = {
  agentSlug: "suki",
  stage: "suki:forum-draft",
  correlationId: "private-correlation",
};

function completion(model = "openrouter/free", content = "hello") {
  return {
    id: "chatcmpl-eliza-test",
    object: "chat.completion",
    created: 1_760_000_000,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 9, completion_tokens: 2, total_tokens: 11 },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("Eliza live compatible transport", () => {
  test.each(["belle", "system"])(
    "carries the price-capped newsletter SDK request and receipt for %s",
    async (agentSlug) => {
      const onRequest = vi.fn();
      const onReceipt = vi.fn();
      const workerFetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const envelope = JSON.parse(String(init?.body));
          expect(envelope).toMatchObject({
            version: 2,
            agentSlug,
            body: {
              model: OPENROUTER_NEWSLETTER_MODEL,
              provider: {
                require_parameters: true,
                max_price: { prompt: "0.2", completion: "0.5" },
              },
            },
          });
          expect(envelope.body.reasoning).toEqual({ effort: "low", exclude: true });
          expect(envelope.body.reasoning_effort).toBeUndefined();
          expect(onRequest).toHaveBeenCalledTimes(1);
          return Response.json({
            ...envelope,
            runtimeVersion: "1.7.2",
            completion: completion(
              OPENROUTER_NEWSLETTER_MODEL,
              '{"status":"ok"}',
            ),
          });
        },
      );
      vi.stubGlobal("fetch", workerFetch);
      const [route] = await routedModelCandidates(
        {
          ...config,
          elizaRuntime: { ...config.elizaRuntime, onRequest, onReceipt },
        },
        [OPENROUTER_NEWSLETTER_MODEL],
        {
          agentSlug,
          stage:
            agentSlug === "belle"
              ? "belle:daily-signal:draft"
              : "health-canary",
        },
      );
      const result = await generateText({
        model: route.model,
        prompt: "Return ok.",
        output: Output.object({
          schema: z.object({ status: z.literal("ok") }),
        }),
        maxOutputTokens: 8000,
        maxRetries: 0,
        reasoning: "low",
      });
      expect(result.output).toEqual({ status: "ok" });
      expect(workerFetch).toHaveBeenCalledTimes(1);
      expect(onReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          model: OPENROUTER_NEWSLETTER_MODEL,
          servedModel: OPENROUTER_NEWSLETTER_MODEL,
          status: "completed",
          runtimeVersion: "1.7.2",
        }),
      );
    },
  );

  test("does not admit a bounded model request for unknown personas", async () => {
    const workerFetch = vi.fn();
    const onRequest = vi.fn();
    vi.stubGlobal("fetch", workerFetch);
    const [route] = await routedModelCandidates(
      { ...config, elizaRuntime: { ...config.elizaRuntime, onRequest } },
      [OPENROUTER_NEWSLETTER_MODEL],
      { ...context, agentSlug: "unknown-persona", stage: "unknown-persona:forum-draft" },
    );
    await expect(
      generateText({
        model: route.model,
        prompt: "No request.",
        maxRetries: 0,
      }),
    ).rejects.toThrow("model_not_allowed");
    expect(onRequest).not.toHaveBeenCalled();
    expect(workerFetch).not.toHaveBeenCalled();
  });

  test.each([
    ...ELIZA_EDITORIAL_PERSONAS.flatMap(slug =>
      ["topic", "draft", "revision", "revision-light", "evidence-review", "reply", "reply-evidence-review"].map(stage => [slug, stage])),
    ["bags-scout", "draft"],
    ["bags-scout", "evidence-review"],
    ["pumpfun-scout", "draft"],
    ["pumpfun-scout", "evidence-review"],
  ])("carries bounded Luna only for %s forum %s", async (agentSlug, suffix) => {
    const stage = `${agentSlug}:forum-${suffix}`;
    const onRequest = vi.fn();
    const onReceipt = vi.fn();
    const workerFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const envelope = JSON.parse(String(init?.body));
        expect(envelope).toMatchObject({ agentSlug, stage });
        expect(envelope.body.model).toBe(OPENROUTER_NEWSLETTER_MODEL);
        expect(envelope.body.reasoning).toEqual({ effort: "low", exclude: true });
        expect(envelope.body.provider).toEqual({
          require_parameters: true,
          allow_fallbacks: false,
          only: ["openai"],
          ignore: ["openai/fast", "openai/flex"],
          max_price: { prompt: "0.2", completion: "0.5" },
        });
        expect(envelope.body.response_format.type).toBe("json_schema");
        expect(envelope.body.temperature).toBeUndefined();
        expect(envelope.body.top_p).toBeUndefined();
        expect(envelope.body.reasoning_effort).toBeUndefined();
        expect(onRequest).toHaveBeenCalledTimes(1);
        return Response.json({
          ...envelope,
          runtimeVersion: "1.7.2",
          completion: completion(OPENROUTER_NEWSLETTER_MODEL, '{"status":"ok"}'),
        });
      },
    );
    vi.stubGlobal("fetch", workerFetch);
    const [route] = await routedModelCandidates(
      {
        ...config,
        elizaRuntime: { ...config.elizaRuntime, onRequest, onReceipt },
      },
      [OPENROUTER_NEWSLETTER_MODEL],
      { agentSlug, stage },
    );
    const result = await generateText({
      model: route.model,
      prompt: "Return ok.",
      output: Output.object({ schema: z.object({ status: z.enum(["ok"]) }) }),
      maxOutputTokens: 4_000,
      maxRetries: 0,
      reasoning: "high",
      temperature: 0.8,
      topP: 0.9,
    });
    expect(result.output).toEqual({ status: "ok" });
    expect(workerFetch).toHaveBeenCalledTimes(1);
    expect(onReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSlug,
        stage,
        model: OPENROUTER_NEWSLETTER_MODEL,
        status: "completed",
      }),
    );
  });

  test.each(["bags-scout", "pumpfun-scout"])(
    "rejects foreign or non-pilot Luna stages for %s before dispatch",
    async (agentSlug) => {
      const onRequest = vi.fn();
      const workerFetch = vi.fn();
      vi.stubGlobal("fetch", workerFetch);
      const otherScout = agentSlug === "bags-scout" ? "pumpfun-scout" : "bags-scout";
      for (const stage of [
        `${agentSlug}:forum-topic`,
        `${agentSlug}:forum-revision`,
        `${agentSlug}:forum-reply`,
        `${agentSlug}:forum-evidence-review-extra`,
        `${otherScout}:forum-draft`,
        `${otherScout}:forum-evidence-review`,
        "belle:daily-signal:draft",
        "health-canary",
      ]) {
        const transport = elizaRuntimeFetch(
          { ...config.elizaRuntime, onRequest },
          { agentSlug, stage },
        );
        await expect(
          transport("https://provider.example", {
            body: JSON.stringify({
              model: OPENROUTER_NEWSLETTER_MODEL,
              max_tokens: 100,
              messages: [{ role: "user", content: "No request." }],
            }),
          }),
        ).rejects.toThrow("model_not_allowed");
      }
      expect(onRequest).not.toHaveBeenCalled();
      expect(workerFetch).not.toHaveBeenCalled();
    },
  );

  test("forwards the SDK-transformed history and structured schema privately and returns usage", async () => {
    const receipts: unknown[] = [];
    const workerFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(`${origin}/complete`);
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe(`Bearer ${workerSecret}`);
        expect(init?.redirect).toBe("error");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        expect(headers.has("HTTP-Referer")).toBe(false);
        const raw = String(init?.body);
        expect(raw).not.toContain("provider-key-must-not-leak");
        expect(raw).not.toContain(workerSecret);
        const envelope = JSON.parse(raw);
        expect(envelope).toMatchObject({
          version: 2,
          agentSlug: "suki",
          stage: "suki:forum-draft",
        });
        expect(envelope.jobId).toMatch(/^eliza-/);
        expect(envelope.inputHash).toMatch(/^[0-9a-f]{64}$/);
        expect(envelope.body).toMatchObject({
          model: "openrouter/free",
          messages: [
            { role: "user", content: "Private history one" },
            { role: "assistant", content: "Private history two" },
            { role: "user", content: "Return JSON" },
          ],
          provider: { require_parameters: true },
          response_format: { type: "json_schema" },
        });
        return Response.json({
          ...envelope,
          runtimeVersion: "1.7.2",
          completion: completion("openrouter/free", '{"status":"ok"}'),
        });
      },
    );
    vi.stubGlobal("fetch", workerFetch);
    const [candidate] = await routedModelCandidates(
      {
        ...config,
        elizaRuntime: {
          ...config.elizaRuntime,
          onReceipt: (receipt) => {
            receipts.push(receipt);
          },
        },
      },
      ["openrouter/free"],
      context,
    );
    const writer = new ToolLoopAgent({
      id: "eliza-transport-test",
      model: candidate.model,
      maxRetries: 0,
      maxOutputTokens: 200,
      output: Output.object({ schema: z.object({ status: z.literal("ok") }) }),
    });
    const result = await writer.generate({
      messages: [
        { role: "user", content: "Private history one" },
        { role: "assistant", content: "Private history two" },
        { role: "user", content: "Return JSON" },
      ],
    });
    expect(result.output).toEqual({ status: "ok" });
    expect(result.totalUsage).toMatchObject({
      inputTokens: 9,
      outputTokens: 2,
    });
    expect(receipts).toMatchObject([
      {
        status: "completed",
        runtimeVersion: "1.7.2",
        inputTokens: 9,
        outputTokens: 2,
      },
    ]);
    expect(workerFetch).toHaveBeenCalledTimes(1);
  });

  test("worker uncertainty never sends a second model candidate or the direct provider", async () => {
    const workerFetch = vi.fn(async () =>
      Response.json(
        { error: "outcome_unknown", outcomeUnknown: true },
        { status: 409 },
      ),
    );
    vi.stubGlobal("fetch", workerFetch);
    await expect(
      runWithModelFallback(
        config,
        {
          agent: "suki",
          stage: "suki:forum-draft",
          totalTimeoutMs: 10_000,
          run: async (candidate) =>
            generateText({
              model: candidate.model,
              prompt: "Private prompt",
              maxOutputTokens: 200,
              maxRetries: 0,
            }),
        },
        ["openrouter/free", "~deepseek/deepseek-v4-flash-latest"],
      ),
    ).rejects.toThrow();
    expect(workerFetch).toHaveBeenCalledTimes(1);
  });

  test("preserves tool definitions and parses returned tool calls through the SDK", async () => {
    const workerFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const envelope = JSON.parse(String(init?.body));
        expect(envelope.body.provider).toEqual({ require_parameters: true });
        expect(envelope.body.tools).toMatchObject([
          {
            type: "function",
            function: {
              name: "lookup",
              parameters: expect.objectContaining({ type: "object" }),
            },
          },
        ]);
        return Response.json({
          ...envelope,
          runtimeVersion: "1.7.2",
          completion: {
            ...completion(),
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call-1",
                      type: "function",
                      function: {
                        name: "lookup",
                        arguments: '{"query":"private"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
        });
      },
    );
    vi.stubGlobal("fetch", workerFetch);
    const [candidate] = await routedModelCandidates(
      config,
      ["openrouter/free"],
      context,
    );
    const result = await generateText({
      model: candidate.model,
      prompt: "Use lookup",
      maxOutputTokens: 200,
      maxRetries: 0,
      tools: { lookup: tool({ inputSchema: z.object({ query: z.string() }) }) },
    });
    expect(result.toolCalls).toMatchObject([
      { toolName: "lookup", input: { query: "private" } },
    ]);
    expect(workerFetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    "provider_rejected",
    "provider_rejected_parameter",
    "provider_rejected_schema",
    "provider_rejected_no_endpoints",
    "provider_rejected_price",
    "provider_rejected_account",
    "provider_rejected_model",
    "provider_rejected_rate_tokens",
    "provider_rejected_rate_requests",
    "provider_rejected_rate_concurrency",
    "provider_rejected_rate_upstream",
    "provider_rejected_rate_account",
    "provider_rejected_rate_generic",
  ])(
    "only explicit fixed provider rejection %s permits budgeted candidate fallback",
    async (errorCode) => {
      const onReceipt = vi.fn();
      const workerFetch = vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          const envelope = JSON.parse(String(init?.body));
          const providerStatus = errorCode.startsWith("provider_rejected_rate_")
            ? 429
            : 404;
          return envelope.body.model === "openrouter/free"
            ? Response.json(
                {
                  error: errorCode,
                  providerStatus,
                  outcomeUnknown: false,
                },
                { status: providerStatus },
              )
            : Response.json({
                ...envelope,
                runtimeVersion: "1.7.2",
                completion: completion(envelope.body.model),
              });
        },
      );
      vi.stubGlobal("fetch", workerFetch);
      const result = await runWithModelFallback(
        { ...config, elizaRuntime: { ...config.elizaRuntime, onReceipt } },
        {
          agent: "suki",
          stage: "suki:forum-draft",
          totalTimeoutMs: 90_000,
          run: async (candidate) =>
            generateText({
              model: candidate.model,
              prompt: "Hello",
              maxOutputTokens: 200,
              maxRetries: 0,
            }),
        },
        ["openrouter/free", "~deepseek/deepseek-v4-flash-latest"],
      );
      expect(result.route.modelId).toBe("~deepseek/deepseek-v4-flash-latest");
      expect(workerFetch).toHaveBeenCalledTimes(2);
      expect(onReceipt).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          status: "failed",
          providerStatus: errorCode.startsWith("provider_rejected_rate_")
            ? 429
            : 404,
          outcomeUnknown: false,
        }),
      );
    },
  );

  test("keeps a fixed rejection diagnosis visible without arbitrary provider text", async () => {
    const onReceipt = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "provider_rejected_parameter",
            providerStatus: 400,
            outcomeUnknown: false,
          },
          { status: 400 },
        ),
      ),
    );
    const [route] = await routedModelCandidates(
      { ...config, elizaRuntime: { ...config.elizaRuntime, onReceipt } },
      ["openrouter/free"],
      context,
    );
    await expect(
      generateText({
        model: route.model,
        prompt: "x",
        maxRetries: 0,
        maxOutputTokens: 200,
      }),
    ).rejects.toThrow(
      "Provider rejected request (provider_rejected_parameter)",
    );
    expect(onReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        providerStatus: 400,
        outcomeUnknown: false,
      }),
    );
  });

  test("does not recognize arbitrary diagnostic prefixes as provider rejection", async () => {
    const onReceipt = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "provider_rejected_schema_private-reflection",
            providerStatus: 400,
            outcomeUnknown: false,
          },
          { status: 400 },
        ),
      ),
    );
    const [route] = await routedModelCandidates(
      { ...config, elizaRuntime: { ...config.elizaRuntime, onReceipt } },
      ["openrouter/free"],
      context,
    );
    await expect(
      generateText({
        model: route.model,
        prompt: "x",
        maxRetries: 0,
        maxOutputTokens: 200,
      }),
    ).rejects.toThrow("worker_failure");
    expect(onReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        providerStatus: undefined,
        outcomeUnknown: false,
      }),
    );
  });

  test("mismatched receipts fail closed without exposing response content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const envelope = JSON.parse(String(init?.body));
        return Response.json({
          ...envelope,
          inputHash: "wrong",
          runtimeVersion: "1.7.2",
          completion: completion(),
        });
      }),
    );
    const [candidate] = await routedModelCandidates(
      config,
      ["openrouter/free"],
      context,
    );
    await expect(
      generateText({
        model: candidate.model,
        prompt: "Secret prompt",
        maxOutputTokens: 200,
        maxRetries: 0,
      }),
    ).rejects.toThrow();
  });

  test("canonical hash is stable across object key order and streaming fails before I/O", async () => {
    const workerFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ error: "worker_busy" }, { status: 503 }),
    );
    vi.stubGlobal("fetch", workerFetch);
    const transport = elizaRuntimeFetch(config.elizaRuntime, context);
    const bodyA = {
      model: "openrouter/free",
      max_tokens: 200,
      messages: [{ role: "user", content: "x" }],
      nested: { Z: 1, a: 2, "10": 3, "2": 4 },
    };
    const bodyB = {
      nested: { "2": 4, "10": 3, a: 2, Z: 1 },
      messages: [{ content: "x", role: "user" }],
      model: "openrouter/free",
      max_tokens: 200,
    };
    await expect(
      transport("unused", { body: JSON.stringify(bodyA) }),
    ).rejects.toThrow("worker_failure");
    await expect(
      transport("unused", { body: JSON.stringify(bodyB) }),
    ).rejects.toThrow("worker_failure");
    const first = JSON.parse(String(workerFetch.mock.calls[0][1]?.body));
    const second = JSON.parse(String(workerFetch.mock.calls[1][1]?.body));
    expect(first.inputHash).toBe(second.inputHash);
    await expect(
      transport("unused", { body: JSON.stringify({ ...bodyA, stream: true }) }),
    ).rejects.toThrow("streaming_unsupported");
    expect(workerFetch).toHaveBeenCalledTimes(2);
  });

  test("rejects oversized envelopes before any worker call", async () => {
    const workerFetch = vi.fn();
    vi.stubGlobal("fetch", workerFetch);
    const transport = elizaRuntimeFetch(config.elizaRuntime, context);
    await expect(
      transport("unused", {
        body: JSON.stringify({
          model: "openrouter/free",
          max_tokens: 200,
          messages: [{ role: "user", content: "x".repeat(130 * 1024) }],
        }),
      }),
    ).rejects.toThrow("request_too_large");
    expect(workerFetch).not.toHaveBeenCalled();
  });

  test("rejects malformed usage and model receipts as uncertain outcomes", async () => {
    const receipts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const envelope = JSON.parse(String(init?.body));
        return Response.json({
          ...envelope,
          runtimeVersion: "1.7.2",
          completion: {
            ...completion(),
            model: "wrong/paid-model",
            usage: { prompt_tokens: -1, completion_tokens: 2 },
          },
        });
      }),
    );
    const transport = elizaRuntimeFetch(
      {
        ...config.elizaRuntime,
        onReceipt: (receipt) => {
          receipts.push(receipt);
        },
      },
      context,
    );
    await expect(
      transport("unused", {
        body: JSON.stringify({
          model: "openrouter/free",
          max_tokens: 200,
          messages: [{ role: "user", content: "x" }],
        }),
      }),
    ).rejects.toThrow("invalid_receipt");
    expect(receipts).toMatchObject([
      { status: "failed", outcomeUnknown: true },
    ]);
  });

  test("accepts only the known bounded paid alias resolution", async () => {
    let servedModel = "deepseek/deepseek-v4-flash-0731";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const envelope = JSON.parse(String(init?.body));
        return Response.json({
          ...envelope,
          runtimeVersion: "1.7.2",
          completion: completion(servedModel),
        });
      }),
    );
    const transport = elizaRuntimeFetch(config.elizaRuntime, context);
    const init = {
      body: JSON.stringify({
        model: "~deepseek/deepseek-v4-flash-latest",
        max_tokens: 200,
        messages: [{ role: "user", content: "x" }],
      }),
    };
    expect((await transport("unused", init)).status).toBe(200);
    servedModel = "other/paid-model";
    await expect(transport("unused", init)).rejects.toThrow("invalid_receipt");
  });

  test("accepts only the catalogued GPT-6 Luna dated snapshot alias", async () => {
    let servedModel = "openai/gpt-6-luna-20260922";
    const receipts: Array<{ servedModel?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const envelope = JSON.parse(String(init?.body));
        return Response.json({
          ...envelope,
          runtimeVersion: "1.7.2",
          completion: completion(servedModel),
        });
      }),
    );
    const transport = elizaRuntimeFetch(
      {
        ...config.elizaRuntime,
        onReceipt: (receipt) => {
          receipts.push(receipt);
        },
      },
      { ...context, agentSlug: "system", stage: "health-canary" },
    );
    const init = {
      body: JSON.stringify({
        model: "openai/gpt-6-luna",
        max_tokens: 200,
        messages: [{ role: "user", content: "x" }],
      }),
    };
    expect((await transport("unused", init)).status).toBe(200);
    expect(receipts[0]).toMatchObject({
      model: "openai/gpt-6-luna",
      servedModel: "openai/gpt-6-luna-20260922",
    });
    servedModel = "openai/gpt-6-luna-20261001";
    await expect(transport("unused", init)).rejects.toThrow("invalid_receipt");
    servedModel = "openai/gpt-6-mini";
    await expect(transport("unused", init)).rejects.toThrow("invalid_receipt");
    servedModel = "openai/gpt-6-luna";
    expect((await transport("unused", init)).status).toBe(200);
  });

  test("cancels an oversized worker response stream", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(257 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream)),
    );
    const transport = elizaRuntimeFetch(config.elizaRuntime, context);
    await expect(
      transport("unused", {
        body: JSON.stringify({
          model: "openrouter/free",
          max_tokens: 200,
          messages: [{ role: "user", content: "x" }],
        }),
      }),
    ).rejects.toThrow("invalid_response");
    expect(cancelled).toBe(true);
  });

  test("redirect handling is fail-closed and never follows a new origin", async () => {
    const workerFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        throw new TypeError("redirect blocked");
      },
    );
    vi.stubGlobal("fetch", workerFetch);
    const transport = elizaRuntimeFetch(config.elizaRuntime, context);
    await expect(
      transport("unused", {
        body: JSON.stringify({
          model: "openrouter/free",
          max_tokens: 200,
          messages: [{ role: "user", content: "x" }],
        }),
      }),
    ).rejects.toThrow("outcome_unknown");
    expect(workerFetch).toHaveBeenCalledTimes(1);
  });

  test("durably claims the operation before network I/O and fails closed if claim fails", async () => {
    const events: string[] = [];
    const workerFetch = vi.fn(async () => {
      events.push("fetch");
      return Response.json({ error: "worker_busy" }, { status: 503 });
    });
    vi.stubGlobal("fetch", workerFetch);
    const requestBody = JSON.stringify({
      model: "openrouter/free",
      max_tokens: 200,
      messages: [{ role: "user", content: "x" }],
    });
    const transport = elizaRuntimeFetch(
      {
        ...config.elizaRuntime,
        onRequest: async (request) => {
          expect(request).toMatchObject({
            agentSlug: "suki",
            stage: "suki:forum-draft",
            model: "openrouter/free",
            inputHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          });
          events.push("claim");
        },
      },
      context,
    );
    await expect(transport("unused", { body: requestBody })).rejects.toThrow(
      "worker_failure",
    );
    expect(events).toEqual(["claim", "fetch"]);
    workerFetch.mockClear();
    const unavailable = elizaRuntimeFetch(
      {
        ...config.elizaRuntime,
        onRequest: () => {
          throw new Error("secret database detail");
        },
      },
      context,
    );
    await expect(unavailable("unused", { body: requestBody })).rejects.toThrow(
      "operation_unavailable",
    );
    expect(workerFetch).not.toHaveBeenCalled();
  });

  test("a completed worker result cannot reach the caller when receipt persistence fails", async () => {
    const workerFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const envelope = JSON.parse(String(init?.body));
        return Response.json({
          ...envelope,
          runtimeVersion: "1.7.2",
          completion: completion(),
        });
      },
    );
    vi.stubGlobal("fetch", workerFetch);
    const onRequest = vi.fn(async () => {});
    const onReceipt = vi.fn(async () => {
      throw new Error("database details must not escape");
    });
    await expect(
      runWithModelFallback(
        {
          ...config,
          elizaRuntime: { ...config.elizaRuntime, onRequest, onReceipt },
        },
        {
          agent: "suki",
          stage: "suki:forum-draft",
          totalTimeoutMs: 20_000,
          run: async (candidate) =>
            generateText({
              model: candidate.model,
              prompt: "private",
              maxOutputTokens: 200,
              maxRetries: 0,
            }),
        },
        ["openrouter/free", "~deepseek/deepseek-v4-flash-latest"],
      ),
    ).rejects.toThrow();
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onReceipt).toHaveBeenCalledTimes(1);
    expect(workerFetch).toHaveBeenCalledTimes(1);
  });

  test("requires a bounded output limit before operation claim or network I/O", async () => {
    const onRequest = vi.fn();
    const workerFetch = vi.fn();
    vi.stubGlobal("fetch", workerFetch);
    const transport = elizaRuntimeFetch(
      { ...config.elizaRuntime, onRequest },
      context,
    );
    for (const limit of [undefined, 0, 40_001, 1.5]) {
      const body = {
        model: "openrouter/free",
        messages: [{ role: "user", content: "x" }],
        ...(limit === undefined ? {} : { max_tokens: limit }),
      };
      await expect(
        transport("unused", { body: JSON.stringify(body) }),
      ).rejects.toThrow("invalid_output_limit");
    }
    expect(onRequest).not.toHaveBeenCalled();
    expect(workerFetch).not.toHaveBeenCalled();
  });

  test("rejects removed fixed GPT before durable intent or network I/O", async () => {
    const onRequest = vi.fn();
    const workerFetch = vi.fn();
    vi.stubGlobal("fetch", workerFetch);
    const transport = elizaRuntimeFetch(
      { ...config.elizaRuntime, onRequest },
      context,
    );
    await expect(
      transport("unused", {
        body: JSON.stringify({
          model: "openai/gpt-4.1-mini",
          max_tokens: 200,
          messages: [{ role: "user", content: "x" }],
        }),
      }),
    ).rejects.toThrow("model_not_allowed");
    expect(onRequest).not.toHaveBeenCalled();
    expect(workerFetch).not.toHaveBeenCalled();
  });

  test.each(["provider_rejected", "provider_rejected_schema"])(
    "reported provider 408 (%s) cannot trigger SDK or route fallback",
    async (errorCode) => {
      const receipts: unknown[] = [];
      const workerFetch = vi.fn(async () =>
        Response.json(
          {
            error: errorCode,
            providerStatus: 408,
            outcomeUnknown: false,
          },
          { status: 408 },
        ),
      );
      vi.stubGlobal("fetch", workerFetch);
      await expect(
        runWithModelFallback(
          {
            ...config,
            elizaRuntime: {
              ...config.elizaRuntime,
              onReceipt: (receipt) => {
                receipts.push(receipt);
              },
            },
          },
          {
            agent: "suki",
            stage: "suki:forum-draft",
            totalTimeoutMs: 20_000,
            run: async (candidate) =>
              generateText({
                model: candidate.model,
                prompt: "x",
                maxOutputTokens: 200,
                maxRetries: 2,
              }),
          },
          ["openrouter/free", "~deepseek/deepseek-v4-flash-latest"],
        ),
      ).rejects.toThrow();
      expect(workerFetch).toHaveBeenCalledTimes(1);
      expect(receipts).toMatchObject([
        { status: "failed", outcomeUnknown: true },
      ]);
    },
  );
});
