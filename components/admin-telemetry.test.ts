import type { AiTelemetrySnapshotRecord } from "@/lib/convex-refs";
import { describe, expect, it } from "vitest";
import { modelTelemetryFromSnapshot } from "./admin-telemetry";

function snapshot(): AiTelemetrySnapshotRecord {
  return {
    generatedAt: 1_000,
    windowHours: 24,
    totals: {
      routeAttempts: 4,
      routeFailures: 1,
      fallbackAttempts: 1,
      agentRuns: 2,
      published: 1,
      skipped: 0,
      failed: 1,
      replies: 0,
      newsletters: 0,
      inputTokens: 100,
      outputTokens: 25,
      averageDurationMs: 20,
      p50DurationMs: 15,
      p95DurationMs: 40,
      averageQuality: 91,
      estimatedSpendUsd: 0.01,
      failedAttemptReserveUsd: 0.002,
      revisionRate: 0,
      averageRevisionGain: 0,
      revisionSamples: 0,
      revisionImprovementRate: 0,
      averagePresentation: 90,
    },
    costCoverage: {
      unpricedRouteAttempts: 0,
      unpricedUsageEvents: 0,
    },
    models: [],
    agents: [],
    stages: [],
    series: [
      {
        at: 900,
        generations: 2,
        failures: 1,
        inputTokens: 100,
        outputTokens: 25,
        estimatedCostMicroUsd: 10,
        failedAttemptReserveMicroUsd: 5,
      },
    ],
    recent: [
      {
        kind: "route",
        at: 950,
        correlationId: "route-1",
        stage: "draft",
        status: "completed",
        inputTokens: 100,
        outputTokens: 25,
      },
    ],
    operations: {
      budget: { dayKey: "2026-09-01", spentUsd: 0.01, limitUsd: 5 },
      circuits: [],
      canary: {
        healthy: true,
        checkedAt: 975,
        pauseUntil: 0,
      },
      embedding: null,
    },
    bounded: {
      routes: false,
      runs: false,
      replies: false,
      usage: false,
      newsletters: false,
    },
  };
}

describe("modelTelemetryFromSnapshot", () => {
  it("derives the model view from a bounded Convex telemetry snapshot", () => {
    const model = modelTelemetryFromSnapshot(snapshot());

    expect(model?.totals).toMatchObject({
      requests: 4,
      completed: 3,
      failed: 1,
      totalTokens: 125,
      p50LatencyMs: 15,
    });
    expect(model?.runtime.latest?.modelHealthy).toBe(true);
    expect(model?.series[0]).toMatchObject({
      generationEvents: 2,
      failed: 1,
    });
    expect(model?.recent[0]?.correlationId).toBe("route-1");
  });

  it("stays unavailable until the requested snapshot resolves", () => {
    expect(modelTelemetryFromSnapshot(undefined)).toBeUndefined();
  });
});
