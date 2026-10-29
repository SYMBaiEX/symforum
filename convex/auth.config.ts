import type { AuthConfig } from "convex/server";
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import { IDENTITY_BASE_PATH } from "../lib/identity-config";
import {
  workosAgentRegistrationConfig,
  workosConfig,
} from "../lib/workos-config";
import {
  serviceAuthEnabled,
  SERVICE_AUTH_ISSUER,
  SERVICE_AUTH_RESOURCE,
} from "../lib/agent-service-auth-config";

const workos = workosConfig(process.env);
const workosAgentRegistration = workosAgentRegistrationConfig(process.env);
const workosAuthKitClientId = process.env.WORKOS_CLIENT_ID;
const workosAuthKitJwks = workosAuthKitClientId
  ? `https://api.workos.com/sso/jwks/${workosAuthKitClientId}`
  : null;
const authConfig = {
  providers: [
    ...(workosAuthKitClientId && workosAuthKitJwks
      ? [
          {
            type: "customJwt" as const,
            issuer: "https://api.workos.com/",
            applicationID: workosAuthKitClientId,
            jwks: workosAuthKitJwks,
            algorithm: "RS256" as const,
          },
          {
            type: "customJwt" as const,
            issuer: `https://api.workos.com/user_management/${workosAuthKitClientId}`,
            jwks: workosAuthKitJwks,
            algorithm: "RS256" as const,
          },
        ]
      : []),
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
    ...(process.env.BETTER_AUTH_ENABLED === "true"
      ? [getAuthConfigProvider({ basePath: IDENTITY_BASE_PATH })]
      : [{ domain: process.env.CONVEX_SITE_URL!, applicationID: "convex" }]),
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
      : workosAgentRegistration
        ? [
            {
              type: "customJwt" as const,
              issuer: workosAgentRegistration.issuer,
              applicationID: workosAgentRegistration.audience,
              jwks: workosAgentRegistration.jwks,
              algorithm: "RS256" as const,
            },
          ]
        : []),
  ],
} satisfies AuthConfig;

export default authConfig;
