import { convexRefs } from "@/lib/convex-refs";
import { getAuthenticatedServerConvexClient } from "@/lib/server-convex-auth";
import { recordSystemLog, requestLogContext } from "@/lib/system-log-server";
import { after } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * The owner observatory uses the same OpenRouter route telemetry used by Convex,
 * keeping the dashboard truthful and eliminating a second inference service.
 */
export async function GET(request: Request) {
  try {
    const convex = await getAuthenticatedServerConvexClient();
    if (!convex) return noStore({ error: "Convex is not configured" }, 503);

    const requestedHours = Number(
      new URL(request.url).searchParams.get("hours"),
    );
    const hours = Number.isFinite(requestedHours)
      ? Math.max(1, Math.min(720, Math.floor(requestedHours)))
      : 24;
    const snapshot = await convex.query(convexRefs.admin.aiTelemetrySnapshot, {
      hours,
      now: Date.now(),
    });
    const attempts = snapshot.totals.routeAttempts;
    const failures = snapshot.totals.routeFailures;
    const generatedAt = new Date(snapshot.generatedAt).toISOString();
    const recent = snapshot.recent.map((event, index) => ({
      id: `${event.correlationId ?? "route"}:${event.at}:${index}`,
      at: new Date(event.at).toISOString(),
      type: event.kind,
      correlationId: event.correlationId,
      feature: event.stage,
      agent: event.agentSlug,
      model: event.model,
      outcome: event.status,
      totalMs: event.durationMs,
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
    }));

    return noStore(
      {
        model: {
          generatedAt,
          windowHours: hours,
          retentionDays: 30,
          totals: {
            requests: attempts,
            completed: Math.max(0, attempts - failures),
            failed: failures,
            rejected: null,
            cancelled: null,
            errorRate: attempts ? failures / attempts : 0,
            inputTokens: snapshot.totals.inputTokens,
            outputTokens: snapshot.totals.outputTokens,
            totalTokens:
              snapshot.totals.inputTokens + snapshot.totals.outputTokens,
            averageLatencyMs: snapshot.totals.averageDurationMs,
            p50LatencyMs: snapshot.totals.p50DurationMs,
            p95LatencyMs: snapshot.totals.p95DurationMs,
            averageQueueWaitMs: null,
            p95QueueWaitMs: null,
            averageFirstByteMs: null,
            p95FirstByteMs: null,
            averageTokensPerSecond: null,
            p50TokensPerSecond: null,
          },
          speculativeDecoding: null,
          keys: null,
          series: snapshot.series.map((point) => ({
            at: new Date(point.at).toISOString(),
            generationEvents: point.generations,
            failed: point.failures,
            inputTokens: point.inputTokens,
            outputTokens: point.outputTokens,
          })),
          runtime: {
            latest: snapshot.operations.canary
              ? {
                  id: "openrouter-canary",
                  at: new Date(
                    snapshot.operations.canary.checkedAt,
                  ).toISOString(),
                  modelHealthy: snapshot.operations.canary.healthy,
                }
              : null,
            history: [],
          },
          recent,
          storage: {
            eventCount: attempts,
            oldestAt: recent.at(recent.length - 1)?.at ?? null,
            newestAt: recent.at(0)?.at ?? null,
          },
        },
      },
      200,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "OpenRouter telemetry unavailable";
    after(() =>
      recordSystemLog({
        level: "warn",
        source: "server",
        scope: "admin-telemetry",
        eventType: "model_telemetry_request_failed",
        message,
        name: error instanceof Error ? error.name : undefined,
        statusCode: 503,
        fingerprint: `admin-telemetry|openrouter|503|${message}`,
        ...requestLogContext(request),
      }),
    );
    return noStore({ error: "OpenRouter telemetry is unavailable" }, 503);
  }
}

function noStore(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
