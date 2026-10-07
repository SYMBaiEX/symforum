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
                completion_tokens: valid ? 100 : 6000,
                total_tokens: valid ? 200 : 6100,
                completion_tokens_details: {
                  reasoning_tokens: valid ? 0 : 6000,
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
      const result = runStructuredProbe(ctx, undefined, true);
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
      expect(bodies[0]).toMatchObject({
        model: "openrouter/free",
        max_tokens: 6000,
        provider: { require_parameters: true },
        reasoning: { enabled: false },
      });
    },
  );
});
