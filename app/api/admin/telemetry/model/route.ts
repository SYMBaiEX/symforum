import { convexRefs } from "@/lib/convex-refs";
import { getAuthenticatedServerConvexClient } from "@/lib/server-convex-auth";
import { recordSystemLog, requestLogContext } from "@/lib/system-log-server";
import { after } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(request: Request) {
  try {
    const convex = await getAuthenticatedServerConvexClient();
    if (!convex) {
      return noStore({ error: "Convex is not configured" }, 503);
    }

    const viewer = await convex.query(convexRefs.admin.viewer, {});
    if (!viewer.user) return noStore({ error: "Sign in required" }, 401);
    if (!viewer.isOwner)
      return noStore({ error: "Owner access required" }, 403);

    const apiKey = process.env.MUSE_API_KEY?.trim();
    const configuredBaseUrl = process.env.MUSE_API_BASE_URL?.trim();
    if (!apiKey || !configuredBaseUrl) {
      return noStore({ error: "Muse telemetry is not configured" }, 503);
    }

    const baseUrl = new URL(configuredBaseUrl);
    const isLocal =
      baseUrl.hostname === "127.0.0.1" || baseUrl.hostname === "localhost";
    if (
      baseUrl.protocol !== "https:" &&
      !(isLocal && baseUrl.protocol === "http:")
    ) {
      return noStore({ error: "Muse telemetry URL is invalid" }, 503);
    }

    const requestedHours = Number(
      new URL(request.url).searchParams.get("hours"),
    );
    const hours = Number.isFinite(requestedHours)
      ? Math.max(1, Math.min(720, Math.floor(requestedHours)))
      : 24;
    const telemetryUrl = new URL(
      `${baseUrl.toString().replace(/\/$/, "")}/telemetry`,
    );
    telemetryUrl.searchParams.set("hours", String(hours));
    const gatewayUrl = new URL("/api/status", baseUrl.origin);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const [telemetryResponse, gatewayResponse] = await Promise.all([
        fetch(telemetryUrl, {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
          },
          cache: "no-store",
          signal: controller.signal,
        }),
        fetch(gatewayUrl, {
          headers: { accept: "application/json" },
          cache: "no-store",
          signal: controller.signal,
        }).catch(() => null),
      ]);

      if (!telemetryResponse.ok) {
        const status =
          telemetryResponse.status === 401 || telemetryResponse.status === 403
            ? 503
            : telemetryResponse.status;
        throw new TelemetryProxyError(
          status,
          telemetryResponse.status === 403
            ? "The configured Muse API key needs telemetry:read scope"
            : `Muse telemetry returned HTTP ${telemetryResponse.status}`,
        );
      }

      const model = await telemetryResponse.json();
      const gateway = gatewayResponse?.ok
        ? await gatewayResponse.json().catch(() => null)
        : null;
      return noStore({ model, gateway }, 200);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const status = error instanceof TelemetryProxyError ? error.status : 503;
    const message =
      error instanceof TelemetryProxyError
        ? error.message
        : error instanceof Error && error.name === "AbortError"
          ? "Muse telemetry timed out"
          : "Muse telemetry is unavailable";
    after(() =>
      recordSystemLog({
        level: "warn",
        source: "server",
        scope: "admin-telemetry",
        eventType: "model_telemetry_request_failed",
        message,
        name: error instanceof Error ? error.name : undefined,
        statusCode: status,
        fingerprint: `admin-telemetry|model|${status}|${message}`,
        ...requestLogContext(request),
      }),
    );
    return noStore({ error: message }, status);
  }
}

function noStore(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

class TelemetryProxyError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
