// @vitest-environment node
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
const modules = import.meta.glob("./**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
test("worker inspection requests metadata only and never resets an unknown operation", async () => {
  vi.stubEnv("ELIZA_RUNTIME_WORKER_URL", "https://runtime.example");
  vi.stubEnv(
    "ELIZA_RUNTIME_WORKER_SECRET",
    "synthetic-runtime-secret-at-least-32-characters",
  );
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) =>
    ctx.db.insert("elizaRuntimeCalls", {
      jobId: "eliza-status-only",
      inputHash: "a".repeat(64),
      agentSlug: "nyx",
      stage: "nyx:x-draft",
      model: "openai/gpt-6-luna",
      status: "failed",
      outcomeUnknown: true,
      operationKey: "private-intent",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    }),
  );
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://runtime.example/status");
      expect(JSON.parse(init!.body as string)).toEqual({
        jobId: "eliza-status-only",
      });
      return Response.json({
        state: "succeeded",
        completion: { text: "PRIVATE_COMPLETION" },
        receiptDiagnostics: {
          bindingValid: true,
          servedModel: "openai/gpt-6-luna-20260922",
          objectValid: true,
          createdValid: true,
          choiceValid: true,
          contentType: "string",
          toolCallsType: "null",
          usageValid: true,
        },
      });
    },
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await t.action(internal.xAgentDiagnostics.status, {
    agentSlug: "nyx",
  });
  expect(result.receipt?.toolCallsType).toBe("null");
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE|synthetic-runtime/);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(
    (await t.run((ctx) => ctx.db.get("elizaRuntimeCalls", id)))?.status,
  ).toBe("failed");
  expect(
    (await t.run((ctx) => ctx.db.get("elizaRuntimeCalls", id)))?.outcomeUnknown,
  ).toBe(true);
});
test("there is no worker request when no unknown call needs inspection", async () => {
  const t = convexTest(schema, modules);
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  expect(
    await t.action(internal.xAgentDiagnostics.status, { agentSlug: "nyx" }),
  ).toEqual({ httpStatus: 0, code: "no_unknown_call" });
  expect(f).not.toHaveBeenCalled();
});
test.each([true, false])(
  "receipt verification is fresh-completed-only (completed=%s)",
  async (completed) => {
    vi.stubEnv("ELIZA_RUNTIME_WORKER_URL", "https://runtime.example");
    vi.stubEnv(
      "ELIZA_RUNTIME_WORKER_SECRET",
      "synthetic-runtime-secret-at-least-32-characters",
    );
    const t = convexTest(schema, modules);
    const call = {
      jobId: "fresh-completed",
      inputHash: "a".repeat(64),
      agentSlug: "nyx",
      stage: "nyx:x-draft",
      model: "openai/gpt-6-luna",
      operationKey: "fresh-intent",
      inputTokens: 10,
      outputTokens: 5,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
    };
    await t.run((ctx) =>
      ctx.db.insert("elizaRuntimeCalls", {
        ...call,
        status: completed ? "completed" : "failed",
        outcomeUnknown: !completed,
      }),
    );
    const f = vi.fn(async (input, init) => {
      expect(String(input)).toBe("https://runtime.example/receipt");
      expect(JSON.parse(init.body)).toEqual({
        jobId: call.jobId,
        inputHash: call.inputHash,
        agentSlug: call.agentSlug,
        stage: call.stage,
      });
      return Response.json({
        version: 2,
        ...call,
        runtimeVersion: "1.7.2",
        completion: {
          choices: [{ message: { content: "PRIVATE TEXT" } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        },
      });
    });
    vi.stubGlobal("fetch", f);
    const result = await t.action(internal.xAgentDiagnostics.freshReceipt, {
      agentSlug: "nyx",
      jobId: call.jobId,
    });
    expect(result).toEqual({
      httpStatus: completed ? 200 : 0,
      verified: completed,
    });
    expect(f).toHaveBeenCalledTimes(completed ? 1 : 0);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  },
);
