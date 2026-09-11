import type { AuthConfig } from "convex/server";
import { workosConfig } from "../lib/workos-config";
import {
  serviceAuthEnabled,
  SERVICE_AUTH_ISSUER,
  SERVICE_AUTH_RESOURCE,
} from "../lib/agent-service-auth-config";

const workos = workosConfig(process.env);
const authConfig = {
  providers: [
    ...(serviceAuthEnabled(process.env)
      ? [
          {
            type: "customJwt" as const,
            issuer: SERVICE_AUTH_ISSUER,
            applicationID: SERVICE_AUTH_RESOURCE,
            // Inline public JWKS avoids a frontend/backend discovery bootstrap cycle.
            jwks: `data:application/json;base64,${btoa(process.env.AGENT_SERVICE_AUTH_PUBLIC_JWKS ?? '{"keys":[]}')}`,
            algorithm: "RS256" as const,
          },
        ]
      : []),
    {
      domain: process.env.CONVEX_SITE_URL!,
      applicationID: "convex",
    },
    ...(workos
      ? [
          {
            type: "customJwt" as const,
            issuer: workos.issuer,
            applicationID: workos.audience,
            jwks: workos.jwks,
            algorithm: "RS256" as const,
          },
        ]
      : []),
  ],
} satisfies AuthConfig;

export default authConfig;
