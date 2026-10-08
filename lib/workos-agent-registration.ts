import { WorkOS } from "@workos-inc/node";
import { decodeJwt } from "jose";
import {
  WORKOS_AGENT_RESOURCE,
  workosAgentRegistrationConfig,
} from "./workos-config";

export type WorkOSAgentCredentialStatus =
  | "not_applicable"
  | "valid"
  | "invalid"
  | "unavailable";

/**
 * WorkOS access tokens are verified by Convex as well. This extra server-side
 * check asks WorkOS to enforce registration revocation before token expiry.
 */
export async function validateWorkOSAgentRegistrationCredential(
  authorization: string,
  environment: { [key: string]: string | undefined } = process.env,
): Promise<WorkOSAgentCredentialStatus> {
  const config = workosAgentRegistrationConfig(environment);
  if (!config) return "not_applicable";

  const token = /^Bearer\s+(\S+)$/i.exec(authorization)?.[1];
  if (!token) return "not_applicable";

  let claims: ReturnType<typeof decodeJwt>;
  try {
    claims = decodeJwt(token);
  } catch {
    return "not_applicable";
  }
  if (
    claims.iss !== config.issuer ||
    typeof claims.sub !== "string" ||
    !/^agent_reg_[A-Za-z0-9]{8,64}$/.test(claims.sub)
  )
    return "not_applicable";

  const apiKey = environment.WORKOS_API_KEY?.trim();
  if (!apiKey) return "unavailable";
  try {
    const result = await new WorkOS(apiKey).agents.validateCredential({
      type: "access_token",
      credential: token,
      audience: WORKOS_AGENT_RESOURCE,
      checkForRevoked: true,
    });
    const verified = result.claims;
    const verifiedAudiences = Array.isArray(verified?.audience)
      ? verified.audience
      : verified?.audience
        ? [verified.audience]
        : [];
    if (
      !result.valid ||
      result.registrationId !== claims.sub ||
      !verified ||
      verified.issuer !== config.issuer ||
      verified.registrationId !== claims.sub ||
      !verified.actor?.sub ||
      !verified.scope?.split(/\s+/).includes("evidence") ||
      !verifiedAudiences.includes(WORKOS_AGENT_RESOURCE)
    )
      return "invalid";
    return "valid";
  } catch {
    // A WorkOS outage must not turn a revoked or unverified credential into
    // an accepted one. The caller returns 503 and lets the client retry.
    return "unavailable";
  }
}
