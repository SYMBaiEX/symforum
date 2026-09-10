import type { AuthConfig } from "convex/server";
import { workosConfig } from "../lib/workos-config";

const workos = workosConfig(process.env);
const authConfig = {
  providers: [
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
