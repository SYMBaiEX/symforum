import type { HttpRouter } from "convex/server";
import { httpAction, env } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  readServiceAuthBody,
  serviceAuthResponse,
  serviceAuthEnabled,
} from "../lib/agent-service-auth-config";

/** Only the canonical Next relay may supply the trusted network identifier. */
export function addServiceAuthRoutes(http: HttpRouter) {
  for (const operation of [
    "identity",
    "claim",
    "token",
    "revoke",
    "jwks",
  ] as const) {
    http.route({
      path: `/agent-service-auth/${operation}`,
      method: operation === "jwks" ? "GET" : "POST",
      handler: httpAction(async (ctx, request) => {
        if (!serviceAuthEnabled(env))
          return serviceAuthResponse({ error: "not_found" }, 404);
        const secret = env.AGENT_SERVICE_AUTH_RELAY_SECRET;
        if (
          !secret ||
          secret.length < 32 ||
          request.headers.get("x-symbaiex-service-auth-relay") !== secret
        )
          return serviceAuthResponse({ error: "not_found" }, 404);
        const contentType = request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim();
        if (
          operation !== "jwks" &&
          contentType !==
            (operation === "identity" || operation === "claim"
              ? "application/json"
              : "application/x-www-form-urlencoded")
        )
          return serviceAuthResponse({ error: "invalid_request" }, 400);
        let body: string;
        try {
          body = await readServiceAuthBody(request);
        } catch {
          return serviceAuthResponse({ error: "invalid_request" }, 413);
        }
        try {
          const result = await ctx.runAction(
            internal.agentServiceAuthTokens.dispatch,
            {
              operation,
              body,
              source: (
                request.headers.get("x-symbaiex-source") ?? "unknown"
              ).slice(0, 120),
            },
          );
          const response = serviceAuthResponse(null, result.status);
          return new Response(result.body || null, {
            status: result.status,
            headers: response.headers,
          });
        } catch {
          // Never serialize signing errors, request bodies or bearer material.
          return serviceAuthResponse({ error: "temporarily_unavailable" }, 503);
        }
      }),
    });
  }
}
