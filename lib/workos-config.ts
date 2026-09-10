/** Shared by Next.js discovery and Convex token verification. */
export const WORKOS_AGENT_RESOURCE = "https://www.symbaiex.com/api/agent/mcp";
export const WORKOS_GRANT_CLAIM = "urn:symbaiex:agent-grant";

export function workosConfig(environment: {
  [key: string]: string | undefined;
  WORKOS_CONNECT_ENABLED?: string;
  WORKOS_AUTHKIT_ISSUER?: string;
}) {
  if (environment.WORKOS_CONNECT_ENABLED !== "true") return null;
  const value = environment.WORKOS_AUTHKIT_ISSUER;
  if (!value)
    throw new Error(
      "WORKOS_AUTHKIT_ISSUER is required when Connect is enabled.",
    );
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !(
      url.hostname.endsWith(".authkit.app") ||
      url.hostname.endsWith(".symbaiex.com")
    )
  )
    throw new Error(
      "WorkOS issuer must be an HTTPS AuthKit or SYMBaiEX origin.",
    );
  return {
    issuer: url.origin,
    audience: WORKOS_AGENT_RESOURCE,
    jwks: `${url.origin}/oauth2/jwks`,
    metadata: `${url.origin}/.well-known/oauth-authorization-server`,
  };
}
