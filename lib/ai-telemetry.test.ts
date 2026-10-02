import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

import {
  OWNER_ADMIN_AI_STREAM_TIMEOUT,
  OWNER_ADMIN_AI_TELEMETRY,
  ownerAdminAiRuntimeContext,
} from "./ai-telemetry";

describe("owner admin AI telemetry", () => {
  test("uses a stable, privacy-preserving telemetry identity", () => {
    expect(OWNER_ADMIN_AI_TELEMETRY).toMatchObject({
      functionId: "admin.ai.owner-console",
      recordInputs: false,
      recordOutputs: false,
      includeRuntimeContext: { correlationId: true, surface: true },
    });
    expect(ownerAdminAiRuntimeContext("admin-ai:test")).toEqual({
      correlationId: "admin-ai:test",
      surface: "owner-console",
    });
  });

  test("bounds total, step, first-chunk, and idle-chunk stream phases", () => {
    expect(OWNER_ADMIN_AI_STREAM_TIMEOUT).toMatchObject({
      totalMs: 240_000,
      stepMs: 90_000,
      firstChunkMs: 30_000,
      chunkMs: 45_000,
      toolMs: 30_000,
    });
  });

  test("applies telemetry, phase timeouts, and client cancellation to the owner stream", () => {
    const routeSource = readFileSync(
      new URL("../app/api/admin/ai/route.ts", import.meta.url),
      "utf8",
    );

    expect(routeSource).toContain("telemetry: OWNER_ADMIN_AI_TELEMETRY");
    expect(routeSource).toContain(
      "runtimeContext: ownerAdminAiRuntimeContext(correlationId)",
    );
    expect(routeSource).toContain("abortSignal: request.signal");
    expect(routeSource).toContain("timeout: OWNER_ADMIN_AI_STREAM_TIMEOUT");
    expect(routeSource).toContain(
      "prepareStep: async ({ messages, stepNumber })",
    );
    expect(routeSource).toContain("reserveOwnerConsoleStep");
    expect(routeSource).toContain(
      "maxOutputTokens: OWNER_ADMIN_AI_MAX_OUTPUT_TOKENS",
    );
  });

  test("registers AI telemetry with the existing OpenTelemetry provider", () => {
    const instrumentationSource = readFileSync(
      new URL("../instrumentation.ts", import.meta.url),
      "utf8",
    );

    expect(instrumentationSource).toContain('await import("@vercel/otel")');
    expect(instrumentationSource).toContain('await import("@ai-sdk/otel")');
    expect(instrumentationSource).toContain(
      "registerTelemetry(new OpenTelemetry({ runtimeContext: true }))",
    );
  });
});
