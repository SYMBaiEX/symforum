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
