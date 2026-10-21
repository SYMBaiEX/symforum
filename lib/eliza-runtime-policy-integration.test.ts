// @vitest-environment node

import { generateText, Output } from "ai";
import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import {
  OPENROUTER_NEWSLETTER_MODEL,
  OPENROUTER_NEWSLETTER_PRICE_CEILING,
} from "./ai-models";
import { routedModelCandidates } from "./ai-model-routing";

type LiveWorkerPolicy = {
  liveInputHash(body: Record<string, unknown>): string;
  validateLiveRequest(input: unknown): unknown;
};

async function loadLiveWorkerPolicy(): Promise<LiveWorkerPolicy> {
  const moduleUrl = new URL(
    "../workers/eliza-shadow/src/live.mjs",
    import.meta.url,
  );
  return (await import(moduleUrl.href)) as LiveWorkerPolicy;
}

describe("newsletter SDK to live worker policy boundary", () => {
  test("worker accepts the actual SDK request with caller overrides pinned safely", async () => {
    const requestBodies: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://openrouter.ai/api/v1/chat/completions",
        );
        requestBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        return new Response(
          JSON.stringify({
            id: "newsletter-policy-test",
            object: "chat.completion",
            created: 1_760_000_000,
            model: OPENROUTER_NEWSLETTER_MODEL,
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
      }),
    );

    try {
      const [route] = await routedModelCandidates(
        { openRouterApiKey: "synthetic-test-key" },
        [OPENROUTER_NEWSLETTER_MODEL],
      );
      const generated = await generateText({
        model: route.model,
        prompt: "Return a status object.",
        output: Output.object({
          schema: z.object({ status: z.literal("ok") }),
        }),
        maxOutputTokens: 4_000,
        maxRetries: 0,
        reasoning: "low",
        providerOptions: {
          openrouter: {
            reasoning: { enabled: true },
            provider: {
              allow_fallbacks: true,
              only: ["caller-provider"],
              max_price: { prompt: 1, completion: 1 },
            },
          },
        },
      });

      expect(generated.output).toEqual({ status: "ok" });
      expect(requestBodies).toHaveLength(1);
      const body = requestBodies[0];
      expect(body).toMatchObject({
        model: OPENROUTER_NEWSLETTER_MODEL,
        provider: {
          allow_fallbacks: false,
          only: ["openai"],
          ignore: ["openai/fast", "openai/flex"],
          require_parameters: true,
          max_price: {
            prompt: String(OPENROUTER_NEWSLETTER_PRICE_CEILING.prompt),
            completion: String(OPENROUTER_NEWSLETTER_PRICE_CEILING.completion),
          },
        },
        reasoning: { enabled: false },
      });
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.temperature).toBeUndefined();
      expect(body.top_p).toBeUndefined();
      expect(body.top_k).toBeUndefined();

      const worker = await loadLiveWorkerPolicy();
      const envelope = {
        version: 2,
        jobId: "policy-boundary-test",
        inputHash: worker.liveInputHash(body),
        agentSlug: "system",
        stage: "health-canary",
        body,
      };
      expect(worker.validateLiveRequest(envelope)).toEqual(envelope);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
