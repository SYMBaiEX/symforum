import { beforeEach, describe, expect, test, vi } from "vitest";

const serverConvex = vi.hoisted(() => ({
  client: null as null | { query: ReturnType<typeof vi.fn> },
}));

vi.mock("@/lib/server-convex-auth", () => ({
  getAuthenticatedServerConvexClient: async () => serverConvex.client,
}));
vi.mock("@/lib/system-log-server", () => ({
  recordSystemLog: vi.fn(),
  requestLogContext: () => ({}),
}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (callback: () => void) => callback() };
});

import { GET } from "./route";

const request = () =>
  new Request("https://www.symbaiex.com/api/admin/telemetry/model?hours=48");

describe("admin model telemetry route", () => {
  beforeEach(() => {
    serverConvex.client = { query: vi.fn() };
  });

  test("adapts measured snapshot values without inventing unavailable telemetry", async () => {
    serverConvex.client!.query.mockResolvedValue({
      generatedAt: 1_700_000_000_000,
      totals: {
        routeAttempts: 4,
        routeFailures: 1,
        inputTokens: 120,
        outputTokens: 360,
        averageDurationMs: 900,
        p50DurationMs: 800,
        p95DurationMs: 1_400,
      },
      series: [
        {
          at: 1_700_000_000_000,
          generations: 2,
          failures: 1,
          inputTokens: 120,
          outputTokens: 360,
        },
      ],
      recent: [
        {
          kind: "usage",
          at: 1_700_000_001_000,
          correlationId: "suki:1",
          stage: "draft",
          agentSlug: "suki",
          model: "openrouter/test",
          status: "completed",
          durationMs: 800,
          inputTokens: 120,
          outputTokens: 360,
        },
      ],
      operations: { canary: null },
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.model.totals).toMatchObject({
      p50LatencyMs: 800,
      p95LatencyMs: 1_400,
      inputTokens: 120,
      outputTokens: 360,
      averageQueueWaitMs: null,
      p95FirstByteMs: null,
      averageTokensPerSecond: null,
    });
    expect(body.model.speculativeDecoding).toBeNull();
    expect(body.model.keys).toBeNull();
    expect(body.model.series[0]).toMatchObject({
      generationEvents: 2,
      inputTokens: 120,
      outputTokens: 360,
      failed: 1,
    });
    expect(body.model.recent[0]).toMatchObject({
      totalMs: 800,
      inputTokens: 120,
      outputTokens: 360,
    });
  });

  test("returns no-store when authenticated Convex access is unavailable", async () => {
    serverConvex.client = null;
    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Convex is not configured",
    });
  });

  test("returns no-store when the snapshot query fails", async () => {
    serverConvex.client!.query.mockRejectedValue(new Error("owner required"));
    const response = await GET(request());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      error: "OpenRouter telemetry is unavailable",
    });
  });
});
